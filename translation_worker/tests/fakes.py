"""Test doubles. Never imported by production code."""

from __future__ import annotations

import asyncio
from array import array

from translation_worker.providers.base import (
    AudioChunk,
    Capabilities,
    ProviderError,
    SpeechEvent,
    SpeechProvider,
    STTStream,
)

LANGS = frozenset({"ta-IN", "hi-IN", "en-IN"})


def loud_frame(ms: int = 20, rate: int = 16000) -> bytes:
    n = rate * ms // 1000
    return array("h", [8000 if i % 2 else -8000 for i in range(n)]).tobytes()


def silent_frame(ms: int = 20, rate: int = 16000) -> bytes:
    return b"\x00\x00" * (rate * ms // 1000)


class FakeSTT(STTStream):
    def __init__(self, provider: "FakeProvider", language: str):
        self.provider = provider
        self.language = language
        self.pushed = bytearray()
        self.queue: asyncio.Queue = asyncio.Queue()
        self._closed = False

    @property
    def closed(self) -> bool:
        return self._closed

    async def push_audio(self, pcm: bytes) -> None:
        if self._closed:
            raise ProviderError("closed")
        self.pushed.extend(pcm)
        self.provider.usage.stt_seconds += len(pcm) / 2 / 16000

    def emit(self, event: SpeechEvent | ProviderError | None) -> None:
        self.queue.put_nowait(event)

    async def events(self):
        while True:
            item = await self.queue.get()
            if item is None:
                self._closed = True
                return
            if isinstance(item, ProviderError):
                self._closed = True
                raise item
            yield item

    async def aclose(self) -> None:
        if not self._closed:
            self._closed = True
            self.queue.put_nowait(None)


class FakeProvider(SpeechProvider):
    name = "fake"

    def __init__(self, *, translate_delay: float = 0.0, tts_chunks: int = 2):
        super().__init__()
        self.capabilities = Capabilities(True, True, False, LANGS)
        self.streams: list[FakeSTT] = []
        self.translations: list[tuple[str, str, str]] = []
        self.syntheses: list[tuple[str, str, str | None]] = []
        self.translate_delay = translate_delay
        self.tts_chunks = tts_chunks
        self.translate_errors: list[Exception] = []
        self.open_errors: list[Exception] = []
        self.tts_delay = 0.0
        self.stream_opened = asyncio.Event()

    async def open_stt_stream(self, language: str) -> STTStream:
        if self.open_errors:
            raise self.open_errors.pop(0)
        stream = FakeSTT(self, language)
        self.streams.append(stream)
        self.stream_opened.set()
        return stream

    async def translate(self, text, source_language, target_language):
        self.translations.append((text, source_language, target_language))
        if self.translate_errors:
            raise self.translate_errors.pop(0)
        if self.translate_delay:
            await asyncio.sleep(self.translate_delay)
        self.usage.translate_chars += len(text)
        return f"[{target_language}] {text}"

    async def synthesize(self, text, language, voice):
        self.syntheses.append((text, language, voice))
        self.usage.tts_chars += len(text)
        for i in range(self.tts_chunks):
            if self.tts_delay:
                await asyncio.sleep(self.tts_delay)
            yield AudioChunk(f"{language}:{i}:".encode() + b"\x00" * 10, 24000)


class FakeOutput:
    def __init__(self):
        self.chunks: list[AudioChunk] = []
        self.cleared = 0
        self.push_delay = 0.0

    async def push(self, chunk: AudioChunk) -> None:
        if self.push_delay:
            await asyncio.sleep(self.push_delay)
        self.chunks.append(chunk)

    def clear(self) -> None:
        self.cleared += 1


class FakeNotifier:
    def __init__(self):
        self.messages: list[tuple[dict, list[str]]] = []

    async def send(self, payload: dict, destinations: list[str]) -> None:
        self.messages.append((payload, list(destinations)))

    def of(self, type_: str, **match):
        return [
            (p, d) for p, d in self.messages if p.get("type") == type_ and all(p.get(k) == v for k, v in match.items())
        ]


async def frames_until(stop: asyncio.Event, *, loud: int = 10):
    for _ in range(loud):
        yield loud_frame()
    while not stop.is_set():
        await asyncio.sleep(0.005)
        yield silent_frame()


async def wait_for(predicate, timeout: float = 2.0):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not predicate():
        if loop.time() > deadline:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.005)
