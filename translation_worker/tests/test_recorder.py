import io
import wave

import httpx
import numpy as np
import pytest

from translation_worker.recorder import RATE, CallRecorder, upload_recording


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def tone(seconds: float, value: int, rate: int = RATE) -> bytes:
    return np.full(int(seconds * rate), value, dtype="<i2").tobytes()


def test_nothing_recorded_without_consent():
    rec = CallRecorder(max_seconds=60, clock=Clock())
    rec.write("mic:a", tone(0.02, 100), RATE)
    assert not rec.has_audio


def test_sources_are_mixed_on_one_timeline():
    clock = Clock()
    rec = CallRecorder(max_seconds=60, clock=clock)
    rec.set_enabled(True)
    for _ in range(50):  # 1 s of speaker A in real time
        clock.t += 0.02
        rec.write("mic:a", tone(0.02, 100), RATE)
    clock.t += 2.0  # 2 s pause, then B
    for _ in range(50):
        clock.t += 0.02
        rec.write("mic:b", tone(0.02, 200), RATE)
    mixed = rec.mix()
    assert len(mixed) == pytest.approx(4.0 * RATE, abs=RATE * 0.05)
    assert mixed[int(0.5 * RATE)] == 100
    assert mixed[int(2.0 * RATE)] == 0  # silence between them
    assert mixed[-100] == 200


def test_burst_of_synthesized_audio_is_laid_out_contiguously():
    clock = Clock()
    rec = CallRecorder(max_seconds=60, clock=clock)
    rec.set_enabled(True)
    clock.t += 1.0
    for _ in range(25):  # 0.5 s of audio handed over at the same instant (queue fill)
        rec.write("voice:b", tone(0.02, 50, 24000), 24000)
    pieces = rec._pieces["voice:b"]
    ends = [pos + len(s) for pos, s in pieces]
    starts = [pos for pos, _ in pieces]
    assert starts[1:] == ends[:-1]  # back to back, not stacked on each other
    assert sum(len(s) for _, s in pieces) == pytest.approx(0.5 * RATE, abs=10)  # resampled to 16 kHz


def test_overlapping_voices_are_summed_and_clipped():
    clock = Clock()
    rec = CallRecorder(max_seconds=60, clock=clock)
    rec.set_enabled(True)
    clock.t += 0.02
    rec.write("mic:a", tone(0.02, 30000), RATE)
    rec.write("voice:a", tone(0.02, 30000), RATE)
    assert rec.mix().max() == 32767


def test_paused_while_consent_withdrawn():
    clock = Clock()
    rec = CallRecorder(max_seconds=60, clock=clock)
    rec.set_enabled(True)
    clock.t += 0.02
    rec.write("mic:a", tone(0.02, 100), RATE)
    rec.set_enabled(False)
    clock.t += 0.02
    rec.write("mic:a", tone(0.02, 100), RATE)
    assert sum(len(s) for _, s in rec._pieces["mic:a"]) == int(0.02 * RATE)


def test_length_is_capped():
    clock = Clock()
    rec = CallRecorder(max_seconds=1, clock=clock)
    rec.set_enabled(True)
    for _ in range(100):
        clock.t += 0.02
        rec.write("mic:a", tone(0.02, 1), RATE)
    assert len(rec.mix()) <= RATE


@pytest.mark.asyncio
async def test_upload_sends_wav_with_start_time():
    seen = {}

    def handler(request: httpx.Request):
        seen["secret"] = request.headers["X-Worker-Secret"]
        seen["body"] = request.read()
        return httpx.Response(201, json={"stored": 1})

    clock = Clock()
    rec = CallRecorder(max_seconds=60, clock=clock)
    rec.set_enabled(True)
    clock.t += 0.02
    rec.write("mic:a", tone(0.02, 100), RATE)
    http = httpx.AsyncClient(base_url="http://backend", transport=httpx.MockTransport(handler))
    assert await upload_recording(rec, backend_url="http://backend", secret="s3", room_name="call-x", http=http)
    assert seen["secret"] == "s3"
    assert b"call-x" in seen["body"] and b"RIFF" in seen["body"]
    assert str(int(rec.started_at * 1000)).encode() in seen["body"]
    with wave.open(io.BytesIO(rec.wav())) as w:
        assert (w.getframerate(), w.getnchannels()) == (RATE, 1)


@pytest.mark.asyncio
async def test_no_upload_without_audio_or_secret():
    rec = CallRecorder(max_seconds=60, clock=Clock())
    assert not await upload_recording(rec, backend_url="http://backend", secret="s3", room_name="r")
    rec.set_enabled(True)
    rec.write("mic:a", tone(0.02, 1), RATE)
    assert not await upload_recording(rec, backend_url="http://backend", secret="", room_name="r")
