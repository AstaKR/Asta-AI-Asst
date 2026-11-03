"""One translation direction: speaker microphone -> STT -> translate -> TTS -> listener's translated track.

Each direction is independent (Flow A and Flow B in the spec are two instances of this class).
This module depends only on the provider interface and small Protocols, so it is fully testable
without LiveKit or network access.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Protocol

from .audio import EnergyGate
from .echo_guard import EchoGuard, normalize
from .metrics import LatencyStats, UtteranceTiming
from .providers.base import (
    AudioChunk,
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    ProviderQuotaError,
    ProviderTimeoutError,
    SpeechEvent,
    SpeechProvider,
    STTStream,
)
from .routing import AUTO, Route

log = logging.getLogger("translation_worker.pipeline")


class AudioOutput(Protocol):
    async def push(self, chunk: AudioChunk) -> None: ...

    def clear(self) -> None: ...


class Notifier(Protocol):
    async def send(self, payload: dict, destinations: list[str]) -> None: ...


@dataclass
class Counters:
    utterances: int = 0
    dropped_utterances: int = 0
    echo_dropped: int = 0
    reconnects: int = 0
    interruptions: int = 0


class UsageGate:
    """Single switch that stops all paid processing for a call (limits, exhausted credits, auth failure)."""

    def __init__(self, provider_usage, per_call_limits: dict[str, float] | None = None):
        self._usage = provider_usage
        self._limits = per_call_limits or {}
        self.reason = ""

    def stop(self, reason: str) -> None:
        if not self.reason:
            self.reason = reason

    @property
    def allowed(self) -> bool:
        if self.reason:
            return False
        for key, attr in (("stt_seconds", "stt_seconds"), ("tts_chars", "tts_chars"), ("translate_chars", "translate_chars")):
            limit = self._limits.get(key)
            if limit is not None and getattr(self._usage, attr) >= limit:
                self.reason = f"per_call_{key}_limit"
                return False
        return True


@dataclass
class DirectionSettings:
    local_gate: bool = True
    gate_threshold_dbfs: float = -45.0
    max_pending: int = 2
    request_timeout_s: float = 15.0
    tts_chunk_timeout_s: float = 10.0
    reconnect_backoff_s: tuple[float, ...] = (0.5, 1.0, 2.0, 4.0, 8.0)
    max_consecutive_failures: int = 6
    duplicate_window_s: float = 2.0


@dataclass
class _Utterance:
    id: str
    text: str
    timing: UtteranceTiming
    language: str  # detected language for AUTO routes, otherwise the route's source language
    seq: int = 0
    start_wall: float = 0.0  # epoch seconds (for saved transcripts)
    end_wall: float = 0.0


@dataclass
class _State:
    speech_end_at: dict[str, float] = field(default_factory=dict)
    barged_in: set[str] = field(default_factory=set)
    last_final: tuple[str, float] = ("", 0.0)
    start_wall: dict[str, float] = field(default_factory=dict)
    end_wall: dict[str, float] = field(default_factory=dict)


class TranslationDirection:
    def __init__(
        self,
        route: Route,
        provider: SpeechProvider,
        output: AudioOutput,
        notifier: Notifier,
        *,
        echo_guard: EchoGuard,
        usage_gate: UsageGate,
        stats: LatencyStats,
        counters: Counters,
        settings: DirectionSettings | None = None,
        on_barge_in: Callable[[str], None] | None = None,
        on_language_detected: Callable[[str, str], None] | None = None,
        on_segment: Callable[[dict], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
    ):
        self.route = route
        self.provider = provider
        self.output = output
        self.notifier = notifier
        self.echo_guard = echo_guard
        self.usage_gate = usage_gate
        self.stats = stats
        self.counters = counters
        self.settings = settings or DirectionSettings()
        self.on_barge_in = on_barge_in
        self.on_language_detected = on_language_detected
        self.on_segment = on_segment  # finalized utterances, for saved transcripts (consent-gated by the caller)
        self.clock = clock
        self.wall_clock = wall_clock
        self.label = f"{route.speaker}->{route.listener} {route.source_language}->{route.target_language}"
        self._gate = (
            EnergyGate(provider.stt_sample_rate, threshold_dbfs=self.settings.gate_threshold_dbfs)
            if self.settings.local_gate
            else None
        )
        self._queue: asyncio.Queue[_Utterance] = asyncio.Queue()
        self._stt: STTStream | None = None
        self._events_task: asyncio.Task | None = None
        self._current: asyncio.Task | None = None
        self._proc_task: asyncio.Task | None = None
        self._closing = False
        self._fatal: ProviderError | None = None
        self._failures = 0
        self._next_open_at = 0.0
        self._seq = 0
        self._state = _State()
        self.stopped_reason = ""

    # ---------- public ----------

    @property
    def participants(self) -> list[str]:
        return [self.route.speaker, self.route.listener]

    async def run(self, frames: AsyncIterator[bytes]) -> None:
        """Consumes mono PCM16 frames at provider.stt_sample_rate until the track ends or the direction stops."""
        self._proc_task = asyncio.create_task(self._process_loop(), name=f"process {self.label}")
        try:
            await self._status("idle")
            async for pcm in frames:
                if self.stopped_reason:
                    break
                await self._handle_frame(pcm)
        finally:
            await self.close()

    def interrupt(self) -> None:
        """Barge-in: stop the translation currently playing to this direction's listener."""
        if self._current is not None and not self._current.done():
            self.counters.interruptions += 1
            self._current.cancel()
        self.output.clear()

    async def close(self) -> None:
        self._closing = True
        for task in (self._current, self._proc_task, self._events_task):
            if task is not None and not task.done():
                task.cancel()
        for task in (self._current, self._proc_task, self._events_task):
            if task is not None:
                with contextlib.suppress(BaseException):
                    await task
        if self._stt is not None:
            with contextlib.suppress(Exception):
                await self._stt.aclose()
            self._stt = None

    # ---------- audio in ----------

    async def _handle_frame(self, pcm: bytes) -> None:
        to_send = self._gate.process(pcm) if self._gate else pcm
        if not to_send:
            return
        if not self.usage_gate.allowed:
            await self._stop(self.usage_gate.reason, state="limit")
            return
        if self._stt is None or self._stt.closed:
            if self.clock() < self._next_open_at:
                return  # backing off after a failure; drop audio meanwhile
            if not await self._open_stt():
                return
        try:
            await self._stt.push_audio(to_send)
        except ProviderError as exc:
            await self._on_stt_error(exc)

    async def _open_stt(self) -> bool:
        reconnect = self._stt is not None or self._failures > 0
        try:
            self._stt = await self.provider.open_stt_stream(self.route.source_language)
        except ProviderError as exc:
            self._stt = None
            await self._on_stt_error(exc)
            return False
        if reconnect:
            self.counters.reconnects += 1
        self._events_task = asyncio.create_task(self._consume_events(self._stt), name=f"stt events {self.label}")
        return True

    async def _on_stt_error(self, exc: ProviderError) -> None:
        if self._stt is not None:
            with contextlib.suppress(Exception):
                await self._stt.aclose()
        if not exc.retryable:
            await self._fail(exc)
            return
        self._failures += 1
        if self._failures > self.settings.max_consecutive_failures:
            await self._fail(exc)
            return
        backoff = self.settings.reconnect_backoff_s
        self._next_open_at = self.clock() + backoff[min(self._failures - 1, len(backoff) - 1)]
        log.warning("STT %s failed (%s); reconnecting", self.label, exc.__class__.__name__)
        await self._status("reconnecting", message="Speech recognition reconnecting")

    async def _consume_events(self, stt: STTStream) -> None:
        try:
            async for event in stt.events():
                await self._on_event(event)
        except ProviderError as exc:
            if stt is self._stt:
                await self._on_stt_error(exc)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("unexpected error handling STT events for %s", self.label)

    async def _on_event(self, ev: SpeechEvent) -> None:
        self._failures = 0  # a live stream producing events resets the failure counter
        if ev.type == "speech_start":
            self._state.start_wall[ev.utterance_id] = self.wall_clock()
            await self._status("listening")
        elif ev.type == "speech_end":
            self._state.speech_end_at[ev.utterance_id] = ev.at
            self._state.end_wall[ev.utterance_id] = self.wall_clock()
            await self._status("transcribing")
        elif ev.type == "partial":
            text = ev.text.strip()
            if not text or self.echo_guard.is_echo(self.route.speaker, text):
                return
            self._maybe_barge_in(ev.utterance_id, text)
            await self._subtitle("partial", ev.utterance_id, text, self.route.source_language)
        elif ev.type == "final":
            await self._on_final(ev)

    def _maybe_barge_in(self, utterance_id: str, text: str) -> None:
        if self.on_barge_in is None or utterance_id in self._state.barged_in:
            return
        if len(normalize(text)) >= 3:
            self._state.barged_in.add(utterance_id)
            self.on_barge_in(self.route.speaker)

    async def _on_final(self, ev: SpeechEvent) -> None:
        text = ev.text.strip()
        speech_end_at = self._state.speech_end_at.pop(ev.utterance_id, None)
        now_wall = self.wall_clock()
        end_wall = self._state.end_wall.pop(ev.utterance_id, now_wall)
        start_wall = self._state.start_wall.pop(ev.utterance_id, end_wall - max(1.0, len(text) / 15))
        if not text:
            return
        if self.echo_guard.is_echo(self.route.speaker, text):
            self.counters.echo_dropped += 1
            log.info("dropped echo utterance on %s", self.label)
            return
        last_text, last_at = self._state.last_final
        if normalize(text) == normalize(last_text) and ev.at - last_at < self.settings.duplicate_window_s:
            return  # unchanged text: never pay to translate/synthesise it twice
        self._state.last_final = (text, ev.at)
        self._maybe_barge_in(ev.utterance_id, text)
        language = self.route.source_language
        if language == AUTO:
            language = ev.language if ev.language and self.provider.supports_language(ev.language) else AUTO
            if language != AUTO and self.on_language_detected is not None:
                self.on_language_detected(self.route.speaker, language)
        self.counters.utterances += 1
        self._seq += 1
        utt = _Utterance(
            id=f"{self.route.speaker}:{ev.utterance_id or self._seq}:{self._seq}",
            text=text,
            timing=UtteranceTiming(utterance_id=ev.utterance_id, speech_end_at=speech_end_at, final_at=ev.at),
            language=language,
            seq=self._seq,
            start_wall=start_wall,
            end_wall=end_wall,
        )
        await self._subtitle("final", utt.id, text, language)
        self._report(utt)
        if self.route.transcribe_only:
            await self._status("idle")
            return  # live meeting without translation: the transcript is all we need
        while self._queue.qsize() >= self.settings.max_pending:
            stale = self._queue.get_nowait()
            self.counters.dropped_utterances += 1
            await self._subtitle("skipped", stale.id, stale.text, self.route.source_language)
        self._queue.put_nowait(utt)

    # ---------- translate + speak ----------

    async def _process_loop(self) -> None:
        while True:
            utt = await self._queue.get()
            self._current = asyncio.create_task(self._process(utt), name=f"utterance {utt.id}")
            try:
                await self._current
            except asyncio.CancelledError:
                if self._closing:
                    raise
                await self._status("interrupted")
            except ProviderError as exc:
                if exc.retryable:
                    log.warning("utterance failed on %s: %s", self.label, exc.__class__.__name__)
                    await self._status("error", message="Translation failed for one sentence; continuing")
                else:
                    await self._fail(exc)
                    return
            finally:
                self._current = None

    async def _process(self, utt: _Utterance) -> None:
        if not self.usage_gate.allowed:
            await self._stop(self.usage_gate.reason, state="limit")
            return
        t = utt.timing
        if utt.language == AUTO:
            await self._status("error", message="Could not detect the caller's language for one sentence")
            return
        if utt.language == self.route.target_language:
            # Detected speech is already in the listener's language: no translation or synthesis needed.
            await self._subtitle("translation", utt.id, utt.text, utt.language, original=utt.text)
            await self._status("idle")
            return
        await self._status("translating")
        t.translate_started_at = self.clock()
        try:
            translated = await asyncio.wait_for(
                self.provider.translate(utt.text, utt.language, self.route.target_language),
                timeout=self.settings.request_timeout_s,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError("translation timed out") from None
        t.translate_done_at = self.clock()
        translated = translated.strip()
        if not translated:
            return
        await self._subtitle("translation", utt.id, translated, self.route.target_language, original=utt.text)
        self._report(utt, translated)
        if not self.route.speak:
            await self._status("idle")
            return  # subtitles only: no paid speech synthesis
        if not self.usage_gate.allowed:
            await self._stop(self.usage_gate.reason, state="limit")
            return
        await self._status("speaking")
        self.echo_guard.record_played(self.route.listener, translated)
        t.tts_started_at = self.clock()
        stream = self.provider.synthesize(translated, self.route.target_language, self.route.voice or None)
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(anext(stream), timeout=self.settings.tts_chunk_timeout_s)
                except StopAsyncIteration:
                    break
                except asyncio.TimeoutError:
                    raise ProviderTimeoutError("speech synthesis stalled") from None
                if t.first_audio_at is None:
                    t.first_audio_at = self.clock()
                await self.output.push(chunk)
                t.last_audio_at = self.clock()
        finally:
            with contextlib.suppress(BaseException):
                await stream.aclose()
        result = t.record(self.stats, self.label)
        await self.notifier.send(
            {"type": "metrics", "utterance_id": utt.id, "speaker": self.route.speaker, **{k: round(v) for k, v in result.items()}},
            self.participants,
        )
        await self._status("idle")

    # ---------- notifications & stopping ----------

    def _report(self, utt: _Utterance, translation: str | None = None) -> None:
        if self.on_segment is None:
            return
        self.on_segment(
            {
                "utterance_id": utt.id,
                "speaker_identity": self.route.speaker,
                "language": utt.language if utt.language != AUTO else "",
                "text": utt.text,
                "translation": translation or "",
                "translation_language": self.route.target_language if translation else "",
                "start_epoch_ms": int(utt.start_wall * 1000),
                "end_epoch_ms": int(max(utt.end_wall, utt.start_wall) * 1000),
            }
        )

    async def _subtitle(self, stage: str, utterance_id: str, text: str, language: str, original: str | None = None) -> None:
        payload = {
            "type": "subtitle",
            "stage": stage,
            "utterance_id": utterance_id,
            "speaker": self.route.speaker,
            "listener": self.route.listener,
            "language": language,
            "text": text,
        }
        if original is not None:
            payload["original"] = original
        await self.notifier.send(payload, self.participants)

    async def _status(self, state: str, message: str = "") -> None:
        await self.notifier.send(
            {"type": "status", "state": state, "speaker": self.route.speaker, "listener": self.route.listener, "message": message},
            self.participants,
        )

    async def _fail(self, exc: ProviderError) -> None:
        self._fatal = exc
        if isinstance(exc, ProviderQuotaError):
            self.usage_gate.stop("provider_credits_exhausted")
            await self._stop("provider_credits_exhausted", state="limit", message="AI translation credits are exhausted.")
        elif isinstance(exc, (ProviderAuthError, ProviderConfigError)):
            self.usage_gate.stop("provider_auth_failed")
            await self._stop("provider_auth_failed", state="error", message="The AI provider rejected the server's credentials.")
        else:
            await self._stop("provider_error", state="error", message="Translation stopped after repeated provider errors.")

    async def _stop(self, reason: str, *, state: str, message: str = "") -> None:
        if self.stopped_reason:
            return
        self.stopped_reason = reason
        log.warning("direction %s stopped: %s", self.label, reason)
        await self._status(state, message=message or reason)
        if self._stt is not None:
            with contextlib.suppress(Exception):
                await self._stt.aclose()
