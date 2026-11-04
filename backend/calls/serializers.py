from rest_framework import serializers

from accounts.validators import validate_language, validate_voice

from .models import CallParticipant, CallRoom, CallUsage


class LanguageSelectionSerializer(serializers.Serializer):
    spoken_language = serializers.CharField(validators=[validate_language])
    listen_language = serializers.CharField(validators=[validate_language])
    voice = serializers.CharField(validators=[validate_voice], required=False, allow_blank=True)


class RoomCreateSerializer(LanguageSelectionSerializer):
    video = serializers.BooleanField(default=False)


class ParticipantSerializer(serializers.ModelSerializer):
    is_you = serializers.SerializerMethodField()

    class Meta:
        model = CallParticipant
        fields = ["identity", "display_name", "role", "spoken_language", "listen_language", "voice", "is_you", "left_at"]

    def get_is_you(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and request.user.id == obj.user_id)


class UsageSerializer(serializers.ModelSerializer):
    class Meta:
        model = CallUsage
        fields = [
            "stt_seconds",
            "translate_chars",
            "tts_chars",
            "provider_requests",
            "provider_errors",
            "utterances",
            "dropped_utterances",
            "reconnects",
            "latency",
            "finalized",
            "updated_at",
        ]


class RoomSerializer(serializers.ModelSerializer):
    participants = ParticipantSerializer(many=True, read_only=True)
    duration_seconds = serializers.IntegerField(read_only=True)
    usage = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()
    direct = serializers.SerializerMethodField()

    class Meta:
        model = CallRoom
        fields = [
            "code",
            "status",
            "translation_enabled",
            "video_enabled",
            "max_duration_seconds",
            "invite_expires_at",
            "created_at",
            "started_at",
            "ended_at",
            "end_reason",
            "duration_seconds",
            "participants",
            "usage",
            "phone",
            "direct",
        ]

    def get_usage(self, obj):
        usage = getattr(obj, "usage", None)
        return UsageSerializer(usage).data if usage else None

    def get_phone(self, obj):
        """Set when this room bridges a normal phone call (telephony app)."""
        call = getattr(obj, "phone_call", None)
        if call is None:
            return None
        return {"id": str(call.id), "direction": call.direction, "status": call.status, "remote_number": call.remote_number, "sip_identity": call.sip_identity}

    def get_direct(self, obj):
        """Set when this room is an app-to-app call: the caller's screen shows ringing / declined / missed."""
        call = getattr(obj, "direct_call", None)
        if call is None:
            return None
        from accounts.models import get_preference

        return {"id": str(call.id), "status": call.status, "callee_name": get_preference(call.callee).display_name or call.callee.username}


class RoomPreviewSerializer(serializers.ModelSerializer):
    """What a signed-in non-member may see before joining via an invite code."""

    host_name = serializers.SerializerMethodField()
    participant_count = serializers.SerializerMethodField()

    class Meta:
        model = CallRoom
        fields = ["code", "status", "translation_enabled", "video_enabled", "host_name", "participant_count", "invite_expires_at"]

    def get_host_name(self, obj):
        host = obj.participants.filter(role=CallParticipant.Role.HOST).first()
        return host.display_name if host else None

    def get_participant_count(self, obj):
        return obj.participants.count()


class LatencyStatSerializer(serializers.Serializer):
    count = serializers.IntegerField(min_value=0)
    avg = serializers.FloatField(min_value=0)
    p50 = serializers.FloatField(min_value=0)
    p95 = serializers.FloatField(min_value=0)
    max = serializers.FloatField(min_value=0)


class WorkerUsageReportSerializer(serializers.Serializer):
    room_name = serializers.CharField(max_length=64)
    stt_seconds = serializers.FloatField(min_value=0)
    translate_chars = serializers.IntegerField(min_value=0)
    tts_chars = serializers.IntegerField(min_value=0)
    provider_requests = serializers.IntegerField(min_value=0, default=0)
    provider_errors = serializers.IntegerField(min_value=0, default=0)
    utterances = serializers.IntegerField(min_value=0, default=0)
    dropped_utterances = serializers.IntegerField(min_value=0, default=0)
    reconnects = serializers.IntegerField(min_value=0, default=0)
    latency = serializers.DictField(child=LatencyStatSerializer(), required=False, default=dict)
    final = serializers.BooleanField(default=False)
