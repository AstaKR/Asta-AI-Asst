"""All LiveKit server-side operations. The API secret never leaves this module/process."""

import asyncio
import json
import logging
from datetime import timedelta

from django.conf import settings
from livekit import api

from .models import CallParticipant, CallRoom

log = logging.getLogger(__name__)


class LiveKitNotConfigured(RuntimeError):
    pass


def _require_config():
    if not (settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET):
        raise LiveKitNotConfigured("LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set")


AUTO = "auto"


def client_url(request) -> str:
    """LiveKit URL handed to browsers/phones in the token response.

    LIVEKIT_URL=auto (development only) derives it from the host the client used to reach this
    backend, so phones on Wi-Fi keep working when the PC's address changes.
    """
    if settings.LIVEKIT_URL != AUTO:
        return settings.LIVEKIT_URL
    host = request.get_host().rsplit(":", 1)[0].strip("[]")
    return f"ws://{host}:{settings.LIVEKIT_AUTO_PORT}"


def _server_api_url() -> str:
    url = f"ws://127.0.0.1:{settings.LIVEKIT_AUTO_PORT}" if settings.LIVEKIT_URL == AUTO else settings.LIVEKIT_URL
    return url.replace("ws://", "http://").replace("wss://", "https://")


def dispatch_metadata(room: CallRoom) -> str:
    """Passed to the translation worker job. Contains limits only — no secrets, no personal data."""
    return json.dumps(
        {
            "room_code": room.code,
            "max_duration_seconds": room.max_duration_seconds,
            "per_call_limits": settings.PER_CALL_LIMITS,
            "started_at": room.started_at.isoformat() if room.started_at else None,
        }
    )


def room_metadata(room: CallRoom) -> str:
    """Read by the translation worker: call vs live-meeting mode, and whether transcripts are saved."""
    return json.dumps(
        {
            "room_code": room.code,
            "translation_enabled": room.translation_enabled,
            "mode": room.mode,
            "save_transcript": room.save_transcript,
        }
    )


def build_token(room: CallRoom, participant: CallParticipant) -> str:
    """Short-lived token: join one room, publish microphone (and camera in video calls), cannot change own attributes."""
    _require_config()
    grants = api.VideoGrants(
        room_join=True,
        room=room.livekit_room_name,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=False,
        can_publish_sources=["microphone", "camera"] if room.video_enabled else ["microphone"],
        can_update_own_metadata=False,
    )
    room_config = api.RoomConfiguration(
        name=room.livekit_room_name,
        max_participants=settings.MAX_PARTICIPANTS + 1,  # + the translation agent
        empty_timeout=120,
        departure_timeout=30,
        metadata=room_metadata(room),
    )
    if room.translation_enabled:
        # Explicit dispatch: the worker joins only rooms created through this backend.
        room_config.agents.append(
            api.RoomAgentDispatch(agent_name=settings.AGENT_NAME, metadata=dispatch_metadata(room))
        )
    token = (
        api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        .with_identity(participant.identity)
        .with_name(participant.display_name)
        .with_attributes(participant.livekit_attributes())
        .with_grants(grants)
        .with_room_config(room_config)
        .with_ttl(timedelta(seconds=settings.LIVEKIT_TOKEN_TTL_SECONDS))
    )
    return token.to_jwt()


async def _with_api(fn):
    lkapi = api.LiveKitAPI(
        url=_server_api_url(),
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    )
    try:
        return await fn(lkapi)
    finally:
        await lkapi.aclose()


def _run(coro_fn) -> bool:
    """Run a LiveKit API call from sync Django code. Returns False (and logs) on failure."""
    try:
        _require_config()
        asyncio.run(_with_api(coro_fn))
        return True
    except Exception as exc:  # network or LiveKit error — never crash the request over it
        log.warning("LiveKit API call failed: %s", exc.__class__.__name__)
        return False


def delete_room(room: CallRoom) -> bool:
    return _run(lambda lk: lk.room.delete_room(api.DeleteRoomRequest(room=room.livekit_room_name)))


def update_participant_attributes(room: CallRoom, participant: CallParticipant) -> bool:
    return _run(
        lambda lk: lk.room.update_participant(
            api.UpdateParticipantRequest(
                room=room.livekit_room_name,
                identity=participant.identity,
                attributes=participant.livekit_attributes(),
            )
        )
    )


def update_room_metadata(room: CallRoom) -> bool:
    return _run(
        lambda lk: lk.room.update_room_metadata(
            api.UpdateRoomMetadataRequest(room=room.livekit_room_name, metadata=room_metadata(room))
        )
    )
