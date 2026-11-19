"""Sign-in protection: lock out guessing, not normal use.

* Counts FAILED attempts only (a successful sign-in never uses up anyone's allowance).
* One counter per account name (stops password guessing against a person) and one per network address
  (stops one machine trying many names). The address limit is much higher so an office behind one address is fine.
* Counters live in the database and reset after a quiet window.
"""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import LoginAttempt


def client_ip(request) -> str:
    """The caller's address. Behind our own reverse proxy (TRUSTED_PROXIES=1) the real one is in X-Forwarded-For."""
    n = settings.TRUSTED_PROXIES
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if n > 0 and forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if len(parts) >= n:
            return parts[-n]  # the entry our proxy appended; anything before it can be forged by the caller
    return request.META.get("REMOTE_ADDR", "") or "unknown"


def _keys(request, username: str) -> list[tuple[str, int]]:
    name = (username or "").strip().lower()[:80]
    return [(f"ip:{client_ip(request)}", settings.LOGIN_FAIL_LIMIT_IP), (f"user:{name}", settings.LOGIN_FAIL_LIMIT_USER)]


def _window() -> timedelta:
    return timedelta(seconds=settings.LOGIN_FAIL_WINDOW_SECONDS)


def seconds_blocked(request, username: str) -> int:
    """0 when this attempt may go ahead, otherwise how many seconds until the lock lifts."""
    now = timezone.now()
    wait = 0
    for key, limit in _keys(request, username):
        row = LoginAttempt.objects.filter(key=key).first()
        if row and now - row.window_started < _window() and row.failures >= limit:
            wait = max(wait, int((row.window_started + _window() - now).total_seconds()) + 1)
    return wait


def record_failure(request, username: str) -> None:
    now = timezone.now()
    for key, _limit in _keys(request, username):
        with transaction.atomic():
            row, _ = LoginAttempt.objects.select_for_update().get_or_create(key=key, defaults={"failures": 0, "window_started": now})
            if now - row.window_started >= _window():
                row.failures, row.window_started = 0, now  # a quiet spell: start counting afresh
            row.failures += 1
            row.save(update_fields=["failures", "window_started"])
    LoginAttempt.objects.filter(window_started__lt=now - timedelta(days=1)).delete()  # tidy old rows


def record_success(request, username: str) -> None:
    """A correct password clears that person's own counter (the address counter is left alone)."""
    user_key = _keys(request, username)[1][0]
    LoginAttempt.objects.filter(key=user_key).delete()
