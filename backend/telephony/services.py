"""Phone call flows: outgoing dial, incoming (forwarded) calls from LiveKit webhooks, ring timeouts."""

import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from accounts.models import PhoneNumber, get_preference
from billing import limits as plan_limits
from calls import usage
from calls.models import CallParticipant, CallRoom

from . import numbers, sip
from .models import PhoneCall, PhoneLine

log = logging.getLogger(__name__)
SIP_KIND = 3  # livekit ParticipantInfo.Kind.SIP


class PhoneError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = ""):
        super().__init__(message)
        self.status, self.code = status, code


def dial_ready() -> bool:
    return settings.TELEPHONY_ENABLED and bool(settings.LIVEKIT_SIP_OUTBOUND_TRUNK_ID)


def _today_start():
    now = timezone.localtime()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _sip_identity() -> str:
    return f"phone-{uuid.uuid4().hex[:12]}"


def _new_room(owner, *, spoken: str, listen: str, voice: str = "", livekit_room_name: str | None = None) -> CallRoom:
    pref = get_preference(owner)
    fields = {"livekit_room_name": livekit_room_name} if livekit_room_name else {}
    room = CallRoom.objects.create(
        created_by=owner,
        translation_enabled=settings.TRANSLATION_ENABLED and usage.ai_budget_available(),
        max_duration_seconds=settings.MAX_CALL_DURATION_SECONDS,
        invite_expires_at=timezone.now(),  # phone rooms cannot be joined by invite code
        **fields,
    )
    CallParticipant.objects.create(
        room=room,
        user=owner,
        identity=f"user-{owner.id}",
        display_name=pref.display_name or owner.username,
        role=CallParticipant.Role.HOST,
        spoken_language=spoken,
        listen_language=listen,
        voice=voice or pref.voice or settings.DEFAULT_VOICE,
    )
    return room


def start_outbound(user, *, number: str, spoken: str, listen: str, caller_language: str) -> PhoneCall:
    if not dial_ready():
        raise PhoneError("Phone calling is not set up on the server yet (telephony line / LIVEKIT_SIP_OUTBOUND_TRUNK_ID).", 503, "not_configured")
    try:
        number = numbers.normalize(number)
    except numbers.InvalidNumber as exc:
        raise PhoneError(str(exc)) from exc
    if not numbers.dial_allowed(number):
        raise PhoneError("Only Indian numbers can be called.", 400, "prefix_not_allowed")
    try:
        plan_limits.check_phone(user)
    except plan_limits.PlanLimit as exc:
        raise PhoneError(str(exc), 403 if exc.code == "plan_no_phone" else 429, exc.code) from exc
    today = PhoneCall.objects.filter(owner=user, direction=PhoneCall.Direction.OUTBOUND, created_at__gte=_today_start()).count()
    if today >= settings.PHONE_DIAL_DAILY_LIMIT_PER_USER:
        raise PhoneError("You have reached today's limit for phone calls.", 429, "daily_dial_limit")
    if not usage.check_daily_call_budget().allowed:
        raise PhoneError("Daily call limit reached.", 429, "daily_call_limit")

    with transaction.atomic():
        room = _new_room(user, spoken=spoken, listen=listen)
        call = PhoneCall.objects.create(
            room=room,
            owner=user,
            direction=PhoneCall.Direction.OUTBOUND,
            remote_number=number,
            caller_language=caller_language,
            sip_identity=_sip_identity(),
        )
    try:
        sip.create_room_with_translator(room)
        sip.dial(room, identity=call.sip_identity, number=number, caller_language=caller_language, display_name=numbers.mask(number))
    except sip.SipError as exc:
        log.warning("outbound dial failed: %s", exc)
        _finish(call, PhoneCall.Status.FAILED, reason="dial_failed", error=str(exc))
        raise PhoneError("The call could not be placed. Try again in a moment.", 502, "dial_failed") from exc
    return call


# ---------- incoming ----------


def _owner_for(attrs: dict[str, str]):
    """Whose call is this? Dedicated line number first, then the forwarding subscriber's own number."""
    called = attrs.get("sip.trunkPhoneNumber", "")
    if called:
        try:
            line = PhoneLine.objects.select_related("user").get(number=numbers.normalize(called), active=True)
            return line.user, line.number
        except (PhoneLine.DoesNotExist, numbers.InvalidNumber):
            pass
    forwarded = numbers.extract_number(attrs.get(settings.PHONE_FORWARDED_FROM_ATTRIBUTE, ""))
    if forwarded:
        phone = PhoneNumber.objects.select_related("user").filter(number=forwarded).first()
        if phone:
            return phone.user, called
    return None, called


def handle_inbound_join(room_name: str, identity: str, attrs: dict[str, str]) -> PhoneCall | None:
    if not settings.TELEPHONY_ENABLED or not room_name.startswith(settings.PHONE_ROOM_PREFIX):
        return None
    if CallRoom.objects.filter(livekit_room_name=room_name).exists():
        return None  # already handled (webhooks can be retried)
    if settings.PHONE_FORWARDED_FROM_ATTRIBUTE not in attrs:
        attrs = {**attrs, **sip.participant_attributes(room_name, identity)}
    owner, line = _owner_for(attrs)
    if owner is None:
        log.info("incoming call to %s has no matching user; hanging up", numbers.mask(line or "unknown"))
        sip.hang_up(room_name)
        return None
    if not usage.check_daily_call_budget().allowed:
        sip.hang_up(room_name)
        return None
    try:
        plan_limits.check_call(owner)
        plan_limits.check_phone_line(owner)
    except plan_limits.PlanLimit:
        sip.hang_up(room_name)
        return None
    pref = get_preference(owner)
    with transaction.atomic():
        room = _new_room(owner, spoken=pref.spoken_language, listen=pref.listen_language, livekit_room_name=room_name)
        call = PhoneCall.objects.create(
            room=room,
            owner=owner,
            direction=PhoneCall.Direction.INBOUND,
            remote_number=numbers.extract_number(attrs.get("sip.phoneNumber", "")) or "",
            line_number=line or "",
            sip_identity=identity,
        )
    from calls import livekit_service

    livekit_service.update_room_metadata(room)
    try:
        # The caller's language is unknown: detect it (worker default PHONE_DEFAULT_LANGUAGE until then).
        sip.set_participant_attributes(room, identity, {"role": "guest", "display_name": numbers.mask(call.remote_number) or "Caller", "spoken_language": "auto"})
        sip.dispatch_translator(room)
    except sip.SipError as exc:
        log.warning("could not prepare incoming call: %s", exc)
    return call


# ---------- state changes ----------


def _finish(call: PhoneCall, status: str, *, reason: str, error: str = "") -> None:
    from calls.views import _end_room

    if not call.is_open:
        return
    call.status = status
    call.ended_at = timezone.now()
    call.error = error[:200]
    call.save(update_fields=["status", "ended_at", "error"])
    _end_room(call.room, reason)


def answer(call: PhoneCall) -> None:
    if call.status != PhoneCall.Status.RINGING or call.direction != PhoneCall.Direction.INBOUND:
        raise PhoneError("This call is no longer ringing.", 409, "not_ringing")
    call.status = PhoneCall.Status.ANSWERED
    call.answered_at = timezone.now()
    call.save(update_fields=["status", "answered_at"])


def decline(call: PhoneCall) -> None:
    _finish(call, PhoneCall.Status.DECLINED, reason="declined")


def mark_connected(call: PhoneCall) -> None:
    """The phone side picked up (outgoing: sip.callStatus became "active")."""
    if call.status == PhoneCall.Status.RINGING:
        call.status = PhoneCall.Status.ANSWERED
        call.answered_at = timezone.now()
        call.save(update_fields=["status", "answered_at"])


def hang_up(call: PhoneCall) -> None:
    _finish(call, PhoneCall.Status.ENDED if call.answered_at else PhoneCall.Status.MISSED, reason="ended_by_participant")


def reconcile(call: PhoneCall) -> None:
    """The room ended through the normal call API (or webhooks are not configured): close the phone call."""
    if call.is_open and call.room.is_ended:
        call.status = PhoneCall.Status.ENDED if call.answered_at else PhoneCall.Status.MISSED
        call.ended_at = call.room.ended_at
        call.save(update_fields=["status", "ended_at"])


def expire_ringing(now=None) -> int:
    """Incoming calls nobody answered within PHONE_RING_SECONDS are hung up and marked missed."""
    cutoff = (now or timezone.now()) - timedelta(seconds=settings.PHONE_RING_SECONDS)
    stale = PhoneCall.objects.filter(status=PhoneCall.Status.RINGING, direction=PhoneCall.Direction.INBOUND, created_at__lt=cutoff)
    n = 0
    for call in stale.select_related("room"):
        _finish(call, PhoneCall.Status.MISSED, reason="not_answered")
        n += 1
    return n


def handle_event(event) -> None:
    """LiveKit webhook (already signature-verified)."""
    room_name = event.room.name if event.HasField("room") else ""
    p = event.participant if event.HasField("participant") else None
    is_sip = p is not None and p.kind == SIP_KIND
    call = PhoneCall.objects.select_related("room").filter(room__livekit_room_name=room_name).first()

    if event.event == "participant_joined" and is_sip:
        if call is None:
            handle_inbound_join(room_name, p.identity, dict(p.attributes))
        elif call.direction == PhoneCall.Direction.OUTBOUND and p.identity == call.sip_identity and p.attributes.get("sip.callStatus") == "active":
            mark_connected(call)
    elif event.event in ("participant_left", "participant_connection_aborted") and is_sip and call and p.identity == call.sip_identity:
        hang_up(call)  # the phone side hung up: end the translated call too
    elif event.event == "room_finished" and call and call.is_open:
        hang_up(call)
