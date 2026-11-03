from django.conf import settings
from django.db import models


class QuickUsage(models.Model):
    """Usage of one instant / face-to-face translation. The text and audio themselves are never stored."""

    class Kind(models.TextChoices):
        TEXT = "text", "Text"
        SPEECH = "speech", "Speech"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quick_usage")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    source_language = models.CharField(max_length=8, blank=True)
    target_language = models.CharField(max_length=8)
    stt_seconds = models.FloatField(default=0)
    translate_chars = models.PositiveIntegerField(default=0)
    tts_chars = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
