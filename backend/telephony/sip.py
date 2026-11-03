"""LiveKit SIP / room / agent-dispatch calls used by phone calls. Unlike calls.livekit_service._run these
raise on failure, because the caller needs to know whether a phone call was actually placed."""

import asyncio
import time

from django.conf import settings
from livekit import api

from calls import livekit_service
from calls.models import CallRoom


class SipError(RuntimeError):
    pass


def _call(fn):
    try:
        livekit_service._require_config()
        return asyncio.run(livekit_service._with_api(fn))
    except livekit_service.LiveKitNotConfigured as exc:
        raise SipError("Calling is not configured on the server.") from exc
    except Exception as exc:  # TwirpError, network errors
        raise SipError(f"LiveKit SIP request failed ({exc.__class__.__name__}).") from exc


def create_room_with_translator(room: CallRoom) -> None:
    """Outgoing calls: create the room (with the translation agent) before ringing the number."""
    agents = []
    if room.translation_enabled:
        agents = [api.RoomAgentDispatch(agent_name=settings.AGENT_NAME, metadata=livekit_service.dispatch_metadata(room))]
    _call(
        lambda lk: lk.room.create_room(
            api.CreateRoomRequest(
                name=room.livekit_room_name,
                empty_timeout=60,
                departure_timeout=20,
                max_participants=settings.MAX_PARTICIPANTS + 1,
                metadata=livekit_service.room_metadata(room),
                agents=agents,
            )
        )
    )


def dispatch_translator(room: CallRoom) -> None:
    """Incoming calls: the room was created by the SIP dispatch rule, so send the agent explicitly."""
    if not room.translation_enabled:
        return
    _call(
        lambda lk: lk.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(
                agent_name=settings.AGENT_NAME, room=room.livekit_room_name, metadata=livekit_service.dispatch_metadata(room)
            )
        )
    )


def dial(room: CallRoom, *, identity: str, number: str, caller_language: str, display_name: str) -> None:
    attributes = {"role": "guest", "display_name": display_name, "spoken_language": "auto", "listen_language": caller_language}
    _call(
        lambda lk: lk.sip.create_sip_participant(
            api.CreateSIPParticipantRequest(
                sip_trunk_id=settings.LIVEKIT_SIP_OUTBOUND_TRUNK_ID,
                sip_call_to=number,
                room_name=room.livekit_room_name,
                participant_identity=identity,
                participant_name=display_name,
                participant_attributes=attributes,
                play_dialtone=False,
                wait_until_answered=False,
            )
        )
    )


def set_participant_attributes(room: CallRoom, identity: str, attributes: dict[str, str]) -> None:
    _call(lambda lk: lk.room.update_participant(api.UpdateParticipantRequest(room=room.livekit_room_name, identity=identity, attributes=attributes)))


def participant_attributes(room_name: str, identity: str, attempts: int = 3, delay: float = 0.7) -> dict[str, str]:
    """SIP header attributes can arrive a moment after the participant joins (LiveKit docs), so retry briefly."""
    attrs: dict[str, str] = {}
    for i in range(attempts):
        try:
            p = _call(lambda lk: lk.room.get_participant(api.RoomParticipantIdentity(room=room_name, identity=identity)))
            attrs = dict(p.attributes)
        except SipError:
            attrs = {}
        if attrs.get(settings.PHONE_FORWARDED_FROM_ATTRIBUTE):
            break
        if i + 1 < attempts:
            time.sleep(delay)
    return attrs


def hang_up(room_name: str) -> None:
    """Deleting the room disconnects everyone, including the phone line."""
    try:
        _call(lambda lk: lk.room.delete_room(api.DeleteRoomRequest(room=room_name)))
    except SipError:
        pass
