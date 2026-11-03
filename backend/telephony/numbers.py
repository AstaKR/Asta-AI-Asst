"""Phone number normalisation. Only E.164 numbers are stored or dialled."""

import re

from django.conf import settings

_E164 = re.compile(r"^\+[1-9]\d{7,14}$")


class InvalidNumber(ValueError):
    pass


def normalize(raw: str, default_country_code: str = "+91") -> str:
    """'098765 43210', '9876543210', '+91 98765-43210' -> '+919876543210'."""
    digits = re.sub(r"[\s\-().]", "", raw or "")
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if not digits.startswith("+"):
        digits = digits.lstrip("0")
        if len(digits) == 10:  # national number
            digits = default_country_code + digits
        else:
            digits = "+" + digits
    if not _E164.match(digits):
        raise InvalidNumber("Enter a valid phone number, for example 98765 43210.")
    return digits


def dial_allowed(number: str) -> bool:
    """Outgoing calls only to allowed prefixes (default India): blocks premium/international toll fraud."""
    return any(number.startswith(p) for p in settings.PHONE_DIAL_ALLOWED_PREFIXES)


def extract_number(value: str) -> str | None:
    """Best effort: pull an E.164 number out of a header-ish value like '<sip:+9198...@host>;reason=x'."""
    m = re.search(r"\+?\d{10,15}", value or "")
    if not m:
        return None
    try:
        return normalize(m.group(0))
    except InvalidNumber:
        return None


def mask(number: str) -> str:
    return number[:-6] + "••••" + number[-2:] if len(number) > 8 else number
