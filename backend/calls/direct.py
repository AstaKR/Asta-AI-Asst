"""App-to-app dialer: ring another user of this app by username or mobile number (free, no phone line).

The caller gets a normal translated call room at once; the callee's app polls /direct/incoming/ and,
on answer, joins that room as the second participant. Unanswered calls become missed after
DIRECT_CALL_RING_SECONDS.
"""

import re
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import PhoneNumber, get_preference
from accounts.validators import validate_language, validate_voice
from billing import limits as plan_limits
from telephony import numbers

from . import usage
from .models import CallParticipant, CallRoom, DirectCall
from .views import _end_room

OPEN = (DirectCall.Status.RINGING, DirectCall.Status.ANSWERED)


class DirectError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = ""):
        super().__init__(message)
        self.status, self.code = status, code


def find_user(target: str):
    """A username, or a mobile number verified for login (SMS) or assigned by an admin."""
    target = (target or "").strip()
    if re.fullmatch(r"[+\d\s\-().]{8,20}", target):
        try:
            number = numbers.normalize(target)
        except numbers.InvalidNumber as exc:
            raise DirectError(str(exc)) from exc
        phone = PhoneNumber.objects.select_related("user").filter(number=number).first()
        user = phone.user if phone else None
    else:
        user = get_user_model().objects.filter(username__iexact=target.lstrip("@")).first()
    if user is None or not user.is_active:
        raise DirectError("No one with that username or mobile number uses this app.", 404, "not_found")
    return user


def _finish(call: DirectCall, new_status: str, reason: str) -> None:
    if call.status not in OPEN:
        return
    call.status = new_status
    call.ended_at = timezone.now()
    call.save(update_fields=["status", "ended_at"])
    _end_room(call.room, reason)


def reconcile(call: DirectCall) -> DirectCall:
    """The room may have ended on its own (hang-up, time limit): reflect it on the call."""
    if call.status in OPEN and call.room.is_ended:
        call.status = DirectCall.Status.ENDED if call.answered_at else DirectCall.Status.CANCELLED
        call.ended_at = call.room.ended_at
        call.save(update_fields=["status", "ended_at"])
    return call


def expire_ringing(now=None) -> int:
    cutoff = (now or timezone.now()) - timedelta(seconds=settings.DIRECT_CALL_RING_SECONDS)
    n = 0
    for call in DirectCall.objects.filter(status=DirectCall.Status.RINGING, created_at__lt=cutoff).select_related("room"):
        _finish(call, DirectCall.Status.MISSED, "not_answered")
        n += 1
    return n


def start(caller, *, target: str, spoken: str, listen: str, video: bool, voice: str = "") -> DirectCall:
    callee = find_user(target)
    if callee == caller:
        raise DirectError("You cannot call yourself.", 400, "self")
    if video and not settings.VIDEO_CALLS_ENABLED:
        raise DirectError("Video calls are turned off on this server.", 400, "video_disabled")
    try:
        plan_limits.check_call(caller, video=video)
    except plan_limits.PlanLimit as exc:
        raise DirectError(str(exc), 403 if exc.code.startswith("plan_no") else 429, exc.code) from exc
    today = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    if DirectCall.objects.filter(caller=caller, created_at__gte=today).count() >= settings.DIRECT_CALL_DAILY_LIMIT_PER_USER:
        raise DirectError("You have reached today's limit for calls.", 429, "daily_direct_limit")
    if not usage.check_daily_call_budget().allowed:
        raise DirectError("Daily call limit reached.", 429, "daily_call_limit")
    pref = get_preference(caller)
    with transaction.atomic():
        room = CallRoom.objects.create(
            created_by=caller,
            translation_enabled=settings.TRANSLATION_ENABLED and usage.ai_budget_available(),
            max_duration_seconds=settings.MAX_CALL_DURATION_SECONDS,
            video_enabled=video,
            invite_expires_at=timezone.now(),  # only the callee can join, by answering
        )
        CallParticipant.objects.create(
            room=room,
            user=caller,
            identity=f"user-{caller.id}",
            display_name=pref.display_name or caller.username,
            role=CallParticipant.Role.HOST,
            spoken_language=spoken,
            listen_language=listen,
            voice=voice or pref.voice or settings.DEFAULT_VOICE,
        )
        return DirectCall.objects.create(room=room, caller=caller, callee=callee)


def answer(call: DirectCall, user, *, spoken: str | None, listen: str | None) -> None:
    if call.callee_id != user.id:
        raise DirectError("This call is not for you.", 403, "not_callee")
    reconcile(call)
    if call.status != DirectCall.Status.RINGING:
        raise DirectError("This call is no longer ringing.", 409, "not_ringing")
    try:
        plan_limits.check_call(user, video=call.room.video_enabled)
    except plan_limits.PlanLimit as exc:
        raise DirectError(str(exc), 403 if exc.code.startswith("plan_no") else 429, exc.code) from exc
    pref = get_preference(user)
    with transaction.atomic():
        CallParticipant.objects.get_or_create(
            room=call.room,
            user=user,
            defaults={
                "identity": f"user-{user.id}",
                "display_name": pref.display_name or user.username,
                "role": CallParticipant.Role.GUEST,
                "spoken_language": spoken or pref.spoken_language,
                "listen_language": listen or pref.listen_language,
                "voice": pref.voice or settings.DEFAULT_VOICE,
            },
        )
        call.status = DirectCall.Status.ANSWERED
        call.answered_at = timezone.now()
        call.save(update_fields=["status", "answered_at"])


# ---------- API ----------


class DirectCallSerializer(serializers.ModelSerializer):
    room_code = serializers.CharField(source="room.code")
    video = serializers.BooleanField(source="room.video_enabled")
    direction = serializers.SerializerMethodField()
    other_name = serializers.SerializerMethodField()
    other_username = serializers.SerializerMethodField()
    other_language = serializers.SerializerMethodField()

    class Meta:
        model = DirectCall
        fields = ["id", "room_code", "video", "direction", "status", "other_name", "other_username", "other_language", "created_at", "answered_at", "ended_at"]

    def _me(self):
        return self.context["request"].user

    def _other(self, obj):
        return obj.callee if obj.caller_id == self._me().id else obj.caller

    def get_direction(self, obj) -> str:
        return "outgoing" if obj.caller_id == self._me().id else "incoming"

    def get_other_name(self, obj) -> str:
        other = self._other(obj)
        return get_preference(other).display_name or other.username

    def get_other_username(self, obj) -> str:
        return self._other(obj).username

    def get_other_language(self, obj) -> str:
        """The caller's spoken language, shown on the incoming-call screen."""
        p = obj.room.participants.filter(user=self._other(obj)).first()
        return p.spoken_language if p else ""


class StartSerializer(serializers.Serializer):
    to = serializers.CharField(max_length=40)
    spoken_language = serializers.CharField(validators=[validate_language])
    listen_language = serializers.CharField(validators=[validate_language])
    voice = serializers.CharField(validators=[validate_voice], required=False, allow_blank=True)
    video = serializers.BooleanField(default=False)


class AnswerSerializer(serializers.Serializer):
    spoken_language = serializers.CharField(validators=[validate_language], required=False)
    listen_language = serializers.CharField(validators=[validate_language], required=False)


def _mine(request, pk) -> DirectCall:
    call = get_object_or_404(DirectCall.objects.select_related("room", "caller", "callee"), pk=pk)
    if request.user.id not in (call.caller_id, call.callee_id):
        raise Http404  # same answer as for a call that does not exist
    return call


def _error(exc: DirectError) -> Response:
    return Response({"detail": str(exc), "code": exc.code}, status=exc.status)


class DirectCallListCreateView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "direct_call"

    def get_throttles(self):
        return super().get_throttles() if self.request.method == "POST" else []

    def get(self, request):
        expire_ringing()
        calls = DirectCall.objects.filter(Q(caller=request.user) | Q(callee=request.user)).select_related("room", "caller", "callee")
        calls = [reconcile(c) for c in calls[:30]]
        return Response(DirectCallSerializer(calls, many=True, context={"request": request}).data)

    def post(self, request):
        s = StartSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        try:
            call = start(
                request.user, target=d["to"], spoken=d["spoken_language"], listen=d["listen_language"], video=d["video"], voice=d.get("voice", "")
            )
        except DirectError as exc:
            return _error(exc)
        return Response(DirectCallSerializer(call, context={"request": request}).data, status=status.HTTP_201_CREATED)


class DirectIncomingView(APIView):
    """Polled by the apps every few seconds while open."""

    throttle_classes = []

    def get(self, request):
        expire_ringing()
        ringing = [
            c
            for c in DirectCall.objects.filter(callee=request.user, status=DirectCall.Status.RINGING).select_related("room", "caller", "callee")
            if reconcile(c).status == DirectCall.Status.RINGING
        ]
        return Response(DirectCallSerializer(ringing, many=True, context={"request": request}).data)


class DirectCallDetailView(APIView):
    """The caller's screen polls this to learn whether the call was answered, declined or missed."""

    throttle_classes = []

    def get(self, request, pk):
        expire_ringing()
        call = reconcile(_mine(request, pk))
        return Response(DirectCallSerializer(call, context={"request": request}).data)


class DirectAnswerView(APIView):
    def post(self, request, pk):
        s = AnswerSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        call = _mine(request, pk)
        try:
            answer(call, request.user, spoken=s.validated_data.get("spoken_language"), listen=s.validated_data.get("listen_language"))
        except DirectError as exc:
            return _error(exc)
        return Response(DirectCallSerializer(call, context={"request": request}).data)


class DirectDeclineView(APIView):
    """Callee declines, or caller cancels while it rings."""

    def post(self, request, pk):
        call = _mine(request, pk)
        if call.status == DirectCall.Status.RINGING:
            declined = call.callee_id == request.user.id
            _finish(call, DirectCall.Status.DECLINED if declined else DirectCall.Status.CANCELLED, "declined" if declined else "cancelled")
        return Response(DirectCallSerializer(call, context={"request": request}).data)
