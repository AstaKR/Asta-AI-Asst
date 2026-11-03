"""AI assistant endpoints. Conversations are sent by the app each time and never stored on the server."""

import logging
from datetime import datetime, time

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from billing import limits as plan_limits
from meetings.errors import ProviderError
from meetings.languages import MEETING_LANGUAGES

from .claude import AssistantClient, assistant_enabled
from .models import AssistantUsage

log = logging.getLogger(__name__)

# Magic bytes -> media type. Only formats Claude accepts; the declared content type is not trusted.
IMAGE_SIGNATURES = [(b"\xff\xd8\xff", "image/jpeg"), (b"\x89PNG\r\n\x1a\n", "image/png")]


def sniff_image(head: bytes) -> str | None:
    for sig, media in IMAGE_SIGNATURES:
        if head.startswith(sig):
            return media
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


class Message(serializers.Serializer):
    role = serializers.ChoiceField(choices=["user", "assistant"])
    content = serializers.CharField(max_length=4000, trim_whitespace=True)


class ChatSerializer(serializers.Serializer):
    messages = Message(many=True, allow_empty=False, max_length=20)
    language = serializers.ChoiceField(choices=list(MEETING_LANGUAGES), default="en")

    def validate_messages(self, messages):
        if messages[0]["role"] != "user" or messages[-1]["role"] != "user":
            raise serializers.ValidationError("The conversation must start and end with your message.")
        if any(a["role"] == b["role"] for a, b in zip(messages, messages[1:])):
            raise serializers.ValidationError("Messages must alternate between you and the assistant.")
        if sum(len(m["content"]) for m in messages) > settings.ASSISTANT_MAX_CONVERSATION_CHARS:
            raise serializers.ValidationError("The conversation is too long; start a new one.")
        return messages


class ImageSerializer(serializers.Serializer):
    image = serializers.FileField()
    language = serializers.ChoiceField(choices=list(MEETING_LANGUAGES), default="en")


def _today_start():
    now = timezone.localtime()
    return timezone.make_aware(datetime.combine(now.date(), time.min), now.tzinfo)


def limit_reached(user) -> str | None:
    today = AssistantUsage.objects.filter(created_at__gte=_today_start())
    if today.filter(user=user).count() >= settings.ASSISTANT_DAILY_REQUESTS_PER_USER:
        return "You have reached today's assistant limit. Try again tomorrow."
    if today.count() >= settings.ASSISTANT_DAILY_REQUESTS:
        return "The assistant's daily limit for this service has been reached. Try again tomorrow."
    return None


class _AssistantView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assistant"

    def _guard(self, request):
        if not assistant_enabled():
            return Response({"detail": "The assistant is not configured on the server (ANTHROPIC_API_KEY).", "code": "not_configured"}, status=503)
        if message := limit_reached(request.user):
            return Response({"detail": message, "code": "budget"}, status=429)
        try:
            plan_limits.check_assistant(request.user)
        except plan_limits.PlanLimit as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=429)
        return None

    def _record(self, request, kind, usage):
        AssistantUsage.objects.create(user=request.user, kind=kind, model=usage.model, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)

    @staticmethod
    def _provider_error(exc: ProviderError):
        log.warning("assistant provider error: %s", exc)
        return Response({"detail": str(exc), "code": "provider"}, status=502)


class AssistantConfigView(APIView):
    def get(self, request):
        return Response(
            {
                "enabled": assistant_enabled(),
                "max_image_mb": settings.ASSISTANT_MAX_IMAGE_MB,
                "daily_requests_per_user": settings.ASSISTANT_DAILY_REQUESTS_PER_USER,
            }
        )


class AssistantChatView(_AssistantView):
    def post(self, request):
        s = ChatSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if blocked := self._guard(request):
            return blocked
        try:
            reply, usage = AssistantClient().chat([dict(m) for m in s.validated_data["messages"]], s.validated_data["language"])
        except ProviderError as exc:
            return self._provider_error(exc)
        self._record(request, AssistantUsage.Kind.CHAT, usage)
        return Response({"reply": reply})


class AssistantImageView(_AssistantView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        s = ImageSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        upload = s.validated_data["image"]
        if upload.size > settings.ASSISTANT_MAX_IMAGE_MB * 1024 * 1024:
            return Response({"detail": f"The image is larger than {settings.ASSISTANT_MAX_IMAGE_MB} MB."}, status=400)
        data = upload.read()
        media_type = sniff_image(data[:16])
        if media_type is None:
            return Response({"detail": "Use a JPEG, PNG or WebP image."}, status=400)
        if blocked := self._guard(request):
            return blocked
        try:
            result, usage = AssistantClient().read_image(data, media_type, s.validated_data["language"])
        except ProviderError as exc:
            return self._provider_error(exc)
        self._record(request, AssistantUsage.Kind.IMAGE, usage)
        return Response({**result.model_dump(), "language": s.validated_data["language"]})
