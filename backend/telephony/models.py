import uuid

from django.conf import settings
from django.db import models

from calls.models import CallRoom


class PhoneLine(models.Model):
    """A virtual number (on the SIP trunk) that belongs to one user. Calls to it ring that user's app."""

    number = models.CharField(max_length=16, unique=True, help_text="E.164, e.g. +918045671234")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="phone_lines")
    label = models.CharField(max_length=60, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.number} → {self.user}"


class PhoneCall(models.Model):
    """A normal phone call bridged into a translated call room through LiveKit SIP."""

    class Direction(models.TextChoices):
        INBOUND = "inbound", "Incoming"
        OUTBOUND = "outbound", "Outgoing"

    class Status(models.TextChoices):
        RINGING = "ringing", "Ringing"  # inbound: waiting for the app user to answer; outbound: dialling
        ANSWERED = "answered", "Answered"
        MISSED = "missed", "Missed"
        DECLINED = "declined", "Declined"
        FAILED = "failed", "Failed"
        ENDED = "ended", "Ended"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room = models.OneToOneField(CallRoom, on_delete=models.CASCADE, related_name="phone_call")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="phone_calls")
    direction = models.CharField(max_length=8, choices=Direction.choices)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.RINGING)
    remote_number = models.CharField(max_length=20, blank=True)
    line_number = models.CharField(max_length=20, blank=True)
    caller_language = models.CharField(max_length=10, blank=True)  # "" = detect automatically
    sip_identity = models.CharField(max_length=64)
    error = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_open(self) -> bool:
        return self.status in (self.Status.RINGING, self.Status.ANSWERED)
