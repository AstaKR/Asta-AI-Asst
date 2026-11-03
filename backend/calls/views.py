import hmac
import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import get_preference
from billing import limits as plan_limits

from . import livekit_service, usage
from .models import CallParticipant, CallRoom, CallUsage
from .serializers import (
    LanguageSelectionSerializer,
    RoomCreateSerializer,
    RoomPreviewSerializer,
    RoomSerializer,
    WorkerUsageReportSerializer,
)

log = logging.getLogger(__name__)


class HealthView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            db_ok = True
        except Exception:
            db_ok = False
        return Response(
            {
                "status": "ok" if db_ok else "degraded",
                "database": db_ok,
                "livekit_configured": bool(settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET),
                "translation_enabled": settings.TRANSLATION_ENABLED,
                "video_calls": settings.VIDEO_CALLS_ENABLED,
            },
            status=status.HTTP_200_OK if db_ok else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


def _get_room(code: str) -> CallRoom:
    return get_object_or_404(CallRoom, code=code.strip().upper())


def _get_membership(room: CallRoom, user) -> CallParticipant:
    participant = room.participants.filter(user=user).first()
    if participant is None:
        raise PermissionDenied("You are not a participant in this call.")
    return participant


def _end_room(room: CallRoom, reason: str) -> None:
    if room.is_ended:
        return
    room.status = CallRoom.Status.ENDED
    room.ended_at = timezone.now()
    room.end_reason = reason
    room.save(update_fields=["status", "ended_at", "end_reason"])
    livekit_service.delete_room(room)
    from meetings.services import finalize_live_meetings

    finalize_live_meetings(room)


def _expire_if_over_time(room: CallRoom) -> None:
    if not room.is_ended and room.started_at and room.duration_seconds >= room.max_duration_seconds:
        _end_room(room, "max_call_duration")


class RoomListCreateView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "room_create"

    def get_throttles(self):
        # Only throttle creation, not listing.
        return super().get_throttles() if self.request.method == "POST" else []

    def get(self, request):
        rooms = (
            CallRoom.objects.filter(participants__user=request.user)
            .select_related("usage")
            .prefetch_related("participants")
            .distinct()[:20]
        )
        return Response(RoomSerializer(rooms, many=True, context={"request": request}).data)

    def post(self, request):
        selection = RoomCreateSerializer(data=request.data)
        selection.is_valid(raise_exception=True)
        if selection.validated_data["video"] and not settings.VIDEO_CALLS_ENABLED:
            return Response({"detail": "Video calls are turned off on this server.", "code": "video_disabled"}, status=400)
        try:
            plan_limits.check_call(request.user, video=selection.validated_data["video"])
        except plan_limits.PlanLimit as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=403 if exc.code.startswith("plan_no") else 429)
        budget = usage.check_daily_call_budget()
        if not budget.allowed:
            return Response({"detail": "Daily call limit reached.", "code": budget.reason}, status=429)
        pref = get_preference(request.user)
        with transaction.atomic():
            room = CallRoom.objects.create(
                created_by=request.user,
                translation_enabled=settings.TRANSLATION_ENABLED and usage.ai_budget_available(),
                max_duration_seconds=settings.MAX_CALL_DURATION_SECONDS,
                video_enabled=selection.validated_data["video"],
                invite_expires_at=timezone.now() + timedelta(seconds=settings.ROOM_INVITE_TTL_SECONDS),
            )
            CallParticipant.objects.create(
                room=room,
                user=request.user,
                identity=f"user-{request.user.id}",
                display_name=pref.display_name or request.user.username,
                role=CallParticipant.Role.HOST,
                spoken_language=selection.validated_data["spoken_language"],
                listen_language=selection.validated_data["listen_language"],
                voice=selection.validated_data.get("voice") or pref.voice or settings.DEFAULT_VOICE,
            )
        return Response(RoomSerializer(room, context={"request": request}).data, status=status.HTTP_201_CREATED)


class RoomDetailView(APIView):
    def get(self, request, code):
        room = _get_room(code)
        _expire_if_over_time(room)
        if room.participants.filter(user=request.user).exists():
            return Response(RoomSerializer(room, context={"request": request}).data)
        return Response(RoomPreviewSerializer(room).data)


class RoomJoinView(APIView):
    def post(self, request, code):
        selection = LanguageSelectionSerializer(data=request.data)
        selection.is_valid(raise_exception=True)
        try:
            plan_limits.check_call(request.user, video=_get_room(code).video_enabled)
        except plan_limits.PlanLimit as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=403 if exc.code.startswith("plan_no") else 429)
        pref = get_preference(request.user)
        with transaction.atomic():
            room = CallRoom.objects.select_for_update().get(pk=_get_room(code).pk)
            existing = room.participants.filter(user=request.user).first()
            if room.is_ended:
                return Response({"detail": "This call has ended.", "code": "room_ended"}, status=410)
            if existing is None:
                if room.invite_expires_at < timezone.now():
                    return Response({"detail": "This invite has expired.", "code": "invite_expired"}, status=410)
                if room.participants.count() >= settings.MAX_PARTICIPANTS:
                    return Response({"detail": "This call is full.", "code": "room_full"}, status=409)
                try:
                    existing = CallParticipant.objects.create(
                        room=room,
                        user=request.user,
                        identity=f"user-{request.user.id}",
                        display_name=pref.display_name or request.user.username,
                        role=CallParticipant.Role.GUEST,
                        spoken_language=selection.validated_data["spoken_language"],
                        listen_language=selection.validated_data["listen_language"],
                        voice=selection.validated_data.get("voice") or pref.voice or settings.DEFAULT_VOICE,
                    )
                except IntegrityError:
                    return Response({"detail": "Already joined."}, status=409)
            else:
                existing.spoken_language = selection.validated_data["spoken_language"]
                existing.listen_language = selection.validated_data["listen_language"]
                if selection.validated_data.get("voice"):
                    existing.voice = selection.validated_data["voice"]
                existing.save()
        return Response(RoomSerializer(room, context={"request": request}).data)


class RoomTokenView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "token"

    def post(self, request, code):
        with transaction.atomic():
            room = CallRoom.objects.select_for_update().get(pk=_get_room(code).pk)
            participant = _get_membership(room, request.user)
            _expire_if_over_time(room)
            if room.is_ended:
                return Response({"detail": "This call has ended.", "code": "room_ended"}, status=410)
            if room.started_at is None:
                budget = usage.check_daily_call_budget()
                if not budget.allowed:
                    return Response({"detail": "Daily call limit reached.", "code": budget.reason}, status=429)
                room.started_at = timezone.now()
                room.status = CallRoom.Status.ACTIVE
                room.save(update_fields=["started_at", "status"])
            if participant.first_token_at is None:
                participant.first_token_at = timezone.now()
            participant.left_at = None
            participant.save(update_fields=["first_token_at", "left_at"])
        try:
            token = livekit_service.build_token(room, participant)
        except livekit_service.LiveKitNotConfigured:
            return Response({"detail": "Calling is not configured on the server."}, status=503)
        return Response(
            {
                "token": token,
                "url": livekit_service.client_url(request),
                "identity": participant.identity,
                "expires_in": settings.LIVEKIT_TOKEN_TTL_SECONDS,
                "room": RoomSerializer(room, context={"request": request}).data,
            }
        )


class RoomLanguagesView(APIView):
    """Change your own languages mid-call; the worker re-routes from the updated participant attributes."""

    def patch(self, request, code):
        room = _get_room(code)
        participant = _get_membership(room, request.user)
        if room.is_ended:
            return Response({"detail": "This call has ended."}, status=410)
        selection = LanguageSelectionSerializer(data=request.data)
        selection.is_valid(raise_exception=True)
        participant.spoken_language = selection.validated_data["spoken_language"]
        participant.listen_language = selection.validated_data["listen_language"]
        if selection.validated_data.get("voice"):
            participant.voice = selection.validated_data["voice"]
        participant.save()
        pushed = room.status == CallRoom.Status.ACTIVE and livekit_service.update_participant_attributes(
            room, participant
        )
        data = RoomSerializer(room, context={"request": request}).data
        data["live_update_applied"] = bool(pushed)
        return Response(data)


class RoomLeaveView(APIView):
    def post(self, request, code):
        room = _get_room(code)
        participant = _get_membership(room, request.user)
        participant.left_at = timezone.now()
        participant.save(update_fields=["left_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class RoomEndView(APIView):
    def post(self, request, code):
        room = _get_room(code)
        _get_membership(room, request.user)
        _end_room(room, "ended_by_participant")
        room.refresh_from_db()
        return Response(RoomSerializer(room, context={"request": request}).data)


class UsageSummaryView(APIView):
    def get(self, request):
        today = usage.daily_totals()
        mine = CallUsage.objects.filter(room__participants__user=request.user).distinct()
        my_rooms = CallRoom.objects.filter(participants__user=request.user).distinct()
        return Response(
            {
                "today": today,
                "daily_limits": settings.DAILY_LIMITS,
                "per_call_limits": settings.PER_CALL_LIMITS,
                "max_call_duration_seconds": settings.MAX_CALL_DURATION_SECONDS,
                "translation_enabled": settings.TRANSLATION_ENABLED,
                "mine": {
                    "calls": my_rooms.count(),
                    "call_seconds": sum(r.duration_seconds for r in my_rooms),
                    "stt_seconds": round(sum(u.stt_seconds for u in mine), 1),
                    "tts_chars": sum(u.tts_chars for u in mine),
                    "translate_chars": sum(u.translate_chars for u in mine),
                },
            }
        )


class WorkerSecretPermission(BasePermission):
    def has_permission(self, request, view):
        expected = settings.WORKER_SHARED_SECRET
        provided = request.headers.get("X-Worker-Secret", "")
        return bool(expected) and hmac.compare_digest(expected.encode(), provided.encode())


class WorkerUsageReportView(APIView):
    """Internal: the translation worker reports cumulative usage and learns whether it may continue."""

    authentication_classes = []
    permission_classes = [WorkerSecretPermission]
    throttle_classes = []

    def post(self, request):
        report = WorkerUsageReportSerializer(data=request.data)
        report.is_valid(raise_exception=True)
        data = report.validated_data
        room = get_object_or_404(CallRoom, livekit_room_name=data["room_name"])
        record, _ = CallUsage.objects.get_or_create(room=room)
        for field in (
            "stt_seconds",
            "translate_chars",
            "tts_chars",
            "provider_requests",
            "provider_errors",
            "utterances",
            "dropped_utterances",
            "reconnects",
        ):
            # Totals are cumulative; never let a stale/out-of-order report reduce them.
            setattr(record, field, max(getattr(record, field), data[field]))
        if data["latency"]:
            record.latency = data["latency"]
        record.finalized = record.finalized or data["final"]
        record.save()
        decision = usage.check_usage_report(room, data)
        if room.is_ended:
            decision = usage.LimitCheck(False, "room_ended")
        elif decision.reason == "max_call_duration":
            _end_room(room, "max_call_duration")
        return Response({"allowed": decision.allowed, "reason": decision.reason})
