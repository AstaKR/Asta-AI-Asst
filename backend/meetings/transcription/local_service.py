"""Transcription through the local AI service (faster-whisper in local_ai/). Free; runs on this server.

Audio is sent in LOCAL_AI_CHUNK_SECONDS pieces so progress can be shown and requests stay small; the
service's segment times are offset by each piece's start, so timestamps stay absolute.
"""

from __future__ import annotations

from django.conf import settings

from integrations.local_ai import LocalAIClient

from .. import audio as audio_lib
from ..languages import MEETING_LANGUAGES
from .base import ProgressCallback, Segment, Transcriber


class LocalServiceTranscriber(Transcriber):
    name = "local"
    billed = False

    def __init__(self, client: LocalAIClient | None = None):
        super().__init__()
        self.client = client or LocalAIClient()

    def transcribe(self, pcm: bytes, rate: int, language: str | None, on_progress: ProgressCallback | None = None) -> list[Segment]:
        piece = settings.LOCAL_AI_CHUNK_SECONDS * rate * 2
        total = max(1, len(pcm))
        out: list[Segment] = []
        for offset in range(0, len(pcm), piece):
            chunk = pcm[offset : offset + piece]
            if len(chunk) < rate // 5:  # under 0.1 s: nothing to recognise
                continue
            data = self.client.transcribe(audio_lib.wav_bytes(chunk, rate), language)
            detected = data.get("language") if data.get("language") in MEETING_LANGUAGES else language
            base_ms = offset * 1000 // (rate * 2)
            for s in data.get("segments", []):
                out.append(Segment(start_ms=base_ms + s["start_ms"], end_ms=base_ms + s["end_ms"], text=s["text"], language=detected))
            if on_progress:
                on_progress(min(1.0, (offset + len(chunk)) / total))
        return out
