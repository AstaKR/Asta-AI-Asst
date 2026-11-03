from django.conf import settings
from django.db import models


class LanguagePreference(models.Model):
    """A user's default languages for new calls. Copied onto CallParticipant when they join a call."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="language_preference")
    display_name = models.CharField(max_length=60, blank=True)
    spoken_language = models.CharField(max_length=10, default="ta-IN")
    listen_language = models.CharField(max_length=10, default="ta-IN")
    voice = models.CharField(max_length=40, blank=True)
    show_subtitles = models.BooleanField(default=True)
    # 0-100: how loudly the other person's ORIGINAL voice plays under the translation.
    original_voice_volume = models.PositiveSmallIntegerField(default=15)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user} speaks {self.spoken_language}, hears {self.listen_language}"


class PhoneNumber(models.Model):
    """A verified mobile number (E.164) that identifies a user for mobile login and call routing."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="phone")
    number = models.CharField(max_length=16, unique=True)
    verified_at = models.DateTimeField()

    def __str__(self) -> str:
        return self.number


class OTPChallenge(models.Model):
    """One login code sent by SMS. Only an HMAC of the code is stored."""

    phone = models.CharField(max_length=16, db_index=True)
    code_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]


def get_preference(user) -> LanguagePreference:
    pref, _ = LanguagePreference.objects.get_or_create(user=user, defaults={"display_name": user.username})
    return pref
