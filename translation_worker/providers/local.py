"""Free local provider: the open-source models of the local AI service (local_ai/ at the repo root).

The local models are not streaming, so calls run turn by turn: this stream detects the end of each
utterance itself (energy + trailing silence), sends that utterance to the service for recognition, and
emits `final` events in order. There are no partial transcripts. Latency depends on the CPU — measure it
on the target machine before calling it real-time (see docs/LOCAL_AI.md).
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import logging
import wave
from collections.abc import AsyncIterator

import httpx

from ..audio import downmix_to_mono, parse_wav, rms_dbfs
from ..config import LocalAIConfig
from .base import (
    AudioChunk,
    Capabilities,
    ProviderConfigError,
    ProviderError,
    ProviderRequestError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    SpeechEvent,
    SpeechProvider,
    STTStream,
)
from .sarvam import split_sentences

log = logging.getLogger(__name__)
LOCAL_LANGUAGES = frozenset({"ta-IN", "hi-IN", "en-IN"})
RATE = 16000
_DONE = object()


def _wav(pcm: bytes, rate: int = RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


class LocalTurnSTT(STTStream):
    """Cuts the incoming audio into utterances and recognises each one with the local service."""

    def __init__(self, provider: LocalProvider, language: str):
        cfg = provider.cfg
        self.provider = provider
        self.language = language
        self.threshold = cfg.vad_threshold_dbfs
        self.silence_bytes = int(RATE * cfg.end_silence_ms / 1000) * 2
        self.max_bytes = int(RATE * cfg.max_utterance_seconds) * 2
        self.min_bytes = int(RATE * cfg.min_utterance_ms / 1000) * 2
        self._buf = bytearray()
        self._in_speech = False
        self._silence = 0
        self._utt = 0
        self._events: asyncio.Queue = asyncio.Queue()
        self._jobs: asyncio.Queue = asyncio.Queue()
        self._error: ProviderError | None = None
        self._closed = False
        self._worker = asyncio.create_task(self._recognise_loop(), name="local stt")

    @property
    def closed(self) -> bool:
        return self._closed

    async def push_audio(self, pcm: bytes) -> None:
        if self._closed:
            raise self._error or ProviderUnavailableError("Local speech recognition stream is closed.")
        loud = rms_dbfs(pcm) >= self.threshold
        if loud and not self._in_speech:
            self._in_speech = True
            self._utt += 1
            self._events.put_nowait(SpeechEvent("speech_start", utterance_id=str(self._utt)))
        if not self._in_speech:
            return
        self._buf.extend(pcm)
        self._silence = 0 if loud else self._silence + len(pcm)
        if self._silence >= self.silence_bytes or len(self._buf) >= self.max_bytes:
            self._end_utterance()

    def _end_utterance(self) -> None:
        utt = str(self._utt)
        audio = bytes(self._buf[: len(self._buf) - min(self._silence, len(self._buf))])  # drop trailing silence
        self._buf.clear()
        self._in_speech = False
        self._silence = 0
        self._events.put_nowait(SpeechEvent("speech_end", utterance_id=utt))
        self._jobs.put_nowait((utt, audio))

    async def _recognise_loop(self) -> None:
        while True:
            utt, audio = await self._jobs.get()
            if len(audio) < self.min_bytes:  # a click or cough: nothing to recognise
                self._events.put_nowait(SpeechEvent("final", text="", utterance_id=utt))
                continue
            try:
                text, language = await self.provider.recognise(audio, self.language)
            except ProviderError as exc:
                self._fail(exc)
                return
            self._events.put_nowait(SpeechEvent("final", text=text, utterance_id=utt, language=language))

    def _fail(self, exc: ProviderError) -> None:
        self._error = exc
        self._closed = True
        self._events.put_nowait(_DONE)

    async def events(self) -> AsyncIterator[SpeechEvent]:
        while True:
            ev = await self._events.get()
            if ev is _DONE:
                if self._error:
                    raise self._error
                return
            yield ev

    async def aclose(self) -> None:
        if not self._closed:
            self._closed = True
            self._events.put_nowait(_DONE)
        self._worker.cancel()
        with contextlib.suppress(BaseException):
            await self._worker


class LocalProvider(SpeechProvider):
    name = "local"
    stt_sample_rate = RATE

    def __init__(self, cfg: LocalAIConfig, *, http: httpx.AsyncClient | None = None):
        super().__init__()
        if not cfg.url and http is None:
            raise ProviderConfigError("LOCAL_AI_URL is not set. Start the local AI service (python -m local_ai.server).")
        self.cfg = cfg
        headers = {"X-Local-AI-Secret": cfg.secret} if cfg.secret else {}
        self._http = http or httpx.AsyncClient(base_url=cfg.url.rstrip("/"), timeout=cfg.timeout, headers=headers)
        self.capabilities = Capabilities(streaming_stt=False, partial_transcripts=False, streaming_tts=False, languages=LOCAL_LANGUAGES)

    async def _call(self, path: str, **kwargs) -> httpx.Response:
        self.usage.requests += 1
        try:
            resp = await self._http.post(path, **kwargs)
        except httpx.TimeoutException as exc:
            self.usage.errors += 1
            raise ProviderTimeoutError("Local AI service timed out.") from exc
        except httpx.HTTPError as exc:
            self.usage.errors += 1
            raise ProviderUnavailableError("Local AI service is not reachable.") from exc
        if resp.status_code < 400:
            return resp
        self.usage.errors += 1
        try:
            detail = resp.json().get("detail", "")
        except ValueError:
            detail = resp.text[:200]
        if resp.status_code == 503:
            raise ProviderConfigError(f"Local AI: {detail}")
        if resp.status_code >= 500:
            raise ProviderUnavailableError(f"Local AI error: {detail}")
        raise ProviderRequestError(f"Local AI rejected the request: {detail}")

    # ---------- STT ----------

    async def open_stt_stream(self, language: str) -> STTStream:
        if language != "auto" and not self.supports_language(language):
            raise ProviderRequestError(f"Unsupported language {language}")
        return LocalTurnSTT(self, language)

    async def recognise(self, pcm: bytes, language: str) -> tuple[str, str | None]:
        params = {"fast": "1"}
        if language != "auto":
            params["language"] = language
        data = (await self._call("/v1/transcribe", content=_wav(pcm), params=params, headers={"Content-Type": "audio/wav"})).json()
        text = " ".join(s["text"] for s in data.get("segments", [])).strip()
        detected = data.get("language")
        return text, (f"{detected}-IN" if detected else (None if language == "auto" else language))

    # ---------- translation ----------

    async def translate(self, text: str, source_language: str, target_language: str) -> str:
        text = text.strip()
        if not text or source_language == target_language:
            return text
        for lang in (source_language, target_language):
            if not self.supports_language(lang):
                raise ProviderRequestError(f"Unsupported language {lang}")
        data = (await self._call("/v1/translate", json={"text": text, "source": source_language, "target": target_language})).json()
        return data.get("translation", "").strip()

    # ---------- TTS ----------

    def synthesize(self, text: str, language: str, voice: str | None) -> AsyncIterator[AudioChunk]:
        # Sarvam voice names do not apply here; the service uses the model card's recommended voice.
        return self._synthesize(text, language)

    async def _tts_one(self, sentence: str, language: str) -> AudioChunk:
        resp = await self._call("/v1/tts", json={"text": sentence, "language": language})
        pcm, rate, channels = parse_wav(resp.content)
        return AudioChunk(downmix_to_mono(pcm, channels), rate)

    async def _synthesize(self, text: str, language: str) -> AsyncIterator[AudioChunk]:
        sentences = split_sentences(text)
        if not sentences:
            return
        # Request sentence i+1 while sentence i is being played.
        pending = asyncio.create_task(self._tts_one(sentences[0], language))
        try:
            for i in range(len(sentences)):
                chunk = await pending
                if i + 1 < len(sentences):
                    pending = asyncio.create_task(self._tts_one(sentences[i + 1], language))
                if chunk.pcm:
                    yield chunk
        finally:
            if not pending.done():
                pending.cancel()
                with contextlib.suppress(BaseException):
                    await pending

    async def aclose(self) -> None:
        await self._http.aclose()
