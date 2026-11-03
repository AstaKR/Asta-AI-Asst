"""faster-whisper speech-to-text (MIT). Whisper's Tamil accuracy is noticeably weaker than Hindi/English."""

from __future__ import annotations

import threading

import numpy as np

from ..config import LocalAIConfig
from ..registry import ModelRegistry, ModelUnavailable
from ..text import LANGUAGES
from . import has_module

_SIZES_GB = {"tiny": 0.3, "base": 0.4, "small": 0.7, "medium": 1.6, "large": 3.2, "turbo": 1.8}
RATE = 16000


class SpeechToText:
    def __init__(self, cfg: LocalAIConfig, registry: ModelRegistry):
        self.cfg = cfg
        self.registry = registry
        self._lock = threading.Lock()

    def status(self) -> dict:
        return {
            "engine": "faster-whisper",
            "installed": has_module("faster_whisper"),
            "model": self.cfg.whisper_model,
            "fast_model": self.cfg.whisper_fast_model,
            "languages": sorted(LANGUAGES),
        }

    def _load(self, name: str):
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise ModelUnavailable("faster-whisper is not installed.") from exc
        return WhisperModel(name, device="cpu", compute_type=self.cfg.whisper_compute_type, cpu_threads=self.cfg.whisper_threads)

    def transcribe(self, pcm: bytes, language: str | None, fast: bool = False) -> dict:
        """`pcm`: mono 16-bit 16 kHz. Segment times are the ones the model reports."""
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        name = self.cfg.whisper_fast_model if fast else self.cfg.whisper_model
        size = next((gb for tag, gb in _SIZES_GB.items() if tag in name), 1.0)
        model = self.registry.get(f"whisper:{name}", size, lambda: self._load(name))
        with self._lock:
            segments, info = model.transcribe(audio, language=language, vad_filter=True, beam_size=1)
            out = [
                {"start_ms": round(s.start * 1000), "end_ms": round(s.end * 1000), "text": s.text.strip()}
                for s in segments  # a generator: decoding happens while iterating
                if s.text.strip()
            ]
        detected = info.language if info.language in LANGUAGES else None
        return {
            "segments": out,
            "language": language or detected,
            "detected_language": info.language,
            "duration": len(audio) / RATE,
            "model": name,
        }
