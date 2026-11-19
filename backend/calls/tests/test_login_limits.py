"""Sign-in protection counts failures only (per name and per address); sessions slide while people keep using the app."""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import LoginAttempt

User = get_user_model()
PASSWORD = "correct-horse-42"


@pytest.fixture(autouse=True)
def _clean(settings):
    cache.clear()
    settings.LOGIN_FAIL_LIMIT_USER = 3
    settings.LOGIN_FAIL_LIMIT_IP = 6
    settings.LOGIN_FAIL_WINDOW_SECONDS = 900
    settings.TRUSTED_PROXIES = 0
    for name in ("asha", "bala", "chitra"):
        User.objects.create_user(username=name, password=PASSWORD)


def attempt(name, password, client=None, **extra):
    return (client or APIClient()).post("/api/auth/login/", {"username": name, "password": password}, format="json", **extra)


@pytest.mark.django_db
def test_account_is_locked_after_repeated_failures_even_with_the_right_password():
    for _ in range(3):
        assert attempt("asha", "wrong").status_code == 400
    res = attempt("asha", PASSWORD)
    assert res.status_code == 429
    assert "minute" in res.json()["detail"] and int(res["Retry-After"]) > 0


@pytest.mark.django_db
def test_one_persons_failures_do_not_lock_out_a_colleague_on_the_same_address():
    for _ in range(3):
        attempt("asha", "wrong")
    assert attempt("bala", PASSWORD).status_code == 200


@pytest.mark.django_db
def test_successful_sign_ins_never_use_up_the_allowance():
    for _ in range(30):  # far above any failure limit
        assert attempt("asha", PASSWORD).status_code == 200


@pytest.mark.django_db
def test_correct_password_clears_the_persons_counter():
    attempt("asha", "wrong")
    attempt("asha", "wrong")
    assert attempt("asha", PASSWORD).status_code == 200
    attempt("asha", "wrong")
    attempt("asha", "wrong")
    assert attempt("asha", PASSWORD).status_code == 200  # 2 failures again, still under the limit of 3


@pytest.mark.django_db
def test_one_address_trying_many_names_is_blocked():
    for name in ("u1", "u2", "u3", "u4", "u5", "u6"):
        assert attempt(name, "wrong").status_code == 400
    assert attempt("chitra", PASSWORD).status_code == 429


@pytest.mark.django_db
def test_lock_lifts_after_the_quiet_window():
    for _ in range(3):
        attempt("asha", "wrong")
    assert attempt("asha", PASSWORD).status_code == 429
    LoginAttempt.objects.update(window_started=timezone.now() - timedelta(hours=1))
    assert attempt("asha", PASSWORD).status_code == 200


@pytest.mark.django_db
def test_behind_our_proxy_each_real_address_has_its_own_budget(settings):
    settings.TRUSTED_PROXIES = 1
    for name in ("u1", "u2", "u3", "u4", "u5", "u6"):
        attempt(name, "wrong", HTTP_X_FORWARDED_FOR="1.1.1.1")
    assert attempt("chitra", PASSWORD, HTTP_X_FORWARDED_FOR="1.1.1.1").status_code == 429
    assert attempt("chitra", PASSWORD, HTTP_X_FORWARDED_FOR="2.2.2.2").status_code == 200


@pytest.mark.django_db
def test_forged_forwarded_header_cannot_dodge_the_address_limit(settings):
    settings.TRUSTED_PROXIES = 1
    for i in range(6):
        # the caller invents earlier entries; only the last one (added by our proxy) is trusted
        attempt(f"u{i}", "wrong", HTTP_X_FORWARDED_FOR=f"9.9.9.{i}, 1.1.1.1")
    assert attempt("chitra", PASSWORD, HTTP_X_FORWARDED_FOR="8.8.8.8, 1.1.1.1").status_code == 429


@pytest.mark.django_db
def test_unlock_command_clears_a_lockout():
    for _ in range(3):
        attempt("asha", "wrong")
    assert attempt("asha", PASSWORD).status_code == 429
    call_command("unlock_login", username="asha")
    assert attempt("asha", PASSWORD).status_code == 200


@pytest.mark.django_db
def test_sessions_last_thirty_days_by_default(settings):
    assert settings.SESSION_COOKIE_AGE == 30 * 24 * 3600


@pytest.mark.django_db
def test_session_is_renewed_at_most_once_a_day():
    client = APIClient()
    assert attempt("asha", PASSWORD, client).status_code == 200
    session = client.session
    session["_renewed"] = 0  # last renewed long ago
    session.save()
    first = client.get("/api/auth/me/")
    assert first.status_code == 200 and "sessionid" in first.cookies  # cookie re-issued with a fresh expiry
    second = client.get("/api/auth/me/")
    assert second.status_code == 200 and "sessionid" not in second.cookies  # not rewritten on every request
