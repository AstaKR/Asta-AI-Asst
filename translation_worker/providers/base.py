"""Provider-neutral speech interfaces used by the translation pipeline.

A provider instance is created per call, so its `usage` counters are per-call. Provider-specific code
lives in sibling modules (e.g. sarvam.py) and must only use documented provider behaviour.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal


class ProviderError(Exception):
    """Base class. `retryable` tells the pipeline whether a retry may succeed."""

    retryable = False

    def __init__(self, message: str, *, code: str = ""):
        super().__init__(message)
        self.code = code


class ProviderConfigError(ProviderError):
    """Missing/invalid configuration such as an absent API key. Never retried."""


class ProviderAuthError(ProviderError):
    """The provider rejected the credentials."""


class ProviderQuotaError(ProviderError):
    """Credits exhausted. Never retried: retrying would not restore credits."""


class ProviderRateLimitError(ProviderError):
    retryable = True


class ProviderTimeoutError(ProviderError):
    retryable = True


class ProviderUnavailableError(ProviderError):
    """Network failure, 5xx, or an unexpectedly closed stream."""

    retryable = True


class ProviderRequestError(ProviderError):
    """The provider rejected the request (400/422). Not retried."""


SpeechEventType = Literal["speech_start", "speech_end", "partial", "final"]


@dataclass
class SpeechEvent:
    type: SpeechEventType
    text: str = ""
    utterance_id: str = ""
    language: str | None = None
    at: float = field(default_factory=time.monotonic)


@dataclass
class AudioChunk:
    """Mono 16-bit little-endian PCM."""

    pcm: bytes
    sample_rate: int

    @property
    def duration(self) -> float:
        return len(self.pcm) / 2 / self.sample_rate


@dataclass
class ProviderUsage:
    stt_seconds: float = 0.0
    translate_chars: int = 0
    tts_chars: int = 0
    requests: int = 0
    errors: int = 0


@dataclass(frozen=True)
class Capabilities:
    streaming_stt: bool
    partial_transcripts: bool
    streaming_tts: bool
    languages: frozenset[str]


class STTStream(ABC):
    """One continuous recognition session for one speaker in one language."""

    @abstractmethod
    async def push_audio(self, pcm: bytes) -> None:
        """Send mono PCM16 at `SpeechProvider.stt_sample_rate`. Raises ProviderError if the stream is dead."""

    @abstractmethod
    def events(self) -> AsyncIterator[SpeechEvent]:
        """Yields speech events until the stream closes. Raises ProviderError on abnormal termination."""

    @abstractmethod
    async def aclose(self) -> None: ...

    @property
    @abstractmethod
    def closed(self) -> bool: ...


class SpeechProvider(ABC):
    name: str = "base"
    stt_sample_rate: int = 16000
    capabilities: Capabilities

    def __init__(self) -> None:
        self.usage = ProviderUsage()

    @abstractmethod
    async def open_stt_stream(self, language: str) -> STTStream: ...

    @abstractmethod
    async def translate(self, text: str, source_language: str, target_language: str) -> str: ...

    @abstractmethod
    def synthesize(self, text: str, language: str, voice: str | None) -> AsyncIterator[AudioChunk]:
        """Yields audio chunks in order. Cancelling the consuming task cancels the request."""

    def supports_language(self, language: str) -> bool:
        return language in self.capabilities.languages

    async def aclose(self) -> None:  # pragma: no cover - default no-op
        return None
