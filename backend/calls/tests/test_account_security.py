"""Username/password accounts: mobile-number linking and password change/reset."""

import re

import pytest
from django.core.cache import cache
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from accounts import phone as phone_utils
from accounts.models import PhoneNumber

PHONE = "98765 43210"
E164 = "+919876543210"
PASSWORD = "correct-horse-42"
NEW_PASSWORD = "another-horse-77"


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.SMS_BACKEND = "memory"
    settings.OTP_RESEND_SECONDS = 0
    settings.OTP_MAX_PER_PHONE_PER_HOUR = 10
    settings.OTP_MAX_ATTEMPTS = 3
    phone_utils.OUTBOX.clear()
    cache.clear()


def last_code() -> str:
    return re.match(r"(\d+)", phone_utils.OUTBOX[-1][1]).group(1)


def register(username="asha", want_token=True):
    client = APIClient()
    res = client.post(
        "/api/auth/register/",
        {"username": username, "password": PASSWORD, "display_name": "Asha", "want_token": want_token},
        format="json",
    )
    assert res.status_code == 201, res.content
    return client, res.json()


@pytest.mark.django_db
def test_register_returns_token_only_when_asked():
    _, with_token = register("asha", want_token=True)
    assert with_token["token"] and with_token["phone_number"] is None
    _, without = register("bala", want_token=False)
    assert "token" not in without


@pytest.mark.django_db
def test_login_with_token_works_without_cookies():
    register("asha")
    res = APIClient().post("/api/auth/login/", {"username": "asha", "password": PASSWORD, "want_token": True}, format="json")
    assert res.status_code == 200
    mobile = APIClient()
    mobile.credentials(HTTP_AUTHORIZATION=f"Token {res.json()['token']}")
    assert mobile.get("/api/auth/me/").json()["username"] == "asha"


@pytest.mark.django_db
def test_link_phone_number():
    client, _ = register()
    assert client.post("/api/auth/phone/request/", {"phone": PHONE}, format="json").status_code == 200
    assert phone_utils.OUTBOX[-1][0] == E164
    res = client.post("/api/auth/phone/verify/", {"phone": PHONE, "code": last_code()}, format="json")
    assert res.status_code == 200, res.content
    assert res.json()["phone_number"] == E164
    assert client.get("/api/auth/me/").json()["phone_number"] == E164


@pytest.mark.django_db
def test_link_phone_requires_sign_in():
    assert APIClient().post("/api/auth/phone/request/", {"phone": PHONE}, format="json").status_code in (401, 403)


@pytest.mark.django_db
def test_wrong_code_does_not_link():
    client, _ = register()
    client.post("/api/auth/phone/request/", {"phone": PHONE}, format="json")
    res = client.post("/api/auth/phone/verify/", {"phone": PHONE, "code": "000000"}, format="json")
    assert res.status_code == 400 and res.json()["code"] == "otp_invalid"
    assert not PhoneNumber.objects.exists()


@pytest.mark.django_db
def test_number_linked_to_another_account_is_refused():
    first, _ = register("asha")
    first.post("/api/auth/phone/request/", {"phone": PHONE}, format="json")
    first.post("/api/auth/phone/verify/", {"phone": PHONE, "code": last_code()}, format="json")
    second, _ = register("bala")
    res = second.post("/api/auth/phone/request/", {"phone": PHONE}, format="json")
    assert res.status_code == 409 and res.json()["code"] == "phone_taken"


@pytest.mark.django_db
def test_change_and_remove_number():
    client, _ = register()
    client.post("/api/auth/phone/request/", {"phone": PHONE}, format="json")
    client.post("/api/auth/phone/verify/", {"phone": PHONE, "code": last_code()}, format="json")
    client.post("/api/auth/phone/request/", {"phone": "91234 56780"}, format="json")
    res = client.post("/api/auth/phone/verify/", {"phone": "91234 56780", "code": last_code()}, format="json")
    assert res.json()["phone_number"] == "+919123456780"
    assert PhoneNumber.objects.count() == 1
    assert client.delete("/api/auth/phone/verify/").json()["phone_number"] is None
    assert not PhoneNumber.objects.exists()


@pytest.mark.django_db
def test_change_password_keeps_this_device_signed_in():
    client, body = register()
    this_token = body["token"]
    mobile = APIClient()
    mobile.credentials(HTTP_AUTHORIZATION=f"Token {this_token}")
    wrong = mobile.post("/api/auth/password/change/", {"old_password": "nope-nope-1", "new_password": NEW_PASSWORD}, format="json")
    assert wrong.status_code == 400 and "old_password" in wrong.json()
    weak = mobile.post("/api/auth/password/change/", {"old_password": PASSWORD, "new_password": "123"}, format="json")
    assert weak.status_code == 400 and "new_password" in weak.json()
    ok = mobile.post("/api/auth/password/change/", {"old_password": PASSWORD, "new_password": NEW_PASSWORD}, format="json")
    assert ok.status_code == 204
    assert mobile.get("/api/auth/me/").status_code == 200  # this device stays signed in
    assert APIClient().post("/api/auth/login/", {"username": "asha", "password": NEW_PASSWORD}, format="json").status_code == 200
    assert APIClient().post("/api/auth/login/", {"username": "asha", "password": PASSWORD}, format="json").status_code == 400


def link_phone(client):
    client.post("/api/auth/phone/request/", {"phone": PHONE}, format="json")
    client.post("/api/auth/phone/verify/", {"phone": PHONE, "code": last_code()}, format="json")
    phone_utils.OUTBOX.clear()


@pytest.mark.django_db
def test_password_reset_by_sms_code():
    client, body = register()
    link_phone(client)
    anon = APIClient()
    assert anon.post("/api/auth/password/reset/request/", {"phone": PHONE}, format="json").status_code == 200
    assert "reset code" in phone_utils.OUTBOX[-1][1]
    res = anon.post(
        "/api/auth/password/reset/confirm/", {"phone": PHONE, "code": last_code(), "new_password": NEW_PASSWORD}, format="json"
    )
    assert res.status_code == 204, res.content
    assert not Token.objects.filter(key=body["token"]).exists()  # every device signed out
    assert anon.post("/api/auth/login/", {"username": "asha", "password": NEW_PASSWORD}, format="json").status_code == 200


@pytest.mark.django_db
def test_password_reset_for_unknown_number_sends_nothing_and_reveals_nothing():
    anon = APIClient()
    res = anon.post("/api/auth/password/reset/request/", {"phone": PHONE}, format="json")
    assert res.status_code == 200 and res.json()["sent_to"].endswith("3210")
    assert phone_utils.OUTBOX == []
    # Even a guessed code cannot create or change anything.
    from accounts.models import OTPChallenge

    code = "123456"
    OTPChallenge.objects.update(code_hash=phone_utils.hash_code(E164, code))
    res = anon.post(
        "/api/auth/password/reset/confirm/", {"phone": PHONE, "code": code, "new_password": NEW_PASSWORD}, format="json"
    )
    assert res.status_code == 400 and res.json()["code"] == "otp_invalid"


@pytest.mark.django_db
def test_password_reset_rejects_wrong_code_and_weak_password():
    client, _ = register()
    link_phone(client)
    anon = APIClient()
    anon.post("/api/auth/password/reset/request/", {"phone": PHONE}, format="json")
    bad = anon.post("/api/auth/password/reset/confirm/", {"phone": PHONE, "code": "000000", "new_password": NEW_PASSWORD}, format="json")
    assert bad.status_code == 400 and bad.json()["code"] == "otp_invalid"
    weak = anon.post("/api/auth/password/reset/confirm/", {"phone": PHONE, "code": last_code(), "new_password": "123"}, format="json")
    assert weak.status_code == 400 and "new_password" in weak.json()
    # A weak password must not burn the code: the right code with a good password still works.
    ok = anon.post("/api/auth/password/reset/confirm/", {"phone": PHONE, "code": last_code(), "new_password": NEW_PASSWORD}, format="json")
    assert ok.status_code == 204
