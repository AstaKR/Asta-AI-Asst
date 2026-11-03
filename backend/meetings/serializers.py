from pathlib import Path

from django.conf import settings
from rest_framework import serializers

from .audio import ALLOWED_EXTENSIONS
from .languages import AUTO, MEETING_LANGUAGES
from .models import ActionItem, Meeting, TranscriptSegment
from .transcription import ENGINES

LANG_CHOICES = list(MEETING_LANGUAGES)


class SegmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TranscriptSegment
        fields = [
            "index",
            "start_ms",
            "end_ms",
            "speaker",
            "language",
            "original_text",
            "translated_text",
            "translation_language",
            "origin",
            "edited_at",
        ]


class SegmentUpdateSerializer(serializers.Serializer):
    original_text = serializers.CharField(required=False, max_length=5000)
    translated_text = serializers.CharField(required=False, allow_blank=True, max_length=5000)
    speaker = serializers.CharField(required=False, allow_blank=True, max_length=80)


class ActionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActionItem
        fields = ["id", "order", "text", "owner_name", "deadline", "segment_indexes", "done"]
        read_only_fields = ["id", "order", "segment_indexes"]


class MeetingListSerializer(serializers.ModelSerializer):
    has_audio = serializers.SerializerMethodField()
    has_summary = serializers.SerializerMethodField()
    segment_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Meeting
        fields = [
            "id",
            "title",
            "source",
            "status",
            "progress",
            "spoken_language",
            "translation_language",
            "recorded_at",
            "duration_seconds",
            "has_audio",
            "has_summary",
            "segment_count",
            "created_at",
        ]

    def get_has_audio(self, obj) -> bool:
        return bool(obj.audio)

    def get_has_summary(self, obj) -> bool:
        return bool(obj.summary)


class MeetingDetailSerializer(MeetingListSerializer):
    segments = SegmentSerializer(many=True, read_only=True)
    action_items = ActionItemSerializer(many=True, read_only=True)
    room_code = serializers.SerializerMethodField()

    class Meta(MeetingListSerializer.Meta):
        fields = MeetingListSerializer.Meta.fields + [
            "error_message",
            "transcription_engine",
            "stt_seconds",
            "translate_chars",
            "audio_original_name",
            "audio_size",
            "summary",
            "summary_language",
            "summary_model",
            "summary_generated_at",
            "summary_error",
            "live_started_at",
            "room_code",
            "segments",
            "action_items",
        ]

    def get_room_code(self, obj):
        return obj.call_room.code if obj.call_room_id else None


class MeetingUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Meeting
        fields = ["title", "summary_language"]


class _ConsentMixin(serializers.Serializer):
    consent = serializers.BooleanField()

    def validate_consent(self, value):
        if value is not True:
            raise serializers.ValidationError("Confirm that everyone recorded agreed to the recording and its AI processing.")
        return value


class MeetingUploadSerializer(_ConsentMixin):
    file = serializers.FileField()
    title = serializers.CharField(max_length=200)
    source = serializers.ChoiceField(choices=[Meeting.Source.UPLOAD, Meeting.Source.RECORDING], default=Meeting.Source.UPLOAD)
    spoken_language = serializers.ChoiceField(choices=[AUTO, *LANG_CHOICES], default=AUTO)
    translation_language = serializers.ChoiceField(choices=["", *LANG_CHOICES], default="", allow_blank=True)
    engine = serializers.ChoiceField(choices=list(ENGINES), required=False)
    recorded_at = serializers.DateTimeField(required=False)

    def validate_file(self, f):
        ext = Path(f.name or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise serializers.ValidationError(
                f"Unsupported file type {ext or '(none)'}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
            )
        limit = settings.MEETING_MAX_UPLOAD_MB * 1024 * 1024
        if f.size > limit:
            raise serializers.ValidationError(f"The file is larger than {settings.MEETING_MAX_UPLOAD_MB} MB.")
        if f.size == 0:
            raise serializers.ValidationError("The file is empty.")
        return f


class LiveMeetingSerializer(_ConsentMixin):
    title = serializers.CharField(max_length=200)
    spoken_language = serializers.ChoiceField(choices=LANG_CHOICES)
    translation_language = serializers.ChoiceField(choices=["", *LANG_CHOICES], default="", allow_blank=True)
    voice_playback = serializers.BooleanField(default=False)


class TranslateSerializer(serializers.Serializer):
    language = serializers.ChoiceField(choices=LANG_CHOICES)


class SummarizeSerializer(serializers.Serializer):
    language = serializers.ChoiceField(choices=LANG_CHOICES, required=False)


class InternalSegmentSerializer(serializers.Serializer):
    room_name = serializers.CharField(max_length=64)
    utterance_id = serializers.CharField(max_length=120)
    speaker_identity = serializers.CharField(max_length=64, required=False, allow_blank=True)
    speaker_name = serializers.CharField(max_length=80, required=False, allow_blank=True)
    language = serializers.CharField(max_length=10, required=False, allow_blank=True)
    text = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    translation = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    translation_language = serializers.CharField(max_length=10, required=False, allow_blank=True)
    start_epoch_ms = serializers.IntegerField(min_value=0)
    end_epoch_ms = serializers.IntegerField(min_value=0)
