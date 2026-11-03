"""Small, dependency-light audio helpers (PCM16 mono)."""

from __future__ import annotations

import io
import math
import wave
from array import array
from collections import deque


def rms_dbfs(pcm: bytes) -> float:
    samples = array("h")
    samples.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    if not samples:
        return -120.0
    mean_sq = sum(s * s for s in samples) / len(samples)
    if mean_sq <= 0:
        return -120.0
    return 20 * math.log10(math.sqrt(mean_sq) / 32768.0)


def parse_wav(data: bytes) -> tuple[bytes, int, int]:
    """Returns (pcm16, sample_rate, channels). Raises ValueError for non-PCM16 WAV."""
    with wave.open(io.BytesIO(data), "rb") as wav:
        if wav.getsampwidth() != 2:
            raise ValueError(f"expected 16-bit WAV, got {wav.getsampwidth() * 8}-bit")
        return wav.readframes(wav.getnframes()), wav.getframerate(), wav.getnchannels()


def downmix_to_mono(pcm: bytes, channels: int) -> bytes:
    if channels == 1:
        return pcm
    samples = array("h")
    samples.frombytes(pcm)
    mono = array("h", (sum(samples[i : i + channels]) // channels for i in range(0, len(samples), channels)))
    return mono.tobytes()


class EnergyGate:
    """Cheap local speech gate so silence is not streamed to (and billed by) the STT provider.

    Audio is forwarded once its level exceeds `threshold_dbfs`; `preroll_ms` of earlier audio is
    forwarded with it so word onsets are kept, and forwarding continues for `hangover_ms` after the
    level drops so the provider's own VAD sees the trailing silence it needs to finalise the turn.
    """

    def __init__(self, sample_rate: int, *, threshold_dbfs: float = -45.0, preroll_ms: int = 300, hangover_ms: int = 1200):
        self.sample_rate = sample_rate
        self.threshold_dbfs = threshold_dbfs
        self.preroll_bytes = int(sample_rate * preroll_ms / 1000) * 2
        self.hangover_bytes = int(sample_rate * hangover_ms / 1000) * 2
        self._preroll: deque[bytes] = deque()
        self._preroll_size = 0
        self._open_remaining = 0

    @property
    def is_open(self) -> bool:
        return self._open_remaining > 0

    def process(self, pcm: bytes) -> bytes:
        """Returns the bytes that should be sent now (possibly empty)."""
        if rms_dbfs(pcm) >= self.threshold_dbfs:
            out = b"".join(self._preroll) + pcm if not self.is_open else pcm
            self._preroll.clear()
            self._preroll_size = 0
            self._open_remaining = self.hangover_bytes
            return out
        if self.is_open:
            self._open_remaining -= len(pcm)
            return pcm
        self._preroll.append(pcm)
        self._preroll_size += len(pcm)
        while self._preroll_size > self.preroll_bytes and self._preroll:
            self._preroll_size -= len(self._preroll.popleft())
        return b""
