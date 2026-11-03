import re
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import phone as phone_utils
from accounts.models import OTPChallenge, PhoneNumber

PHONE = "+91 98765 43210"
E164 = "+919876543210"


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.SMS_BACKEND = "memory"
    settings.OTP_RESEND_SECONDS = 0
    settings.OTP_MAX_PER_PHONE_PER_HOUR = 5
    settings.OTP_MAX_ATTEMPTS = 3
    phone_utils.OUTBOX.clear()
    cache.clear()


def request_code(client, phone=PHONE):
    return client.post("/api/auth/otp/request/", {"phone": phone}, format="json")


def last_code() -> str:
    return re.match(r"(\d+)", phone_utils.OUTBOX[-1][1]).group(1)


@pytest.mark.parametrize(
    "raw,expected",
    [("9876543210", E164), ("+91 98765-43210", E164), ("09876543210", E164), ("919876543210", E164)],
)
def test_normalize_phone(raw, expected):
    assert phone_utils.normalize_phone(raw) == expected


@pytest.mark.parametrize("raw", ["12345", "5876543210", "+1 415 555 0100", "", "98765432101"])
def test_normalize_rejects_invalid(raw):
    with pytest.raises(phone_utils.InvalidPhone):
        phone_utils.normalize_phone(raw)


@pytest.mark.django_db
def test_otp_login_creates_account_and_token():
    client = APIClient()
    res = request_code(client)
    assert res.status_code == 200 and res.json()["sent_to"] == "+91******3210"
    assert phone_utils.OUTBOX[-1][0] == E164
    # Only a hash of the code is stored.
    assert last_code() not in OTPChallenge.objects.get().code_hash
    res = client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": last_code(), "display_name": "Anand"}, format="json")
    assert res.status_code == 200, res.content
    body = res.json()
    assert body["is_new"] is True and body["user"]["phone_number"] == E164
    assert body["user"]["preferences"]["display_name"] == "Anand"
    # The token authenticates API calls without cookies or CSRF.
    mobile = APIClient()
    mobile.credentials(HTTP_AUTHORIZATION=f"Token {body['token']}")
    assert mobile.get("/api/auth/me/").json()["phone_number"] == E164
    room = mobile.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json")
    assert room.status_code == 201


@pytest.mark.django_db
def test_second_login_reuses_account():
    client = APIClient()
    request_code(client)
    first = client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": last_code()}, format="json").json()
    request_code(client, "09876543210")
    second = client.post("/api/auth/otp/verify/", {"phone": "9876543210", "code": last_code()}, format="json").json()
    assert second["is_new"] is False and second["user"]["id"] == first["user"]["id"]
    assert PhoneNumber.objects.count() == 1


@pytest.mark.django_db
def test_wrong_code_and_lockout():
    client = APIClient()
    request_code(client)
    good = last_code()
    bad = "000000" if good != "000000" else "111111"
    for _ in range(3):
        assert client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": bad}, format="json").json()["code"] == "otp_invalid"
    res = client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": good}, format="json")
    assert res.json()["code"] == "otp_locked"
    # Even the right code no longer works after lockout.
    assert client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": good}, format="json").status_code == 400


@pytest.mark.django_db
def test_code_is_single_use_and_expires():
    client = APIClient()
    request_code(client)
    code = last_code()
    assert client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": code}, format="json").status_code == 200
    assert client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": code}, format="json").status_code == 400
    request_code(client)
    OTPChallenge.objects.filter(consumed=False).update(expires_at=timezone.now() - timedelta(seconds=1))
    assert client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": last_code()}, format="json").status_code == 400


@pytest.mark.django_db
def test_new_code_invalidates_old_one():
    client = APIClient()
    request_code(client)
    old = last_code()
    request_code(client)
    new = last_code()
    if old != new:
        assert client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": old}, format="json").status_code == 400
    assert client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": new}, format="json").status_code == 200


@pytest.mark.django_db
def test_resend_cooldown_and_hourly_limit(settings):
    settings.OTP_RESEND_SECONDS = 30
    client = APIClient()
    assert request_code(client).status_code == 200
    res = request_code(client)
    assert res.status_code == 429 and res.json()["code"] == "otp_wait"
    settings.OTP_RESEND_SECONDS = 0
    for _ in range(4):
        assert request_code(client).status_code == 200
    assert request_code(client).json()["code"] == "otp_limit"


@pytest.mark.django_db
def test_invalid_phone_rejected():
    assert request_code(APIClient(), "12345").status_code == 400


@pytest.mark.django_db
def test_logout_revokes_token():
    client = APIClient()
    request_code(client)
    token = client.post("/api/auth/otp/verify/", {"phone": PHONE, "code": last_code()}, format="json").json()["token"]
    mobile = APIClient()
    mobile.credentials(HTTP_AUTHORIZATION=f"Token {token}")
    assert mobile.post("/api/auth/logout/").status_code == 204
    assert mobile.get("/api/auth/me/").status_code in (401, 403)


def test_console_sms_refused_in_production(settings):
    settings.SMS_BACKEND = "console"
    settings.DEBUG = False
    with pytest.raises(ImproperlyConfigured):
        phone_utils.send_sms(E164, "x")


def test_unconfigured_sms_backend_fails_loudly(settings):
    settings.SMS_BACKEND = "disabled"
    with pytest.raises(ImproperlyConfigured):
        phone_utils.send_sms(E164, "x")
