"""Manual integration test #2 — real LiveKit server + the real CallSession, with a TEST-ONLY provider.

This verifies the worker's LiveKit plumbing, not AI quality: subscription rules, per-listener
translated tracks, track-permission isolation and subtitle delivery. The provider below is a test
harness (it emits one fake utterance per speaker and "speaks" a pure tone whose frequency encodes
the target language). It is never used by the production worker.

    Tamil listener (A) should receive a 1000 Hz tone on track translation-for-A
    Hindi listener (B) should receive a  600 Hz tone on track translation-for-B
    Neither may subscribe to the other's translated track.

Usage (LiveKit dev server running):
    .venv\\Scripts\\python scripts\\integration_routing_test.py
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import math
import secrets
import sys
from array import array
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from livekit import api, rtc  # noqa: E402

from scripts.integration_call_test import RATE, dominant_frequency, publish_tone  # noqa: E402
from translation_worker.config import load_config  # noqa: E402
from translation_worker.providers.base import AudioChunk, Capabilities, SpeechEvent, SpeechProvider, STTStream  # noqa: E402
from translation_worker.session import CallSession  # noqa: E402

URL, KEY, SECRET = "ws://localhost:7880", "devkey", "secret"
TONES = {"hi-IN": 600, "ta-IN": 1000}


class ToneSTT(STTStream):
    """Emits exactly one utterance after ~0.5 s of received audio."""

    def __init__(self, language: str):
        self.language = language
        self.received = 0
        self.queue: asyncio.Queue = asyncio.Queue()
        self._closed = False
        self._fired = False

    @property
    def closed(self):
        return self._closed

    async def push_audio(self, pcm: bytes):
        self.received += len(pcm)
        if not self._fired and self.received >= 16000:  # 0.5 s at 16 kHz
            self._fired = True
            for ev in (SpeechEvent("speech_start", utterance_id="0"), SpeechEvent("speech_end", utterance_id="0"),
                       SpeechEvent("final", text=f"hello from the {self.language} speaker", utterance_id="0")):
                self.queue.put_nowait(ev)

    async def events(self):
        while True:
            item = await self.queue.get()
            if item is None:
                return
            yield item

    async def aclose(self):
        self._closed = True
        self.queue.put_nowait(None)


class ToneProvider(SpeechProvider):
    name = "test-tone"

    def __init__(self):
        super().__init__()
        self.capabilities = Capabilities(True, False, False, frozenset(TONES))

    async def open_stt_stream(self, language):
        return ToneSTT(language)

    async def translate(self, text, source_language, target_language):
        return f"rendered {source_language}->{target_language}"

    async def synthesize(self, text, language, voice):
        freq, n = TONES[language], 24000 // 10
        for k in range(30):  # 3 s of tone in 100 ms chunks
            pcm = array("h", (int(9000 * math.sin(2 * math.pi * freq * (k * n + i) / 24000)) for i in range(n)))
            yield AudioChunk(pcm.tobytes(), 24000)


def token(room: str, identity: str, *, kind: str = "standard", attrs: dict | None = None) -> str:
    t = (
        api.AccessToken(KEY, SECRET)
        .with_identity(identity)
        .with_name(identity)
        .with_kind(kind)
        .with_grants(api.VideoGrants(room_join=True, room=room, agent=kind == "agent", can_publish_sources=None if kind == "agent" else ["microphone"]))
        .with_ttl(timedelta(minutes=5))
    )
    if attrs:
        t = t.with_attributes(attrs)
    return t.to_jwt()


async def main() -> int:
    import logging

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    logging.getLogger("livekit").setLevel(logging.WARNING)
    room_name = f"routing-test-{secrets.token_hex(3)}"
    a, b = rtc.Room(), rtc.Room()
    agent_room = rtc.Room()
    received: dict[str, list[dict]] = {"A": [], "B": []}
    for label, r in (("A", a), ("B", b)):
        r.on("data_received", lambda pkt, label=label: received[label].append(json.loads(pkt.data)) if pkt.topic == "translator" else None)

    await agent_room.connect(URL, token(room_name, "translator-agent", kind="agent"), rtc.RoomOptions(auto_subscribe=False))
    cfg = dataclasses.replace(load_config(), interrupt_on_listener_speech=False)
    session = CallSession(agent_room, cfg, ToneProvider(), job_metadata={}, lkapi=None)
    # Test harness: no backend usage reporting.
    session.reporter.secret = ""
    await session.start()
    print("agent session started", flush=True)

    await a.connect(URL, token(room_name, "A", attrs={"spoken_language": "ta-IN", "listen_language": "ta-IN", "voice": ""}))
    await b.connect(URL, token(room_name, "B", attrs={"spoken_language": "hi-IN", "listen_language": "hi-IN", "voice": ""}))
    stop = asyncio.Event()
    tones = [asyncio.create_task(publish_tone(a, 440, stop)), asyncio.create_task(publish_tone(b, 880, stop))]
    print("participants connected and publishing", flush=True)

    async def translated_for(room: rtc.Room) -> tuple[str, float]:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()

        def on_sub(track, pub, participant):
            if participant.identity == "translator-agent" and not fut.done():
                fut.set_result((pub.name, track))

        room.on("track_subscribed", on_sub)
        name, track = await asyncio.wait_for(fut, 20)
        stream = rtc.AudioStream(track, sample_rate=RATE, num_channels=1)
        buf = bytearray()
        async for ev in stream:
            data = bytes(ev.frame.data)
            if max(array("h", data), default=0) > 1000 or buf:
                buf.extend(data)
            if len(buf) >= RATE * 2 * 1:  # 1 s of non-silent translated audio
                break
        await stream.aclose()
        return name, dominant_frequency(bytes(buf), RATE)

    try:
        try:
            (name_a, freq_a), (name_b, freq_b) = await asyncio.wait_for(
                asyncio.gather(translated_for(a), translated_for(b)), 25
            )
        except asyncio.TimeoutError:
            for route, direction, task, _track in session.directions.values():
                stt = direction._stt
                print(f"DIAG {direction.label}: done={task.done()} stopped={direction.stopped_reason!r} "
                      f"stt_received={getattr(stt, 'received', None)} queue={direction._queue.qsize()} "
                      f"current={direction._current}")
                if task.done() and task.exception():
                    print("  task exception:", repr(task.exception()))
            print("subscriptions A:", [(p.identity, [(pub.name, pub.subscribed) for pub in p.track_publications.values()]) for p in a.remote_participants.values()])
            print("subscriptions B:", [(p.identity, [(pub.name, pub.subscribed) for pub in p.track_publications.values()]) for p in b.remote_participants.values()])
            raise
        await asyncio.sleep(0.5)
        # Isolation: try to force-subscribe to the OTHER listener's translated track.
        leaks = []
        for room, me in ((a, "A"), (b, "B")):
            agent = room.remote_participants["translator-agent"]
            for pub in agent.track_publications.values():
                if pub.name != f"translation-for-{me}":
                    pub.set_subscribed(True)
            await asyncio.sleep(1.5)
            leaks += [pub.name for pub in agent.track_publications.values() if pub.name != f"translation-for-{me}" and pub.track is not None]
    finally:
        stop.set()
        await asyncio.gather(*tones, return_exceptions=True)
        await session.aclose()
        for r in (a, b, agent_room):
            await r.disconnect()

    subs_a = [m for m in received["A"] if m.get("type") == "subtitle" and m.get("stage") == "translation"]
    subs_b = [m for m in received["B"] if m.get("type") == "subtitle" and m.get("stage") == "translation"]
    print(f"A got track {name_a!r} at {freq_a:.0f} Hz (expect translation-for-A, 1000 Hz)")
    print(f"B got track {name_b!r} at {freq_b:.0f} Hz (expect translation-for-B, 600 Hz)")
    print(f"cross-subscriptions that succeeded (must be none): {leaks}")
    print(f"translation subtitles at A: {[m['text'] for m in subs_a]}")
    print(f"translation subtitles at B: {[m['text'] for m in subs_b]}")
    print(f"directions: utterances={session.counters.utterances}")
    ok = (
        name_a == "translation-for-A" and abs(freq_a - 1000) < 20
        and name_b == "translation-for-B" and abs(freq_b - 600) < 20
        and not leaks
        and any("hi-IN->ta-IN" in m["text"] for m in subs_a)
        and any("ta-IN->hi-IN" in m["text"] for m in subs_b)
    )
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
