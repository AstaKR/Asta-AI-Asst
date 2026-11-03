"""Sarvam AI implementation of SpeechProvider.

Endpoints and fields follow https://docs.sarvam.ai (checked 2026-10-21):
  STT realtime  wss://api.sarvam.ai/speech-to-text-realtime/ws   header API-SUBSCRIPTION-KEY
                client {"event": "audio_input", "audio": <b64 linear16>}, {"event": "ping"}, {"event": "end"}
                server session.begin, vad.speech_start, vad.speech_end, transcript.partial, transcript.final,
                       error {code, is_fatal, message}, session.end {audio_duration_s}
  STT legacy    wss://api.sarvam.ai/speech-to-text/ws            header Api-Subscription-Key
                client {"audio": {"data", "sample_rate", "encoding"}}; server {"type": data|events|error, "data"}
  Translate     POST https://api.sarvam.ai/translate             {input, source_language_code, target_language_code, model}
  TTS REST      POST https://api.sarvam.ai/text-to-speech        {text, language_code, speaker, model, speech_sample_rate}
                -> {"audios": [<b64 WAV>]}
  TTS stream    wss://api.sarvam.ai/text-to-speech/ws?model=..&send_completion_event=true
                config/text/flush messages; server {"type": "audio"|"event"|"error"}
  Errors        {"error": {"message", "code"}}; 403 invalid_api_key_error; 429 insufficient_quota_error |
                rate_limit_exceeded_error; 5xx retry with backoff.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import re
from collections.abc import AsyncIterator
from urllib.parse import urlencode

import httpx
import websockets
from websockets.exceptions import ConnectionClosed, InvalidStatus

from ..audio import downmix_to_mono, parse_wav
from ..config import SarvamConfig
from .base import (
    AudioChunk,
    Capabilities,
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    ProviderQuotaError,
    ProviderRateLimitError,
    ProviderRequestError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    SpeechEvent,
    SpeechProvider,
    STTStream,
)

log = logging.getLogger("translation_worker.sarvam")

# Languages supported by all three of saaras (STT), mayura (translate) and bulbul (TTS).
SARVAM_LANGUAGES = frozenset(
    {"bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"}
)
TRANSLATE_CHAR_LIMITS = {"mayura:v1": 1000, "sarvam-translate:v1": 2000}
TTS_SENTENCE_TARGET = 220  # characters; short chunks start playback sooner
_SENTENCE_END = re.compile(r"(?<=[.!?।॥])\s+|\n+")
STT_SEND_BYTES = 3200  # 100 ms of 16 kHz PCM16 per websocket message


def split_sentences(text: str, target: int = TTS_SENTENCE_TARGET) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_END.split(text) if p and p.strip()]
    chunks: list[str] = []
    for part in parts:
        while len(part) > target * 2:  # hard-split very long run-on text at a space
            cut = part.rfind(" ", 0, target * 2)
            cut = cut if cut > 0 else target * 2
            chunks.append(part[:cut].strip())
            part = part[cut:].strip()
        if chunks and len(chunks[-1]) + len(part) + 1 <= target and not _ends_sentence(chunks[-1]):
            chunks[-1] = f"{chunks[-1]} {part}"
        else:
            chunks.append(part)
    return [c for c in chunks if c]


def _ends_sentence(text: str) -> bool:
    return text[-1:] in ".!?।॥"


def _error_from_body(status: int, body: str) -> ProviderError:
    code, message = "", body[:200]
    with contextlib.suppress(Exception):
        err = json.loads(body).get("error", {})
        code, message = err.get("code", ""), err.get("message", message)
    if status == 403 or code == "invalid_api_key_error":
        return ProviderAuthError(f"Sarvam rejected the API key: {message}", code=code)
    if code == "insufficient_quota_error":
        return ProviderQuotaError(f"Sarvam credits exhausted: {message}", code=code)
    if status in (429, 503) or code == "rate_limit_exceeded_error":
        return ProviderRateLimitError(f"Sarvam rate limit: {message}", code=code)
    if status >= 500:
        return ProviderUnavailableError(f"Sarvam server error {status}: {message}", code=code)
    return ProviderRequestError(f"Sarvam rejected the request ({status}): {message}", code=code)


def _error_from_close(code: int | None, reason: str) -> ProviderError | None:
    """Maps websocket close codes to errors. None = normal closure."""
    reason_l = (reason or "").lower()
    if code in (1000, None):
        return None
    if code == 1003:
        if "quota" in reason_l or "credit" in reason_l:
            return ProviderQuotaError(f"Sarvam credits exhausted: {reason}")
        if "key" in reason_l or "auth" in reason_l:
            return ProviderAuthError(f"Sarvam rejected the API key: {reason}")
        return ProviderRateLimitError(f"Sarvam closed the stream (1003): {reason}")
    if code == 4000 or 4000 <= code < 5000:
        return ProviderRequestError(f"Sarvam rejected the stream configuration ({code}): {reason}")
    return ProviderUnavailableError(f"Sarvam stream closed ({code}): {reason}")


def _error_from_handshake(exc: Exception) -> ProviderError:
    if isinstance(exc, InvalidStatus):
        status = exc.response.status_code
        body = exc.response.body.decode(errors="replace") if exc.response.body else ""
        return _error_from_body(status, body)
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return ProviderTimeoutError("Timed out connecting to Sarvam")
    return ProviderUnavailableError(f"Could not connect to Sarvam: {exc.__class__.__name__}")


class _SarvamSTTBase(STTStream):
    def __init__(self, ws, provider: SarvamProvider, sample_rate: int):
        self._ws = ws
        self._provider = provider
        self._sample_rate = sample_rate
        self._queue: asyncio.Queue[SpeechEvent | ProviderError | None] = asyncio.Queue()
        self._buffer = bytearray()
        self._closed = False
        self._error: ProviderError | None = None
        self._reader = asyncio.create_task(self._read_loop())
        self._keepalive = asyncio.create_task(self._keepalive_loop())

    @property
    def closed(self) -> bool:
        return self._closed

    async def push_audio(self, pcm: bytes) -> None:
        if self._error is not None:
            raise self._error
        if self._closed:
            raise ProviderUnavailableError("STT stream is closed")
        self._buffer.extend(pcm)
        while len(self._buffer) >= STT_SEND_BYTES:
            chunk = bytes(self._buffer[:STT_SEND_BYTES])
            del self._buffer[:STT_SEND_BYTES]
            try:
                await self._ws.send(json.dumps(self._audio_message(base64.b64encode(chunk).decode())))
            except ConnectionClosed as exc:
                self._fail(_error_from_close(exc.rcvd.code if exc.rcvd else 1006, exc.rcvd.reason if exc.rcvd else "")
                           or ProviderUnavailableError("STT stream closed"))
                raise self._error from exc
            self._provider.usage.stt_seconds += len(chunk) / 2 / self._sample_rate

    def _audio_message(self, b64: str) -> dict:
        raise NotImplementedError

    def _ping_message(self) -> dict | None:
        return None

    def _end_message(self) -> dict | None:
        return None

    def _handle(self, msg: dict) -> None:
        raise NotImplementedError

    def _emit(self, event: SpeechEvent) -> None:
        self._queue.put_nowait(event)

    def _fail(self, error: ProviderError) -> None:
        if self._error is None:
            self._error = error
            self._provider.usage.errors += 1
            self._queue.put_nowait(error)
        self._closed = True

    async def _read_loop(self) -> None:
        try:
            async for raw in self._ws:
                if isinstance(raw, bytes):
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                self._handle(msg)
            rcvd = self._ws.close_code
            err = _error_from_close(rcvd, getattr(self._ws, "close_reason", "") or "")
            if err is not None and not self._closed:
                self._fail(err)
        except ConnectionClosed as exc:
            err = _error_from_close(exc.rcvd.code if exc.rcvd else 1006, exc.rcvd.reason if exc.rcvd else "")
            if err is not None and not self._closed:
                self._fail(err)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # defensive: never let the reader die silently
            self._fail(ProviderUnavailableError(f"STT reader failed: {exc.__class__.__name__}"))
        finally:
            self._closed = True
            self._queue.put_nowait(None)

    async def _keepalive_loop(self) -> None:
        msg = self._ping_message()
        if msg is None:
            return
        with contextlib.suppress(Exception):
            while not self._closed:
                await asyncio.sleep(15)
                await self._ws.send(json.dumps(msg))

    async def events(self) -> AsyncIterator[SpeechEvent]:
        while True:
            item = await self._queue.get()
            if item is None:
                return
            if isinstance(item, ProviderError):
                raise item
            yield item

    async def aclose(self) -> None:
        if not self._closed:
            self._closed = True
            end = self._end_message()
            if end is not None:
                with contextlib.suppress(Exception):
                    await self._ws.send(json.dumps(end))
        self._keepalive.cancel()
        with contextlib.suppress(Exception):
            await asyncio.wait_for(self._ws.close(), timeout=2)
        self._reader.cancel()
        with contextlib.suppress(BaseException):
            await self._reader


class SarvamRealtimeSTT(_SarvamSTTBase):
    def __init__(self, ws, provider, sample_rate):
        super().__init__(ws, provider, sample_rate)
        self.billed_audio_seconds: float | None = None

    def _audio_message(self, b64: str) -> dict:
        return {"event": "audio_input", "audio": b64}

    def _ping_message(self) -> dict:
        return {"event": "ping"}

    def _end_message(self) -> dict:
        return {"event": "end"}

    def _handle(self, msg: dict) -> None:
        kind = msg.get("type") or msg.get("event") or ""
        data = msg.get("data") if isinstance(msg.get("data"), dict) else msg
        utt = str(data.get("utterance_idx", ""))
        if kind == "vad.speech_start":
            self._emit(SpeechEvent("speech_start", utterance_id=utt))
        elif kind == "vad.speech_end":
            self._emit(SpeechEvent("speech_end", utterance_id=utt))
        elif kind == "transcript.partial":
            self._emit(SpeechEvent("partial", text=data.get("text", ""), utterance_id=utt, language=data.get("language")))
        elif kind == "transcript.final":
            self._emit(SpeechEvent("final", text=data.get("text", ""), utterance_id=utt, language=data.get("language")))
        elif kind == "session.end":
            self.billed_audio_seconds = data.get("audio_duration_s")
        elif kind == "error":
            message = str(data.get("message", "STT error"))[:200]
            if data.get("is_fatal"):
                status = int(data.get("status_code") or 0)
                self._fail(_error_from_body(status, json.dumps({"error": {"code": data.get("code", ""), "message": message}}))
                           if status else ProviderRequestError(message, code=str(data.get("code", ""))))
            else:
                log.warning("Sarvam STT non-fatal error code=%s", data.get("code"))


class SarvamLegacySTT(_SarvamSTTBase):
    def __init__(self, ws, provider, sample_rate):
        super().__init__(ws, provider, sample_rate)
        self._utterance = 0

    def _audio_message(self, b64: str) -> dict:
        return {"audio": {"data": b64, "sample_rate": str(self._sample_rate), "encoding": "audio/wav"}}

    def _handle(self, msg: dict) -> None:
        kind = msg.get("type")
        data = msg.get("data") or {}
        if kind == "events":
            signal = data.get("signal_type")
            if signal == "START_SPEECH":
                self._utterance += 1
                self._emit(SpeechEvent("speech_start", utterance_id=str(self._utterance)))
            elif signal == "END_SPEECH":
                self._emit(SpeechEvent("speech_end", utterance_id=str(self._utterance)))
        elif kind == "data":
            self._emit(SpeechEvent("final", text=data.get("transcript", ""), utterance_id=str(self._utterance),
                                   language=data.get("language_code")))
        elif kind == "error":
            self._fail(ProviderRequestError(str(data.get("error", "STT error"))[:200], code=str(data.get("code", ""))))


class SarvamProvider(SpeechProvider):
    name = "sarvam"
    stt_sample_rate = 16000

    def __init__(self, cfg: SarvamConfig, *, http: httpx.AsyncClient | None = None, ws_connect=None):
        super().__init__()
        if not cfg.api_key:
            raise ProviderConfigError(
                "SARVAM_API_KEY is not set. Add it to .env or set TRANSLATION_ENABLED=false to run calls without AI."
            )
        if cfg.stt_api not in ("realtime", "legacy"):
            raise ProviderConfigError(f"SARVAM_STT_API must be realtime or legacy, got {cfg.stt_api!r}")
        if cfg.tts_mode not in ("rest", "stream"):
            raise ProviderConfigError(f"SARVAM_TTS_MODE must be rest or stream, got {cfg.tts_mode!r}")
        self.cfg = cfg
        self._http = http or httpx.AsyncClient(base_url=cfg.base_url, timeout=cfg.timeout)
        self._ws_connect = ws_connect or websockets.connect
        self.capabilities = Capabilities(
            streaming_stt=True,
            partial_transcripts=cfg.stt_api == "realtime",
            streaming_tts=cfg.tts_mode == "stream",
            languages=SARVAM_LANGUAGES,
        )

    # ---------- STT ----------

    async def open_stt_stream(self, language: str) -> STTStream:
        """`language` may be "auto": the provider detects it and reports it on each transcript."""
        auto = language == "auto"
        if not auto and not self.supports_language(language):
            raise ProviderRequestError(f"Unsupported language {language}")
        if self.cfg.stt_api == "realtime":
            query = {
                "language_code": language,
                "model": self.cfg.stt_model,
                "stream_type": self.cfg.stt_stream_type,
                "mode": "transcribe",
                "endpointing": "vad",
                "encoding": "linear16",
                "sample_rate": str(self.stt_sample_rate),
                "silence_duration_ms": str(self.cfg.stt_silence_ms),
            }
            url = f"{self.cfg.ws_base_url}/speech-to-text-realtime/ws?{urlencode(query)}"
            headers = {"API-SUBSCRIPTION-KEY": self.cfg.api_key}
            cls = SarvamRealtimeSTT
        else:
            query = {
                "language-code": "unknown" if auto else language,
                "model": self.cfg.stt_model if self.cfg.stt_model.startswith("saaras:v") and "realtime" not in self.cfg.stt_model else "saaras:v3",
                "mode": "transcribe",
                "sample_rate": str(self.stt_sample_rate),
                "input_audio_codec": "pcm_s16le",
                "high_vad_sensitivity": "true",
                "vad_signals": "true",
            }
            url = f"{self.cfg.ws_base_url}/speech-to-text/ws?{urlencode(query)}"
            headers = {"Api-Subscription-Key": self.cfg.api_key}
            cls = SarvamLegacySTT
        self.usage.requests += 1
        try:
            ws = await self._ws_connect(url, additional_headers=headers, open_timeout=self.cfg.timeout, max_size=2**22)
        except Exception as exc:
            self.usage.errors += 1
            raise _error_from_handshake(exc) from None
        return cls(ws, self, self.stt_sample_rate)

    # ---------- HTTP helpers ----------

    async def _post(self, path: str, payload: dict) -> dict:
        headers = {"api-subscription-key": self.cfg.api_key}
        for attempt in range(2):
            self.usage.requests += 1
            try:
                resp = await self._http.post(path, json=payload, headers=headers)
            except httpx.TimeoutException:
                self.usage.errors += 1
                error: ProviderError = ProviderTimeoutError(f"Sarvam {path} timed out")
            except httpx.HTTPError as exc:
                self.usage.errors += 1
                error = ProviderUnavailableError(f"Sarvam {path} failed: {exc.__class__.__name__}")
            else:
                if resp.status_code < 400:
                    return resp.json()
                self.usage.errors += 1
                error = _error_from_body(resp.status_code, resp.text)
            if not error.retryable or attempt == 1:
                raise error
            await asyncio.sleep(0.4)
        raise AssertionError("unreachable")

    # ---------- Translation ----------

    async def translate(self, text: str, source_language: str, target_language: str) -> str:
        text = text.strip()
        if not text or source_language == target_language:
            return text
        for lang in (source_language, target_language):
            if not self.supports_language(lang):
                raise ProviderRequestError(f"Unsupported language {lang}")
        limit = TRANSLATE_CHAR_LIMITS.get(self.cfg.translate_model, 1000)
        pieces = [text] if len(text) <= limit else split_sentences(text, target=limit // 2)
        out = []
        for piece in pieces:
            payload = {
                "input": piece,
                "source_language_code": source_language,
                "target_language_code": target_language,
                "model": self.cfg.translate_model,
            }
            if self.cfg.translate_mode:
                payload["mode"] = self.cfg.translate_mode
            data = await self._post("/translate", payload)
            self.usage.translate_chars += len(piece)
            out.append(data.get("translated_text", ""))
        return " ".join(p for p in out if p).strip()

    # ---------- TTS ----------

    def synthesize(self, text: str, language: str, voice: str | None) -> AsyncIterator[AudioChunk]:
        if self.cfg.tts_mode == "stream":
            return self._synthesize_stream(text, language, voice or self.cfg.default_speaker)
        return self._synthesize_rest(text, language, voice or self.cfg.default_speaker)

    async def _tts_rest_one(self, sentence: str, language: str, voice: str) -> AudioChunk:
        data = await self._post(
            "/text-to-speech",
            {
                "text": sentence,
                "language_code": language,
                "speaker": voice,
                "model": self.cfg.tts_model,
                "speech_sample_rate": self.cfg.tts_sample_rate,
            },
        )
        self.usage.tts_chars += len(sentence)
        pcm_all, rate = bytearray(), self.cfg.tts_sample_rate
        for b64 in data.get("audios") or []:
            pcm, rate, channels = parse_wav(base64.b64decode(b64))
            pcm_all.extend(downmix_to_mono(pcm, channels))
        return AudioChunk(bytes(pcm_all), rate)

    async def _synthesize_rest(self, text: str, language: str, voice: str) -> AsyncIterator[AudioChunk]:
        sentences = split_sentences(text)
        if not sentences:
            return
        # Pipeline: request sentence i+1 while sentence i is being played.
        pending = asyncio.create_task(self._tts_rest_one(sentences[0], language, voice))
        try:
            for i in range(len(sentences)):
                chunk = await pending
                if i + 1 < len(sentences):
                    pending = asyncio.create_task(self._tts_rest_one(sentences[i + 1], language, voice))
                if chunk.pcm:
                    yield chunk
        finally:
            if not pending.done():
                pending.cancel()
                with contextlib.suppress(BaseException):
                    await pending

    async def _synthesize_stream(self, text: str, language: str, voice: str) -> AsyncIterator[AudioChunk]:
        # The docs state MP3 is currently the only streaming codec, so decode MP3 -> PCM locally.
        from livekit.agents.utils.codecs import AudioStreamDecoder

        query = urlencode({"model": self.cfg.tts_model, "send_completion_event": "true"})
        self.usage.requests += 1
        try:
            ws = await self._ws_connect(
                f"{self.cfg.ws_base_url}/text-to-speech/ws?{query}",
                additional_headers={"Api-Subscription-Key": self.cfg.api_key},
                open_timeout=self.cfg.timeout,
                max_size=2**24,
            )
        except Exception as exc:
            self.usage.errors += 1
            raise _error_from_handshake(exc) from None
        decoder = AudioStreamDecoder(sample_rate=self.cfg.tts_sample_rate, num_channels=1)
        failure: list[ProviderError] = []

        async def pump():
            try:
                await ws.send(json.dumps({"type": "config", "data": {
                    "language_code": language,
                    "speaker": voice,
                    "speech_sample_rate": str(self.cfg.tts_sample_rate),
                    "output_audio_codec": "mp3",
                    "min_buffer_size": 30,
                    "max_chunk_length": 150,
                }}))
                await ws.send(json.dumps({"type": "text", "data": {"text": text}}))
                await ws.send(json.dumps({"type": "flush"}))
                self.usage.tts_chars += len(text)
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg.get("type") == "audio":
                        decoder.push(base64.b64decode(msg["data"]["audio"]))
                    elif msg.get("type") == "event" and msg.get("data", {}).get("event_type") == "final":
                        break
                    elif msg.get("type") == "error":
                        failure.append(ProviderRequestError(str(msg.get("data", {}).get("message", "TTS error"))[:200]))
                        break
            except ConnectionClosed as exc:
                err = _error_from_close(exc.rcvd.code if exc.rcvd else 1006, exc.rcvd.reason if exc.rcvd else "")
                if err:
                    failure.append(err)
            finally:
                decoder.end_input()

        pump_task = asyncio.create_task(pump())
        try:
            async for frame in decoder:
                yield AudioChunk(bytes(frame.data), frame.sample_rate)
            await pump_task
            if failure:
                self.usage.errors += 1
                raise failure[0]
        finally:
            pump_task.cancel()
            with contextlib.suppress(BaseException):
                await pump_task
            with contextlib.suppress(Exception):
                await ws.close()
            with contextlib.suppress(Exception):
                await decoder.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()
