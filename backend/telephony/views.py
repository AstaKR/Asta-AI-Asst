import logging

from django.conf import settings
from django.shortcuts import get_object_or_404
from livekit import api
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.validators import validate_language

from . import services
from .models import PhoneCall, PhoneLine

log = logging.getLogger(__name__)


class PhoneCallSerializer(serializers.ModelSerializer):
    room_code = serializers.CharField(source="room.code")
    remote_number = serializers.SerializerMethodField()

    class Meta:
        model = PhoneCall
        fields = ["id", "room_code", "direction", "status", "remote_number", "line_number", "caller_language", "created_at", "answered_at", "ended_at"]

    def get_remote_number(self, obj):
        return obj.remote_number  # the owner's own call: shown in full to them only


class DialSerializer(serializers.Serializer):
    number = serializers.CharField(max_length=24)
    spoken_language = serializers.CharField(validators=[validate_language])
    listen_language = serializers.CharField(validators=[validate_language])
    caller_language = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_caller_language(self, value):
        if value:
            validate_language(value)
        return value


def _own_call(request, pk) -> PhoneCall:
    return get_object_or_404(PhoneCall.objects.select_related("room"), pk=pk, owner=request.user)


class PhoneConfigView(APIView):
    def get(self, request):
        lines = PhoneLine.objects.filter(user=request.user, active=True).values_list("number", flat=True)
        return Response(
            {
                "enabled": settings.TELEPHONY_ENABLED,
                "dial_enabled": services.dial_ready(),
                "my_lines": list(lines),
                "forwarding_number": settings.PHONE_FORWARDING_NUMBER or None,
                "allowed_prefixes": settings.PHONE_DIAL_ALLOWED_PREFIXES,
                "ring_seconds": settings.PHONE_RING_SECONDS,
            }
        )


class DialView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "dial"

    def post(self, request):
        s = DialSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        try:
            call = services.start_outbound(
                request.user, number=d["number"], spoken=d["spoken_language"], listen=d["listen_language"], caller_language=d["caller_language"]
            )
        except services.PhoneError as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=exc.status)
        return Response(PhoneCallSerializer(call).data, status=201)


class PhoneCallListView(APIView):
    def get(self, request):
        services.expire_ringing()
        calls = list(PhoneCall.objects.filter(owner=request.user).select_related("room")[:30])
        for c in calls:
            services.reconcile(c)
        return Response(PhoneCallSerializer(calls, many=True).data)


class IncomingView(APIView):
    """Polled by the app (every few seconds while open) until push notifications exist."""

    throttle_classes = []

    def get(self, request):
        services.expire_ringing()
        ringing = PhoneCall.objects.filter(owner=request.user, direction=PhoneCall.Direction.INBOUND, status=PhoneCall.Status.RINGING).select_related("room")
        return Response(PhoneCallSerializer(ringing, many=True).data)


class AnswerView(APIView):
    def post(self, request, pk):
        call = _own_call(request, pk)
        try:
            services.answer(call)
        except services.PhoneError as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=exc.status)
        return Response(PhoneCallSerializer(call).data)


class DeclineView(APIView):
    def post(self, request, pk):
        call = _own_call(request, pk)
        services.decline(call)
        return Response(PhoneCallSerializer(call).data)


class ConnectedView(APIView):
    """The call screen saw the phone side's sip.callStatus become "active"."""

    def post(self, request, pk):
        call = _own_call(request, pk)
        services.mark_connected(call)
        return Response(PhoneCallSerializer(call).data)


class LiveKitWebhookView(APIView):
    """LiveKit server webhooks. Authenticated by LiveKit's signed JWT (sha256 of the body), not by session."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def post(self, request):
        receiver = api.WebhookReceiver(api.TokenVerifier(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET))
        try:
            event = receiver.receive(request.body.decode("utf-8"), request.headers.get("Authorization", ""))
        except Exception:
            return Response({"detail": "invalid signature"}, status=401)
        try:
            services.handle_event(event)
        except Exception:
            log.exception("webhook handling failed for %s", event.event)
            return Response({"detail": "error"}, status=500)  # LiveKit retries
        return Response({"ok": True})

