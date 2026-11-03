"""Optional free local engine (faster-whisper). Install with: pip install -r backend/requirements-local-stt.txt

CPU-only on typical laptops: expect roughly real-time or slower with the 'small' model, and weaker Tamil
accuracy than Sarvam. The model (~0.5 GB for 'small') downloads on first use.
"""

from __future__ import annotations

import threading

import numpy as np
from django.conf import settings

from ..errors import ProviderNotConfigured
from ..languages import MEETING_LANGUAGES
from .base import ProgressCallback, Segment, Transcriber

_MODEL = None
_LOCK = threading.Lock()


def _model():
    global _MODEL
    with _LOCK:
        if _MODEL is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise ProviderNotConfigured(
                    "Local transcription is not installed. Run: pip install -r backend/requirements-local-stt.txt"
                ) from exc
            _MODEL = WhisperModel(settings.LOCAL_WHISPER_MODEL, device="cpu", compute_type="int8")
        return _MODEL


class LocalWhisperTranscriber(Transcriber):
    name = "local"
    billed = False

    def transcribe(self, pcm: bytes, rate: int, language: str | None, on_progress: ProgressCallback | None = None) -> list[Segment]:
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        total = len(audio) / rate or 1
        segments, info = _model().transcribe(audio, language=language, vad_filter=True, beam_size=1)
        detected = info.language if info.language in MEETING_LANGUAGES else language
        out = []
        for s in segments:  # a generator: decoding happens while iterating
            text = s.text.strip()
            if text:
                out.append(Segment(start_ms=round(s.start * 1000), end_ms=round(s.end * 1000), text=text, language=detected))
            if on_progress:
                on_progress(min(1.0, s.end / total))
        return out
