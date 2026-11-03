"""Provider-independent transcription interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass


@dataclass
class Segment:
    start_ms: int
    end_ms: int
    text: str
    language: str | None = None  # short code: ta / en / hi
    speaker: str = ""


ProgressCallback = Callable[[float], None]  # 0.0 - 1.0


class Transcriber(ABC):
    name = "base"
    #: True when the provider bills per audio second (recorded as meeting usage)
    billed = False

    def __init__(self) -> None:
        self.billed_seconds = 0.0

    @abstractmethod
    def transcribe(
        self, pcm: bytes, rate: int, language: str | None, on_progress: ProgressCallback | None = None
    ) -> list[Segment]:
        """pcm: mono s16le at `rate`. language: short code or None (auto). Timestamps are absolute."""
