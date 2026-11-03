from django.conf import settings
from django.db import models


class Plan(models.Model):
    """A subscription tier with per-user limits. Payments are not connected yet: admins assign plans."""

    code = models.SlugField(max_length=30, unique=True)
    name = models.CharField(max_length=60)
    description = models.CharField(max_length=200, blank=True)
    price_inr_month = models.PositiveIntegerField(default=0)
    daily_call_minutes = models.PositiveIntegerField(help_text="App calls (voice/video/phone) per day")
    daily_assistant_requests = models.PositiveIntegerField()
    monthly_meeting_minutes = models.PositiveIntegerField()
    video_calls = models.BooleanField(default=True)
    phone_calls = models.BooleanField(default=False, help_text="Dial normal numbers / receive forwarded calls")
    daily_phone_calls = models.PositiveIntegerField(default=0)
    is_default = models.BooleanField(default=False, help_text="Plan for users without a subscription")
    active = models.BooleanField(default=True)
    sort = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort", "price_inr_month"]

    def __str__(self) -> str:
        return self.name


class Subscription(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscription")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=200, blank=True)
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
