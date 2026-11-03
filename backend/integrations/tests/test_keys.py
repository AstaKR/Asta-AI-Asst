import json

import pytest
from cryptography.fernet import Fernet
from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient

from integrations import secrets, views
from integrations.models import ProviderSecret, SecretAuditLog

User = get_user_model()
ANTHROPIC = "sk-ant-api03-" + "A" * 40 + "WXYZ"
SARVAM = "sk_" + "b" * 30 + "1234"
WORKER = "worker-secret-for-tests"


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.SECRETS_ENCRYPTION_KEY = Fernet.generate_key().decode()
    settings.ANTHROPIC_API_KEY = ""
    settings.SARVAM_API_KEY = "env-sarvam-key-0000000000009999"
    settings.WORKER_SHARED_SECRET = WORKER
    cache.clear()


def client(staff: bool):
    name = "admin" if staff else "user"
    User.objects.create_user(username=name, password="pw-123456-xyz", is_staff=staff)
    c = APIClient()
    assert c.login(username=name, password="pw-123456-xyz")
    return c


@pytest.fixture
def admin(db):
    return client(True)


def test_non_admins_get_nothing(db):
    c = client(False)
    assert c.get("/api/admin/keys/").status_code == 403
    assert c.put("/api/admin/keys/anthropic_api_key/", {"value": ANTHROPIC}, format="json").status_code == 403
    assert APIClient().get("/api/admin/keys/").status_code in (401, 403)
    assert not ProviderSecret.objects.exists()


def test_set_key_is_encrypted_and_never_returned(admin):
    res = admin.put("/api/admin/keys/anthropic_api_key/", {"value": ANTHROPIC}, format="json")
    assert res.status_code == 200, res.content
    assert ANTHROPIC not in res.content.decode()
    key = next(k for k in res.json()["keys"] if k["name"] == "anthropic_api_key")
    assert key["source"] == "admin" and key["last4"] == "WXYZ" and key["updated_by"] == "admin"
    row = ProviderSecret.objects.get()
    assert ANTHROPIC not in row.ciphertext and secrets.decrypt(row.ciphertext) == ANTHROPIC
    assert secrets.get("anthropic_api_key") == ANTHROPIC  # used by the assistant / notes immediately
    assert ANTHROPIC not in admin.get("/api/admin/keys/").content.decode()
    audit = SecretAuditLog.objects.get()
    assert audit.action == "set" and audit.user.username == "admin" and ANTHROPIC not in audit.detail


def test_env_fallback_and_clear(admin):
    status = {k["name"]: k for k in admin.get("/api/admin/keys/").json()["keys"]}
    assert status["sarvam_api_key"]["source"] == "env" and status["sarvam_api_key"]["last4"] == "9999"
    assert status["anthropic_api_key"]["source"] == "none"
    admin.put("/api/admin/keys/sarvam_api_key/", {"value": SARVAM}, format="json")
    assert secrets.get("sarvam_api_key") == SARVAM  # admin value overrides .env
    res = admin.delete("/api/admin/keys/sarvam_api_key/")
    assert {k["name"]: k for k in res.json()["keys"]}["sarvam_api_key"]["source"] == "env"
    assert secrets.get("sarvam_api_key") == "env-sarvam-key-0000000000009999"
    assert [a.action for a in SecretAuditLog.objects.order_by("at")] == ["set", "clear"]


@pytest.mark.parametrize("value", ["short", "sk-ant-has space " + "x" * 20, "not-anthropic-" + "x" * 30], ids=["short", "space", "prefix"])
def test_validation(admin, value):
    assert admin.put("/api/admin/keys/anthropic_api_key/", {"value": value}, format="json").status_code == 400
    assert not ProviderSecret.objects.exists()


def test_unknown_key_name(admin):
    assert admin.put("/api/admin/keys/aws_secret/", {"value": SARVAM}, format="json").status_code == 404


def test_production_requires_encryption_key(admin, settings):
    settings.SECRETS_ENCRYPTION_KEY = ""
    settings.DEBUG = False
    res = admin.put("/api/admin/keys/sarvam_api_key/", {"value": SARVAM}, format="json")
    assert res.status_code == 503 and res.json()["code"] == "encryption_not_configured"


def test_rotated_encryption_key_falls_back_to_env(admin, settings):
    admin.put("/api/admin/keys/sarvam_api_key/", {"value": SARVAM}, format="json")
    settings.SECRETS_ENCRYPTION_KEY = Fernet.generate_key().decode()
    secrets.clear_cache()
    assert secrets.get("sarvam_api_key") == "env-sarvam-key-0000000000009999"


def test_key_test_endpoint(admin, monkeypatch):
    monkeypatch.setattr(views, "test_key", lambda name, value: (value == SARVAM, "Sarvam accepted the key."))
    admin.put("/api/admin/keys/sarvam_api_key/", {"value": SARVAM}, format="json")
    res = admin.post("/api/admin/keys/sarvam_api_key/test/")
    assert res.json() == {"ok": True, "detail": "Sarvam accepted the key."}
    assert SecretAuditLog.objects.filter(action="test", ok=True).exists()


def test_worker_fetches_current_sarvam_key(admin):
    admin.put("/api/admin/keys/sarvam_api_key/", {"value": SARVAM}, format="json")
    assert APIClient().get("/api/internal/provider-keys/").status_code == 403
    res = APIClient().get("/api/internal/provider-keys/", HTTP_X_WORKER_SECRET=WORKER)
    assert res.status_code == 200 and json.loads(res.content) == {"sarvam_api_key": SARVAM}
    # The worker endpoint never exposes the Anthropic key.
    assert "anthropic" not in res.content.decode()
