"""Binds the translation pipeline to a LiveKit room.

* Subscribes only to human microphone tracks (never agent tracks, never its own).
* Publishes one translated-audio track per listener and restricts each track, via LiveKit
  subscription permissions, so only its intended listener can subscribe to it.
* Sends subtitles/status as reliable data packets addressed only to the two call participants.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from datetime import datetime, timezone

from livekit import api, rtc

from .config import PHONE_ANNOUNCEMENTS, WorkerConfig
from .echo_guard import EchoGuard
from .metrics import LatencyStats
from .pipeline import Counters, DirectionSettings, TranslationDirection, UsageGate
from .providers.base import AudioChunk, ProviderUsage, SpeechProvider
from .routing import (
    PHONE,
    ParticipantInfo,
    Route,
    compute_meeting_routes,
    compute_routes,
    participant_from_attributes,
    should_subscribe,
    track_permissions,
    translated_track_name,
)
from .usage_reporter import SegmentReporter, UsageReporter

log = logging.getLogger("translation_worker.session")
DATA_TOPIC = "translator"
FRAME_MS = 20

_KIND_NAMES = {
    rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD: "standard",
    rtc.ParticipantKind.PARTICIPANT_KIND_SIP: "sip",
    rtc.ParticipantKind.PARTICIPANT_KIND_AGENT: "agent",
}
_SOURCE_NAMES = {rtc.TrackSource.SOURCE_MICROPHONE: "microphone", rtc.TrackSource.SOURCE_UNKNOWN: "unknown"}
# Synthesised announcement audio, cached per process so repeated calls do not pay for TTS again.
_ANNOUNCEMENT_CACHE: dict[tuple[str, str, str], list[AudioChunk]] = {}


def kind_name(participant) -> str:
    return _KIND_NAMES.get(participant.kind, "other")


def source_name(publication) -> str:
    return _SOURCE_NAMES.get(publication.source, "other")


class LiveKitAudioOutput:
    """Feeds synthesized PCM into an rtc.AudioSource in 20 ms frames (capture_frame paces to real time)."""

    def __init__(self, source: rtc.AudioSource):
        self.source = source
        self._resamplers: dict[int, rtc.AudioResampler] = {}

    async def push(self, chunk: AudioChunk) -> None:
        rate = self.source.sample_rate
        frames: list[rtc.AudioFrame]
        if chunk.sample_rate == rate:
            frames = [rtc.AudioFrame(chunk.pcm, rate, 1, len(chunk.pcm) // 2)]
        else:
            resampler = self._resamplers.setdefault(chunk.sample_rate, rtc.AudioResampler(chunk.sample_rate, rate))
            frames = resampler.push(rtc.AudioFrame(chunk.pcm, chunk.sample_rate, 1, len(chunk.pcm) // 2))
        step = rate * FRAME_MS // 1000 * 2
        for frame in frames:
            data = bytes(frame.data)
            for i in range(0, len(data), step):
                piece = data[i : i + step]
                if len(piece) < step:
                    piece = piece + b"\x00" * (step - len(piece))
                await self.source.capture_frame(rtc.AudioFrame(piece, rate, 1, step // 2))

    def clear(self) -> None:
        self.source.clear_queue()


class LiveKitNotifier:
    def __init__(self, room: rtc.Room):
        self.room = room

    async def send(self, payload: dict, destinations: list[str]) -> None:
        dest = [d for d in destinations if d in self.room.remote_participants]
        if not dest or not self.room.isconnected():
            return
        try:
            await self.room.local_participant.publish_data(
                json.dumps(payload, ensure_ascii=False), reliable=True, destination_identities=dest, topic=DATA_TOPIC
            )
        except Exception as exc:  # never let UI messaging break audio
            log.debug("publish_data failed: %s", exc)


class CallSession:
    def __init__(
        self,
        room: rtc.Room,
        cfg: WorkerConfig,
        provider: SpeechProvider | None,
        *,
        job_metadata: dict,
        lkapi: api.LiveKitAPI | None,
        disabled_reason: str = "",
    ):
        self.room = room
        self.cfg = cfg
        self.provider = provider
        self.meta = job_metadata
        self.lkapi = lkapi
        self.disabled_reason = disabled_reason
        self.notifier = LiveKitNotifier(room)
        self.counters = Counters()
        self.stats = LatencyStats()
        self.echo_guard = EchoGuard(cfg.echo_guard_window_s, cfg.echo_guard_similarity)
        usage = provider.usage if provider else ProviderUsage()
        self.gate = UsageGate(usage, job_metadata.get("per_call_limits"))
        self.reporter = UsageReporter(
            backend_url=cfg.backend_url,
            secret=cfg.worker_secret,
            room_name=room.name,
            usage=usage,
            counters=self.counters,
            stats=self.stats,
            gate=self.gate,
            interval_s=cfg.report_interval_s,
        )
        self.settings = DirectionSettings(
            local_gate=cfg.local_gate,
            gate_threshold_dbfs=cfg.gate_threshold_dbfs,
            max_pending=cfg.max_pending_utterances,
        )
        self.mic_tracks: dict[str, rtc.RemoteAudioTrack] = {}
        self.outputs: dict[str, tuple[rtc.AudioSource, rtc.LocalAudioTrack, str, LiveKitAudioOutput]] = {}
        # route key -> (route, direction, task, mic track it consumes)
        self.directions: dict[tuple[str, str], tuple[Route, TranslationDirection, asyncio.Task, object]] = {}
        self._lock = asyncio.Lock()
        self._tasks: set[asyncio.Task] = set()
        self._closed = False
        self.detected_languages: dict[str, str] = {}  # phone caller identity -> detected language
        self._announced: dict[str, asyncio.Task] = {}
        # Room metadata (set by the backend): "call" or "meeting" mode, and whether transcripts are saved.
        self.mode = "call"
        self.save_transcript = False
        self._read_room_metadata(room.metadata)
        self.segments = SegmentReporter(backend_url=cfg.backend_url, secret=cfg.worker_secret, room_name=room.name)

    # ---------- lifecycle ----------

    async def start(self) -> None:
        # Deny everyone by default BEFORE publishing anything, so a translated track is never
        # briefly visible to the wrong participant.
        self.room.local_participant.set_track_subscription_permissions(
            allow_all_participants=False, participant_permissions=[]
        )
        self.room.on("participant_connected", lambda p: self._on_participant_connected(p))
        self.room.on("participant_disconnected", lambda p: self._schedule())
        self.room.on("participant_attributes_changed", lambda changed, p: self._schedule())
        self.room.on("track_published", lambda pub, p: self._maybe_subscribe(pub, p))
        self.room.on("track_subscribed", self._on_track_subscribed)
        self.room.on("track_unsubscribed", self._on_track_unsubscribed)
        self.room.on("reconnecting", lambda: log.warning("room connection reconnecting"))
        self.room.on("reconnected", lambda: self._on_reconnected())
        self.room.on("room_metadata_changed", lambda old, new: self._on_room_metadata(new))
        for participant in self.room.remote_participants.values():
            for pub in participant.track_publications.values():
                self._maybe_subscribe(pub, participant)
        if self.provider is not None:
            self.reporter.start()
        self._spawn(self._duration_watchdog())
        await self._announce()
        self._schedule()

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        for _route, _direction, task, _track in list(self.directions.values()):
            task.cancel()
        for _route, _direction, task, _track in list(self.directions.values()):
            with contextlib.suppress(BaseException):
                await task
        for task in list(self._tasks):
            task.cancel()
        with contextlib.suppress(Exception):
            await self.reporter.aclose()
        with contextlib.suppress(Exception):
            await self.segments.aclose()
        if self.provider is not None:
            with contextlib.suppress(Exception):
                await self.provider.aclose()
        log.info(
            "session closed: utterances=%d dropped=%d echo_dropped=%d reconnects=%d latency=%s",
            self.counters.utterances,
            self.counters.dropped_utterances,
            self.counters.echo_dropped,
            self.counters.reconnects,
            json.dumps(self.stats.summary()),
        )

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # ---------- room events ----------

    def _read_room_metadata(self, raw: str | None) -> None:
        try:
            meta = json.loads(raw or "{}")
        except (TypeError, ValueError):
            meta = {}
        self.mode = meta.get("mode", "call")
        self.save_transcript = bool(meta.get("save_transcript"))

    def _on_room_metadata(self, raw: str) -> None:
        old_mode = self.mode
        self._read_room_metadata(raw)
        log.info("room metadata: mode=%s save_transcript=%s", self.mode, self.save_transcript)
        if self.mode != old_mode:
            self._schedule()

    def _on_segment(self, segment: dict) -> None:
        """Finalized utterance: forwarded to the backend only while saving was agreed for this room."""
        if not self.save_transcript:
            return
        p = self.room.remote_participants.get(segment["speaker_identity"])
        segment["speaker_name"] = p.name if p is not None else ""
        self.segments.submit(segment)

    def _is_phone(self, identity: str) -> bool:
        p = self.room.remote_participants.get(identity)
        return p is not None and kind_name(p) == PHONE

    def _on_language_detected(self, speaker: str, language: str) -> None:
        """A phone caller's language became known: translate replies into it from now on."""
        if self.detected_languages.get(speaker) != language:
            self.detected_languages[speaker] = language
            log.info("detected caller language %s", language)
            self._schedule()

    async def _run_after_announcement(self, listener, output, direction, track) -> None:
        """Phone callers hear the AI-translation notice once, before any translated speech."""
        if listener not in self._announced:
            self._announced[listener] = asyncio.create_task(self._play_announcement(listener, output))
        with contextlib.suppress(Exception):
            await self._announced[listener]
        await direction.run(self._frames(track))

    async def _play_announcement(self, listener: str, output) -> None:
        info = next((p for p in self._participants() if p.identity == listener), None)
        language = info.listen_language if info else self.cfg.phone_default_language
        text = PHONE_ANNOUNCEMENTS.get(language) or PHONE_ANNOUNCEMENTS["en-IN"]
        voice = getattr(getattr(self.provider, "cfg", None), "default_speaker", "") or ""
        key = (language, text, voice)
        if key not in _ANNOUNCEMENT_CACHE:
            if not self.gate.allowed:
                return
            _ANNOUNCEMENT_CACHE[key] = [c async for c in self.provider.synthesize(text, language, voice or None)]
        for chunk in _ANNOUNCEMENT_CACHE[key]:
            await output.push(chunk)

    def _on_participant_connected(self, participant: rtc.RemoteParticipant) -> None:
        self._spawn(self._announce([participant.identity]))
        self._schedule()

    def _on_reconnected(self) -> None:
        self.counters.reconnects += 1
        self._schedule()

    def _maybe_subscribe(self, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        if self.provider is None:
            return
        if should_subscribe(
            publisher_identity=participant.identity,
            publisher_kind=kind_name(participant),
            track_source=source_name(publication),
            self_identity=self.room.local_participant.identity,
        ):
            publication.set_subscribed(True)

    def _on_track_subscribed(self, track, publication, participant) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        if not should_subscribe(
            publisher_identity=participant.identity,
            publisher_kind=kind_name(participant),
            track_source=source_name(publication),
            self_identity=self.room.local_participant.identity,
        ):
            publication.set_subscribed(False)
            return
        self.mic_tracks[participant.identity] = track
        self._schedule()

    def _on_track_unsubscribed(self, track, publication, participant) -> None:
        if self.mic_tracks.get(participant.identity) is track:
            del self.mic_tracks[participant.identity]
        self._schedule()

    def _schedule(self) -> None:
        if not self._closed:
            self._spawn(self._reconcile())

    # ---------- routing ----------

    def _participants(self) -> list[ParticipantInfo]:
        return [
            participant_from_attributes(
                p.identity,
                kind_name(p),
                dict(p.attributes),
                p.name,
                default_phone_language=self.cfg.phone_default_language,
                detected_language=self.detected_languages.get(p.identity),
            )
            for p in self.room.remote_participants.values()
        ]

    async def _reconcile(self) -> None:
        if self.provider is None or self._closed:
            return
        async with self._lock:
            if self.mode == "meeting":
                routes = compute_meeting_routes(
                    self._participants(),
                    self_identity=self.room.local_participant.identity,
                    supported=self.provider.capabilities.languages,
                )
            else:
                routes = compute_routes(
                    self._participants(),
                    self_identity=self.room.local_participant.identity,
                    supported=self.provider.capabilities.languages,
                    max_humans=2,
                )
            wanted = {r.key: r for r in routes}
            # Stop directions whose route vanished or changed (e.g. language switched mid-call).
            # A direction that stopped itself (limit, auth failure) is kept, not restarted, unless its
            # route or its microphone track actually changed.
            for key, (route, _direction, task, track) in list(self.directions.items()):
                if wanted.get(key) != route or self.mic_tracks.get(key[0]) is not track:
                    if not task.done():
                        task.cancel()
                        with contextlib.suppress(BaseException):
                            await task
                    del self.directions[key]
            for route in routes:
                if route.key in self.directions or route.speaker not in self.mic_tracks:
                    continue
                output = await self._ensure_output(route.listener)
                direction = TranslationDirection(
                    route,
                    self.provider,
                    output,
                    self.notifier,
                    echo_guard=self.echo_guard,
                    usage_gate=self.gate,
                    stats=self.stats,
                    counters=self.counters,
                    settings=self.settings,
                    on_barge_in=self._on_barge_in if self.cfg.interrupt_on_listener_speech else None,
                    on_language_detected=self._on_language_detected,
                    on_segment=self._on_segment,
                )
                track = self.mic_tracks[route.speaker]
                if self._is_phone(route.listener) and self.cfg.phone_announcement:
                    task = asyncio.create_task(
                        self._run_after_announcement(route.listener, output, direction, track), name=direction.label
                    )
                else:
                    task = asyncio.create_task(direction.run(self._frames(track)), name=direction.label)
                self.directions[route.key] = (route, direction, task, track)
                log.info("started direction %s", direction.label)

    def _on_barge_in(self, speaker: str) -> None:
        """`speaker` started talking: stop playing translations *to* them so they are not talked over."""
        for route, direction, _task, _track in self.directions.values():
            if route.listener == speaker:
                direction.interrupt()

    async def _frames(self, track: rtc.RemoteAudioTrack):
        stream = rtc.AudioStream.from_track(
            track=track, sample_rate=self.provider.stt_sample_rate, num_channels=1, frame_size_ms=FRAME_MS
        )
        try:
            async for event in stream:
                yield bytes(event.frame.data)
        finally:
            with contextlib.suppress(Exception):
                await stream.aclose()

    async def _ensure_output(self, listener: str) -> LiveKitAudioOutput:
        if listener in self.outputs:
            return self.outputs[listener][3]
        rate = getattr(getattr(self.provider, "cfg", None), "tts_sample_rate", 24000)
        source = rtc.AudioSource(rate, 1, queue_size_ms=1000)
        track = rtc.LocalAudioTrack.create_audio_track(translated_track_name(listener), source)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        publication = await self.room.local_participant.publish_track(track, options)
        output = LiveKitAudioOutput(source)
        self.outputs[listener] = (source, track, publication.sid, output)
        await self._apply_permissions()
        return output

    async def _apply_permissions(self) -> None:
        perms = [
            rtc.ParticipantTrackPermission(participant_identity=listener, allow_all=False, allowed_track_sids=sids)
            for listener, sids in track_permissions({k: v[2] for k, v in self.outputs.items()})
        ]
        self.room.local_participant.set_track_subscription_permissions(
            allow_all_participants=False, participant_permissions=perms
        )

    # ---------- notices & limits ----------

    async def _announce(self, identities: list[str] | None = None) -> None:
        targets = identities or list(self.room.remote_participants)
        if self.provider is None:
            payload = {"type": "status", "state": "disabled", "message": self.disabled_reason}
        else:
            payload = {
                "type": "status",
                "state": "ready",
                "message": "AI translation is active",
                "provider": self.provider.name,
                "partial_transcripts": self.provider.capabilities.partial_transcripts,
            }
        await self.notifier.send(payload, targets)

    async def _duration_watchdog(self) -> None:
        max_s = int(self.meta.get("max_duration_seconds") or 0)
        if max_s <= 0:
            return
        started = self.meta.get("started_at")
        elapsed = 0.0
        if started:
            with contextlib.suppress(ValueError):
                elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(started)).total_seconds()
        remaining = max(0.0, max_s - elapsed)
        warn_at = remaining - 60
        t0 = time.monotonic()
        if warn_at > 0:
            await asyncio.sleep(warn_at)
            await self.notifier.send(
                {"type": "status", "state": "warning", "message": "Call will end in 1 minute (duration limit)."},
                list(self.room.remote_participants),
            )
        await asyncio.sleep(max(0.0, remaining - (time.monotonic() - t0)))
        self.gate.stop("max_call_duration")
        await self.notifier.send(
            {"type": "status", "state": "limit", "message": "max_call_duration"}, list(self.room.remote_participants)
        )
        await asyncio.sleep(1)
        if self.lkapi is not None:
            with contextlib.suppress(Exception):
                await self.lkapi.room.delete_room(api.DeleteRoomRequest(room=self.room.name))
