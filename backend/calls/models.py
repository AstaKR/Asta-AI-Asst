import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

# Unambiguous alphabet for invite codes (no 0/O/1/I/L).
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_room_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))


class CallRoom(models.Model):
    class Status(models.TextChoices):
        WAITING = "waiting", "Waiting for participants"
        ACTIVE = "active", "Active"
        ENDED = "ended", "Ended"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=8, unique=True, default=generate_room_code)
    livekit_room_name = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_rooms")
    class Mode(models.TextChoices):
        CALL = "call", "Two-person translated call"
        MEETING = "meeting", "Live meeting (one person, transcription)"

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.WAITING)
    mode = models.CharField(max_length=8, choices=Mode.choices, default=Mode.CALL)
    # Transcript storage for this room; only true after every participant consented (or a live meeting).
    save_transcript = models.BooleanField(default=False)
    # Video call: participants may also publish their camera. Translation stays audio-based.
    video_enabled = models.BooleanField(default=False)
    translation_enabled = models.BooleanField(default=True)
    max_duration_seconds = models.PositiveIntegerField()
    invite_expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    end_reason = models.CharField(max_length=40, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.livekit_room_name:
            self.livekit_room_name = f"call-{self.id.hex}"
        super().save(*args, **kwargs)

    @property
    def is_ended(self) -> bool:
        return self.status == self.Status.ENDED

    @property
    def duration_seconds(self) -> int:
        if not self.started_at:
            return 0
        end = self.ended_at or timezone.now()
        return max(0, int((end - self.started_at).total_seconds()))

    def __str__(self) -> str:
        return f"{self.code} ({self.status})"


class CallParticipant(models.Model):
    class Role(models.TextChoices):
        HOST = "host", "Host"
        GUEST = "guest", "Guest"

    room = models.ForeignKey(CallRoom, on_delete=models.CASCADE, related_name="participants")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="call_participations")
    identity = models.CharField(max_length=64)
    display_name = models.CharField(max_length=60)
    role = models.CharField(max_length=8, choices=Role.choices)
    spoken_language = models.CharField(max_length=10)
    listen_language = models.CharField(max_length=10)
    voice = models.CharField(max_length=40, blank=True)
    voice_playback = models.BooleanField(default=True)  # live meetings: speak translations aloud
    transcript_consent = models.BooleanField(default=False)
    added_at = models.DateTimeField(auto_now_add=True)
    first_token_at = models.DateTimeField(null=True, blank=True)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["room", "user"], name="unique_user_per_room"),
            models.UniqueConstraint(fields=["room", "identity"], name="unique_identity_per_room"),
        ]
        ordering = ["added_at"]

    def livekit_attributes(self) -> dict[str, str]:
        """Signed into the LiveKit token; the translation worker routes audio from these."""
        return {
            "role": self.role,
            "display_name": self.display_name,
            "spoken_language": self.spoken_language,
            "listen_language": self.listen_language,
            "voice": self.voice,
            "voice_playback": "on" if self.voice_playback else "off",
        }

    def __str__(self) -> str:
        return f"{self.identity} in {self.room.code}"


class CallUsage(models.Model):
    """Provider usage for one call, reported by the translation worker as cumulative totals.

    No audio and no transcript text is stored here — only counters and latency statistics.
    """

    room = models.OneToOneField(CallRoom, on_delete=models.CASCADE, related_name="usage")
    stt_seconds = models.FloatField(default=0)
    translate_chars = models.PositiveIntegerField(default=0)
    tts_chars = models.PositiveIntegerField(default=0)
    provider_requests = models.PositiveIntegerField(default=0)
    provider_errors = models.PositiveIntegerField(default=0)
    utterances = models.PositiveIntegerField(default=0)
    dropped_utterances = models.PositiveIntegerField(default=0)
    reconnects = models.PositiveIntegerField(default=0)
    # {"end_to_audio_ms": {"count", "avg", "p50", "p95", "max"}, "first_transcript_ms": {...}, ...}
    latency = models.JSONField(default=dict, blank=True)
    finalized = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"usage for {self.room.code}"
