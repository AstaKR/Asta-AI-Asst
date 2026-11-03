"""Provider API keys: encrypted in the database (set by admins in the web app), falling back to .env.

Encryption: Fernet (AES-128-CBC + HMAC-SHA256) with SECRETS_ENCRYPTION_KEY. In development without that
variable the key is derived from DJANGO_SECRET_KEY; production refuses to store keys until it is set,
so a database copy alone never reveals provider keys.
"""

from __future__ import annotations

import base64
import hashlib
import time
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

# name -> (label, settings attribute used as the .env fallback, expected prefix or "")
PROVIDER_KEYS: dict[str, tuple[str, str, str]] = {
    "anthropic_api_key": ("Anthropic (Claude) — assistant, photo translate, meeting notes", "ANTHROPIC_API_KEY", "sk-ant-"),
    "sarvam_api_key": ("Sarvam AI — speech recognition, translation, voice", "SARVAM_API_KEY", ""),
}
_CACHE_SECONDS = 30
_cache: dict[str, tuple[float, str]] = {}


class SecretsNotConfigured(ImproperlyConfigured):
    pass


def _fernet() -> Fernet:
    key = settings.SECRETS_ENCRYPTION_KEY
    if not key:
        if not settings.DEBUG:
            raise SecretsNotConfigured("Set SECRETS_ENCRYPTION_KEY on the server before saving API keys.")
        key = base64.urlsafe_b64encode(hashlib.sha256(("secrets:" + settings.SECRET_KEY).encode()).digest()).decode()
    try:
        return Fernet(key)
    except ValueError as exc:
        raise SecretsNotConfigured("SECRETS_ENCRYPTION_KEY is not a valid Fernet key.") from exc


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def clear_cache() -> None:
    _cache.clear()


def get(name: str) -> str:
    """The key to use right now: admin-set value if present, else the .env setting, else ""."""
    cached = _cache.get(name)
    if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        return cached[1]
    from .models import ProviderSecret

    value = ""
    row = ProviderSecret.objects.filter(name=name).first()
    if row:
        try:
            value = decrypt(row.ciphertext)
        except (InvalidToken, SecretsNotConfigured):
            value = ""  # encryption key changed: fall back to .env rather than crash
    if not value:
        value = (getattr(settings, PROVIDER_KEYS[name][1], "") or "").strip()
    _cache[name] = (time.monotonic(), value)
    return value


@dataclass
class KeyStatus:
    name: str
    label: str
    source: str  # "admin" | "env" | "none"
    last4: str
    updated_at: str | None
    updated_by: str | None


def status(name: str) -> KeyStatus:
    from .models import ProviderSecret

    label, attr, _ = PROVIDER_KEYS[name]
    row = ProviderSecret.objects.select_related("updated_by").filter(name=name).first()
    if row:
        return KeyStatus(name, label, "admin", row.last4, row.updated_at.isoformat(), row.updated_by.username if row.updated_by else None)
    env_value = (getattr(settings, attr, "") or "").strip()
    return KeyStatus(name, label, "env" if env_value else "none", env_value[-4:] if env_value else "", None, None)


def validate(name: str, value: str) -> str | None:
    value = value.strip()
    prefix = PROVIDER_KEYS[name][2]
    if len(value) < 20 or len(value) > 300 or any(c.isspace() for c in value):
        return "That does not look like an API key."
    if prefix and not value.startswith(prefix):
        return f"Anthropic keys start with {prefix}"
    return None
