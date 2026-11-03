import uuid

from django.conf import settings
from django.db import models

from .languages import AUTO, MEETING_LANGUAGES

LANGUAGE_CHOICES = list(MEETING_LANGUAGES.items())
SPOKEN_CHOICES = [(AUTO, "Detect automatically"), *LANGUAGE_CHOICES]


def meeting_audio_path(instance, filename: str) -> str:
    # Never trust the uploaded name for paths: <owner>/<meeting uuid>/<kind><ext>.
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return f"meetings/{instance.owner_id}/{instance.id}/original{ext[:6]}"


class Meeting(models.Model):
    class Source(models.TextChoices):
        UPLOAD = "upload", "Uploaded file"
        RECORDING = "recording", "Browser recording"
        LIVE = "live", "Live meeting (LiveKit)"
        CALL = "call", "Translated call (LiveKit)"

    class Status(models.TextChoices):
        DRAFT = "draft", "Waiting for audio"
        LIVE = "live", "Live session in progress"
        QUEUED = "queued", "Queued"
        TRANSCRIBING = "transcribing", "Transcribing"
        TRANSLATING = "translating", "Translating"
        SUMMARIZING = "summarizing", "Writing summary"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="meetings")
    title = models.CharField(max_length=200)
    source = models.CharField(max_length=12, choices=Source.choices)
    # Links a live/call transcript to the existing call record instead of duplicating it.
    call_room = models.ForeignKey("calls.CallRoom", null=True, blank=True, on_delete=models.SET_NULL, related_name="meetings")
    spoken_language = models.CharField(max_length=4, choices=SPOKEN_CHOICES, default=AUTO)
    translation_language = models.CharField(max_length=4, choices=LANGUAGE_CHOICES, blank=True)
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.DRAFT)
    progress = models.PositiveSmallIntegerField(default=0)  # 0-100 for the current job
    error_message = models.CharField(max_length=500, blank=True)

    consent_confirmed_at = models.DateTimeField()  # recording/storage only after explicit consent
    recorded_at = models.DateTimeField()  # when the meeting happened (shown in history)
    # Live sessions: when the browser recording started; live segment offsets are measured from here.
    live_started_at = models.DateTimeField(null=True, blank=True)

    audio = models.FileField(upload_to=meeting_audio_path, blank=True, max_length=255)
    audio_playback = models.FileField(blank=True, max_length=255)  # seekable MP3 copy for the player
    audio_original_name = models.CharField(max_length=255, blank=True)
    audio_size = models.PositiveBigIntegerField(default=0)
    duration_seconds = models.FloatField(default=0)

    transcription_engine = models.CharField(max_length=12, blank=True)
    stt_seconds = models.FloatField(default=0)  # billed audio seconds (cloud engine only)
    translate_chars = models.PositiveIntegerField(default=0)

    # Structured notes (validated before saving): see summary/schema.py
    summary = models.JSONField(null=True, blank=True)
    summary_text = models.TextField(blank=True)  # plain-text copy of the notes, for search
    summary_language = models.CharField(max_length=4, choices=LANGUAGE_CHOICES, default="en")
    summary_model = models.CharField(max_length=60, blank=True)
    summary_generated_at = models.DateTimeField(null=True, blank=True)
    summary_error = models.CharField(max_length=500, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-recorded_at", "-created_at"]
        indexes = [models.Index(fields=["owner", "recorded_at"]), models.Index(fields=["owner", "status"])]

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


class TranscriptSegment(models.Model):
    class Origin(models.TextChoices):
        ASR = "asr", "Speech recognition"
        LIVE = "live", "Live (LiveKit)"

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="segments")
    index = models.PositiveIntegerField()
    start_ms = models.PositiveIntegerField()
    end_ms = models.PositiveIntegerField()
    speaker = models.CharField(max_length=80, blank=True)
    language = models.CharField(max_length=4, blank=True)  # detected/declared language of original_text
    original_text = models.TextField()
    translated_text = models.TextField(blank=True)
    translation_language = models.CharField(max_length=4, blank=True)
    origin = models.CharField(max_length=4, choices=Origin.choices, default=Origin.ASR)
    external_id = models.CharField(max_length=120, blank=True)  # live utterance id (idempotent updates)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["meeting", "index"]
        constraints = [models.UniqueConstraint(fields=["meeting", "index"], name="unique_segment_index")]

    def __str__(self) -> str:
        return f"{self.meeting_id}#{self.index}"


class ActionItem(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="action_items")
    order = models.PositiveIntegerField(default=0)
    text = models.CharField(max_length=500)
    owner_name = models.CharField(max_length=120, blank=True)  # only when explicitly identified
    deadline = models.CharField(max_length=120, blank=True)  # only when explicitly stated
    segment_indexes = models.JSONField(default=list, blank=True)  # evidence in the transcript
    done = models.BooleanField(default=False)

    class Meta:
        ordering = ["meeting", "order"]

    def __str__(self) -> str:
        return self.text[:60]


class MeetingJob(models.Model):
    """Durable background work (transcription takes minutes, so it never runs inside a request)."""

    class Kind(models.TextChoices):
        PREPARE = "prepare", "Prepare audio for playback"
        TRANSCRIBE = "transcribe", "Transcribe + translate"
        SUMMARIZE = "summarize", "Summarize"

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="jobs")
    kind = models.CharField(max_length=12, choices=Kind.choices)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.QUEUED)
    attempts = models.PositiveSmallIntegerField(default=0)
    error = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["status", "created_at"])]
