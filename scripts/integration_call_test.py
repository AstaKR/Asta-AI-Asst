"""Manual integration test #1 — real backend + real LiveKit server, no AI provider.

Registers two users through the REST API, creates/joins a room, fetches short-lived tokens and
connects two real WebRTC clients (LiveKit Python SDK). Participant A publishes a 440 Hz tone,
participant B an 880 Hz tone. Passes only if each side receives the other's audio with the right
dominant frequency, i.e. the two-way call path works end to end.

Usage (backend, LiveKit server running):
    .venv\\Scripts\\python scripts\\integration_call_test.py --backend http://127.0.0.1:8010
"""

from __future__ import annotations

import argparse
import asyncio
import math
import secrets
import sys
from array import array

import httpx
import numpy as np
from livekit import rtc

RATE = 48000


class ApiUser:
    def __init__(self, backend: str, name: str):
        self.http = httpx.Client(base_url=backend, timeout=10)
        self.name = name

    def _csrf(self) -> dict:
        if "csrftoken" not in self.http.cookies:
            self.http.get("/api/auth/csrf/")
        return {"X-CSRFToken": self.http.cookies["csrftoken"]}

    def post(self, path: str, body: dict | None = None) -> dict:
        res = self.http.post(path, json=body or {}, headers=self._csrf())
        if res.status_code >= 400:
            raise SystemExit(f"{path} -> {res.status_code}: {res.text}")
        return res.json() if res.content else {}

    def register(self):
        username = f"{self.name}_{secrets.token_hex(3)}"
        self.post("/api/auth/register/", {"username": username, "password": "Integration-" + secrets.token_hex(6), "display_name": self.name})
        return username


async def publish_tone(room: rtc.Room, freq: float, stop: asyncio.Event):
    source = rtc.AudioSource(RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
    await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
    n = RATE // 100  # 10 ms
    t = 0
    while not stop.is_set():
        samples = array("h", (int(9000 * math.sin(2 * math.pi * freq * (t + i) / RATE)) for i in range(n)))
        t += n
        await source.capture_frame(rtc.AudioFrame(samples.tobytes(), RATE, 1, n))


def dominant_frequency(pcm: bytes, rate: int) -> float:
    data = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    if len(data) == 0 or np.abs(data).max() < 200:
        return 0.0
    spectrum = np.abs(np.fft.rfft(data * np.hanning(len(data))))
    return float(np.fft.rfftfreq(len(data), 1 / rate)[int(np.argmax(spectrum))])


async def receive_from(room: rtc.Room, identity: str, seconds: float = 2.0) -> float:
    loop = asyncio.get_running_loop()
    got: asyncio.Future = loop.create_future()

    def on_sub(track, publication, participant):
        if participant.identity == identity and track.kind == rtc.TrackKind.KIND_AUDIO and not got.done():
            got.set_result(track)

    room.on("track_subscribed", on_sub)
    for p in room.remote_participants.values():
        if p.identity == identity:
            for pub in p.track_publications.values():
                if pub.track and not got.done():
                    got.set_result(pub.track)
    track = await asyncio.wait_for(got, 15)
    stream = rtc.AudioStream(track, sample_rate=RATE, num_channels=1)
    buf = bytearray()
    skip = int(RATE * 0.5) * 2  # ignore jitter-buffer warm-up
    async for ev in stream:
        buf.extend(bytes(ev.frame.data))
        if len(buf) >= skip + int(RATE * seconds) * 2:
            break
    await stream.aclose()
    return dominant_frequency(bytes(buf[skip:]), RATE)


async def main(backend: str) -> int:
    a, b = ApiUser(backend, "Anand"), ApiUser(backend, "Bharat")
    a.register(), b.register()
    room = a.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"})
    code = room["code"]
    b.post(f"/api/rooms/{code}/join/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"})
    tok_a, tok_b = a.post(f"/api/rooms/{code}/token/"), b.post(f"/api/rooms/{code}/token/")
    print(f"room {code}: identities {tok_a['identity']} / {tok_b['identity']}, url {tok_a['url']}")

    room_a, room_b = rtc.Room(), rtc.Room()
    await room_a.connect(tok_a["url"], tok_a["token"])
    await room_b.connect(tok_b["url"], tok_b["token"])
    stop = asyncio.Event()
    pubs = [asyncio.create_task(publish_tone(room_a, 440, stop)), asyncio.create_task(publish_tone(room_b, 880, stop))]
    try:
        freq_at_b, freq_at_a = await asyncio.gather(
            receive_from(room_b, tok_a["identity"]), receive_from(room_a, tok_b["identity"])
        )
    finally:
        stop.set()
        await asyncio.gather(*pubs, return_exceptions=True)
    print(f"B hears A at {freq_at_b:.0f} Hz (expected 440); A hears B at {freq_at_a:.0f} Hz (expected 880)")

    # The token only allows the microphone source: publishing a camera/screen track must be refused.
    try:
        src = rtc.AudioSource(RATE, 1)
        bad = rtc.LocalAudioTrack.create_audio_track("screen-audio", src)
        await asyncio.wait_for(
            room_a.local_participant.publish_track(bad, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO)), 5
        )
        source_restricted = False
    except Exception:
        source_restricted = True
    print(f"non-microphone publish refused: {source_restricted}")

    ended = a.post(f"/api/rooms/{code}/end/")
    await asyncio.sleep(1)
    print(f"room status after end: {ended['status']}; A connected: {room_a.isconnected()}, B connected: {room_b.isconnected()}")
    await room_a.disconnect()
    await room_b.disconnect()
    ok = abs(freq_at_b - 440) < 15 and abs(freq_at_a - 880) < 15 and source_restricted and ended["status"] == "ended"
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", default="http://127.0.0.1:8000")
    sys.exit(asyncio.run(main(parser.parse_args().backend)))
