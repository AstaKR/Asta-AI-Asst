"""Participant-aware translation routing. Pure logic, no LiveKit types, so it is unit-testable.

Rules:
* Only humans are speakers or listeners: app users (kind "standard") and phone-line callers
  (kind "sip"). Agents — including this worker — are never translated, which is the first line of
  defence against feedback loops.
* Each human's microphone is routed to every *other* human, translated from the speaker's spoken
  language into that listener's listen language.
* No route is created for a speaker→listener pair with the same known language: the listener hears
  the original voice directly and no paid API calls are made.
* A phone caller's language is usually unknown: their spoken language is "auto" (detected by STT per
  utterance) and the language they hear is the detected language, or a configured default until then.
"""

from __future__ import annotations

from dataclasses import dataclass

HUMAN = "standard"
PHONE = "sip"
HUMAN_KINDS = frozenset({HUMAN, PHONE})
AUTO = "auto"


@dataclass(frozen=True)
class ParticipantInfo:
    identity: str
    kind: str  # "standard" | "sip" | "agent" | ...
    spoken_language: str
    listen_language: str
    voice: str = ""
    display_name: str = ""
    voice_playback: bool = True


@dataclass(frozen=True)
class Route:
    speaker: str
    listener: str
    source_language: str  # may be AUTO for phone callers
    target_language: str
    voice: str
    speak: bool = True  # synthesize the translation (live meetings can be subtitles-only)

    @property
    def key(self) -> tuple[str, str]:
        return (self.speaker, self.listener)

    @property
    def transcribe_only(self) -> bool:
        """Same language in and out (live meetings without translation): recognition only."""
        return self.source_language == self.target_language and self.source_language != AUTO


def participant_from_attributes(
    identity: str,
    kind: str,
    attributes: dict[str, str],
    name: str = "",
    *,
    default_phone_language: str = "hi-IN",
    detected_language: str | None = None,
) -> ParticipantInfo:
    spoken = attributes.get("spoken_language", "")
    listen = attributes.get("listen_language", "")
    if kind == PHONE:
        spoken = spoken or AUTO
        listen = listen or detected_language or default_phone_language
    return ParticipantInfo(
        identity=identity,
        kind=kind,
        spoken_language=spoken,
        listen_language=listen,
        voice=attributes.get("voice", ""),
        display_name=attributes.get("display_name", name),
        voice_playback=attributes.get("voice_playback", "on") != "off",
    )


def compute_routes(
    participants: list[ParticipantInfo], *, self_identity: str, supported: frozenset[str] | set[str], max_humans: int = 2
) -> list[Route]:
    humans = [
        p
        for p in participants
        if p.kind in HUMAN_KINDS
        and p.identity != self_identity
        and (p.spoken_language in supported or p.spoken_language == AUTO)
        and p.listen_language in supported
    ]
    humans = sorted(humans, key=lambda p: p.identity)[:max_humans]
    routes = []
    for speaker in humans:
        for listener in humans:
            if speaker.identity == listener.identity:
                continue
            if speaker.spoken_language == listener.listen_language:
                continue
            routes.append(
                Route(
                    speaker=speaker.identity,
                    listener=listener.identity,
                    source_language=speaker.spoken_language,
                    target_language=listener.listen_language,
                    # The listener hears the speaker through a synthetic voice chosen by the speaker.
                    voice=speaker.voice,
                )
            )
    return routes


def compute_meeting_routes(
    participants: list[ParticipantInfo], *, self_identity: str, supported: frozenset[str] | set[str]
) -> list[Route]:
    """Live meeting (one person): each speaker's own speech is transcribed and, when their listen
    language differs, translated back to them. Spoken playback only if they turned it on."""
    routes = []
    for p in participants:
        if p.kind != HUMAN or p.identity == self_identity or p.spoken_language not in supported:
            continue
        target = p.listen_language if p.listen_language in supported else p.spoken_language
        routes.append(
            Route(
                speaker=p.identity,
                listener=p.identity,
                source_language=p.spoken_language,
                target_language=target,
                voice=p.voice,
                speak=p.voice_playback and target != p.spoken_language,
            )
        )
    return routes


def should_subscribe(*, publisher_identity: str, publisher_kind: str, track_source: str, self_identity: str) -> bool:
    """Only human voice tracks are ever fed to speech recognition (never agent audio)."""
    if publisher_identity == self_identity or publisher_kind not in HUMAN_KINDS:
        return False
    if publisher_kind == PHONE:
        return track_source in ("microphone", "unknown")  # SIP bridges may not label the source
    return track_source == "microphone"


def translated_track_name(listener_identity: str) -> str:
    return f"translation-for-{listener_identity}"


def track_permissions(published: dict[str, str]) -> list[tuple[str, list[str]]]:
    """published: listener identity -> track sid. Each listener may subscribe ONLY to its own track."""
    return [(listener, [sid]) for listener, sid in sorted(published.items())]
