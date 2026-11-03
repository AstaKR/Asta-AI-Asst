"""Mobile-number login: phone normalisation, OTP challenges and SMS delivery."""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils import timezone

log = logging.getLogger(__name__)

_DIGITS = re.compile(r"\D+")
# Indian mobile numbers: 10 digits starting 6-9.
_INDIAN_MOBILE = re.compile(r"^[6-9]\d{9}$")


class InvalidPhone(ValueError):
    pass


def normalize_phone(raw: str) -> str:
    """Returns E.164 (+91XXXXXXXXXX). Accepts '98765 43210', '098765...', '+91-98765...', '9198765...'."""
    digits = _DIGITS.sub("", raw or "")
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if not _INDIAN_MOBILE.match(digits):
        raise InvalidPhone("Enter a valid 10-digit Indian mobile number.")
    return f"+91{digits}"


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}******{phone[-4:]}" if len(phone) >= 8 else "***"


def hash_code(phone: str, code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def generate_code() -> str:
    return f"{secrets.randbelow(10**settings.OTP_LENGTH):0{settings.OTP_LENGTH}d}"


# ---------- SMS delivery ----------

# Test/dev outbox for the "memory" backend (never used in production).
OUTBOX: list[tuple[str, str]] = []


def send_sms(phone: str, message: str) -> None:
    backend = settings.SMS_BACKEND
    if backend == "memory":
        OUTBOX.append((phone, message))
        return
    if backend == "console":
        if not settings.DEBUG:
            raise ImproperlyConfigured("SMS_BACKEND=console is only allowed with DJANGO_DEBUG=true")
        # Development only: the code is printed to the server log instead of being sent.
        log.warning("DEV SMS to %s: %s", mask_phone(phone), message)
        return
    raise ImproperlyConfigured(
        f"SMS_BACKEND={backend!r} is not implemented yet. Configure an Indian SMS provider (DLT-registered "
        "sender and template) before enabling phone login in production."
    )


def otp_expiry():
    return timezone.now() + timedelta(seconds=settings.OTP_TTL_SECONDS)
