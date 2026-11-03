from django.conf import settings
from django.db import models


class AssistantUsage(models.Model):
    """One assistant request. Messages and images are never stored, only token counts for cost control."""

    class Kind(models.TextChoices):
        CHAT = "chat", "Chat"
        IMAGE = "image", "Photo translation"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assistant_usage")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    model = models.CharField(max_length=60)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
