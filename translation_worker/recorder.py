"""Call recording: every voice in the call (originals and translated speech) mixed into one mono WAV.

Only audio heard while every participant agreed (room metadata `save_transcript`) is written; the
rest of the timeline stays silent. Each source keeps its own track placed by wall-clock time, so a
burst of synthesized audio is laid out contiguously and nothing is counted twice; the tracks are
summed only when the call ends. The file is uploaded to the backend, which attaches it to the
participants' saved call transcripts.
"""

from __future__ import annotations

import io
import logging
import time
import wave

import httpx
import numpy as np

log = logging.getLogger("translation_worker.recorder")
RATE = 16000
# Gaps shorter than this are closed up instead of left as silence (frame jitter, resampler delay).
JOIN_TOLERANCE_S = 0.25


def _resample(pcm: np.ndarray, rate: int) -> np.ndarray:
    if rate == RATE or not len(pcm):
        return pcm
    n = max(1, round(len(pcm) * RATE / rate))
    x = np.linspace(0, len(pcm) - 1, n)
    return np.interp(x, np.arange(len(pcm)), pcm.astype(np.float32)).astype(np.int16)


class CallRecorder:
    def __init__(self, *, max_seconds: float, clock=time.time):
        self.max_samples = int(max_seconds * RATE)
        self.clock = clock
        self.enabled = False
        self.started_at: float | None = None  # epoch seconds of sample 0
        self._pieces: dict[str, list[tuple[int, np.ndarray]]] = {}
        self._cursor: dict[str, int] = {}

    def set_enabled(self, enabled: bool) -> None:
        if enabled and not self.enabled:
            log.info("call recording on")
        elif self.enabled and not enabled:
            log.info("call recording paused (consent withdrawn)")
        self.enabled = enabled

    @property
    def has_audio(self) -> bool:
        return any(self._pieces.values())

    def write(self, source: str, pcm: bytes, sample_rate: int) -> None:
        """Adds 16-bit mono PCM from `source` (a speaker's microphone or a listener's translated voice)."""
        if not self.enabled or not pcm:
            return
        now = self.clock()
        if self.started_at is None:
            self.started_at = now
        samples = _resample(np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2"), sample_rate)
        duration = len(samples)
        wall = int((now - self.started_at) * RATE) - duration  # this audio ends now
        cursor = self._cursor.get(source, 0)
        pos = cursor if wall < cursor + JOIN_TOLERANCE_S * RATE else wall
        pos = max(0, pos)
        if pos >= self.max_samples:
            return
        samples = samples[: self.max_samples - pos]
        self._pieces.setdefault(source, []).append((pos, samples))
        self._cursor[source] = pos + len(samples)

    def mix(self) -> np.ndarray:
        length = max((pos + len(s) for pieces in self._pieces.values() for pos, s in pieces), default=0)
        out = np.zeros(length, dtype=np.int32)
        for pieces in self._pieces.values():
            for pos, s in pieces:
                out[pos : pos + len(s)] += s
        return np.clip(out, -32768, 32767).astype("<i2")

    def wav(self) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(self.mix().tobytes())
        return buf.getvalue()


async def upload_recording(recorder: CallRecorder, *, backend_url: str, secret: str, room_name: str, http: httpx.AsyncClient | None = None) -> bool:
    """Sends the mixed recording to the backend. Returns True when it was stored."""
    if not secret or not recorder.has_audio or recorder.started_at is None:
        return False
    client = http or httpx.AsyncClient(base_url=backend_url, timeout=120)
    try:
        resp = await client.post(
            "/api/internal/call-recording/",
            data={"room_name": room_name, "started_epoch_ms": str(int(recorder.started_at * 1000))},
            files={"file": ("call.wav", recorder.wav(), "audio/wav")},
            headers={"X-Worker-Secret": secret},
        )
        resp.raise_for_status()
        log.info("call recording uploaded")
        return True
    except Exception as exc:
        log.warning("call recording upload failed (%s)", exc.__class__.__name__)
        return False
    finally:
        if http is None:
            await client.aclose()
