from django.conf import settings
from django.db import models


class ProviderSecret(models.Model):
    """An AI provider API key set from the admin page. Only Fernet ciphertext is stored."""

    name = models.CharField(max_length=40, unique=True)
    ciphertext = models.TextField()
    last4 = models.CharField(max_length=4)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)


class SecretAuditLog(models.Model):
    class Action(models.TextChoices):
        SET = "set", "Set"
        CLEAR = "clear", "Cleared"
        TEST = "test", "Tested"

    name = models.CharField(max_length=40)
    action = models.CharField(max_length=8, choices=Action.choices)
    ok = models.BooleanField(default=True)
    detail = models.CharField(max_length=200, blank=True)  # never contains the key
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    ip = models.GenericIPAddressField(null=True, blank=True)
    at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-at"]
