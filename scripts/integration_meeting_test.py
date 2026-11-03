"""Manual integration test #3 — meetings, with REAL Sarvam calls (costs well under ₹2).

Needs: backend, `manage.py process_meetings`, LiveKit server and the translation worker running, and
SARVAM_API_KEY in .env.

  A. Upload: a synthetic Tamil sentence, 1.5 s pause, then a Hindi sentence (made with Sarvam TTS) is
     uploaded through the API; the job runner transcribes and translates it to English.
     Checks: 2+ segments, increasing timestamps, second segment starts after the pause, English
     translations stored separately, TXT export.
  B. Live meeting: a LiveKit client joins a live-meeting room and "speaks" Tamil; the worker transcribes
     and translates it live and the backend stores the segments with offsets.

    .venv\\Scripts\\python scripts\\integration_meeting_test.py --backend http://127.0.0.1:8010
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import secrets
import sys
import time
from array import array
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from livekit import rtc  # noqa: E402

from translation_worker.config import load_config  # noqa: E402
from translation_worker.providers.sarvam import SarvamProvider  # noqa: E402

TAMIL = "வணக்கம், நாளை காலை பத்து மணிக்கு கூட்டம் நடைபெறும்."
HINDI = "ठीक है, मैं रिपोर्ट शुक्रवार तक भेज दूँगा।"
RATE = 16000


def wav(pcm: bytes) -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return buf.getvalue()


class Api:
    def __init__(self, base: str):
        self.http = httpx.Client(base_url=base, timeout=60)

    def _csrf(self):
        if "csrftoken" not in self.http.cookies:
            self.http.get("/api/auth/csrf/")
        return {"X-CSRFToken": self.http.cookies["csrftoken"]}

    def post(self, path, **kw):
        r = self.http.post(path, headers=self._csrf(), **kw)
        if r.status_code >= 400:
            raise SystemExit(f"{path} -> {r.status_code}: {r.text[:400]}")
        return r.json() if r.content else {}

    def get(self, path, **kw):
        r = self.http.get(path, **kw)
        r.raise_for_status()
        return r


async def synth(provider: SarvamProvider, text: str, lang: str) -> bytes:
    return b"".join([c.pcm async for c in provider.synthesize(text, lang, None)])


def wait_for(api: Api, meeting_id: str, done: set[str], timeout: float = 240) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        m = api.get(f"/api/meetings/{meeting_id}/").json()
        if m["status"] in done:
            return m
        time.sleep(2)
    raise SystemExit(f"timed out waiting for meeting {meeting_id}: last status {m['status']}")


async def part_a(api: Api, provider: SarvamProvider) -> bool:
    ta = await synth(provider, TAMIL, "ta-IN")
    hi = await synth(provider, HINDI, "hi-IN")
    pause = b"\x00\x00" * int(RATE * 1.5)
    audio = wav(ta + pause + hi)
    ta_end_ms = len(ta) // 2 * 1000 // RATE
    print(f"A: uploading {len(audio) // 1024} KB ({(len(ta) + len(pause) + len(hi)) / 2 / RATE:.1f} s); Tamil part ends at {ta_end_ms} ms")
    m = api.post(
        "/api/meetings/",
        files={"file": ("mixed.wav", audio, "audio/wav")},
        data={"title": "Integration upload", "spoken_language": "auto", "translation_language": "en", "consent": "true"},
    )
    m = wait_for(api, m["id"], {"completed", "failed"})
    if m["status"] == "failed":
        print(f"A: FAILED — {m['error_message']}")
        return False
    segs = m["segments"]
    for s in segs:
        print(f"   [{s['start_ms']:>5}-{s['end_ms']:>5} ms] ({s['language']}) {s['original_text']}\n      -> {s['translated_text']}")
    print(f"   billed STT {m['stt_seconds']:.1f} s, translated {m['translate_chars']} chars")
    txt = api.get(f"/api/meetings/{m['id']}/export/", params={"kind": "txt"}).text
    ok = (
        len(segs) >= 2
        and all(segs[i]["start_ms"] <= segs[i + 1]["start_ms"] for i in range(len(segs) - 1))
        and segs[-1]["start_ms"] >= ta_end_ms
        and all(s["translated_text"] for s in segs if s["language"] != "en")
        and "Integration upload" in txt
    )
    print("A:", "PASS" if ok else "FAIL")
    return ok


async def part_b(api: Api, provider: SarvamProvider) -> bool:
    res = api.post(
        "/api/meetings/live/",
        json={"title": "Integration live", "spoken_language": "ta", "translation_language": "en", "voice_playback": False, "consent": True},
    )
    meeting_id, code = res["meeting"]["id"], res["room_code"]
    tok = api.post(f"/api/rooms/{code}/token/")
    room = rtc.Room()
    await room.connect(tok["url"], tok["token"])
    source = rtc.AudioSource(RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
    await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
    api.post(f"/api/meetings/{meeting_id}/live-started/", json={"recording_started_at_ms": int(time.time() * 1000)})
    for _ in range(40):  # wait for the translator agent
        if any(p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT for p in room.remote_participants.values()):
            break
        await asyncio.sleep(0.5)
    else:
        print("B: FAIL — translator agent did not join (is the worker running?)")
        return False
    await asyncio.sleep(1.5)
    speech = await synth(provider, TAMIL, "ta-IN")
    frame = RATE // 100
    pcm = speech + b"\x00\x00" * RATE * 4  # speech, then 4 s silence so the turn ends
    for i in range(0, len(pcm), frame * 2):
        chunk = pcm[i : i + frame * 2].ljust(frame * 2, b"\x00")
        await source.capture_frame(rtc.AudioFrame(chunk, RATE, 1, frame))
    await asyncio.sleep(6)  # let translation + reporting finish
    api.post(f"/api/rooms/{code}/end/")
    await room.disconnect()
    m = wait_for(api, meeting_id, {"completed"}, timeout=30)
    segs = m["segments"]
    for s in segs:
        print(f"   [{s['start_ms']:>5}-{s['end_ms']:>5} ms] {s['original_text']}\n      -> {s['translated_text']}")
    ok = len(segs) >= 1 and segs[0]["origin"] == "live" and bool(segs[0]["translated_text"]) and segs[0]["end_ms"] >= segs[0]["start_ms"] > 0
    print("B:", "PASS" if ok else "FAIL")
    return ok


async def main(backend: str) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()
    if not cfg.sarvam.api_key:
        print("SARVAM_API_KEY missing")
        return 2
    provider = SarvamProvider(dataclasses.replace(cfg.sarvam, tts_sample_rate=RATE))
    api = Api(backend)
    api.post("/api/auth/register/", json={"username": f"meet_{secrets.token_hex(3)}", "password": "Integration-" + secrets.token_hex(6)})
    try:
        a = await part_a(api, provider)
        b = await part_b(api, provider)
    finally:
        await provider.aclose()
    print("PASS" if a and b else "FAIL")
    return 0 if a and b else 1


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--backend", default="http://127.0.0.1:8000")
    sys.exit(asyncio.run(main(p.parse_args().backend)))
