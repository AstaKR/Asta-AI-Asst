import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from integrations.engines import Engines
from meetings.errors import ProviderNotConfigured


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.TRANSLATE_ENGINE = settings.STT_ENGINE = settings.TTS_ENGINE = "sarvam"
    settings.SARVAM_API_KEY = "env-sarvam-key-0000000000009999"


def test_capabilities_need_a_login_and_report_sarvam(db):
    assert APIClient().get("/api/ai/capabilities/").status_code in (401, 403)
    get_user_model().objects.create_user(username="asha", password="pw-123456-xyz")
    c = APIClient()
    assert c.login(username="asha", password="pw-123456-xyz")
    data = c.get("/api/ai/capabilities/").json()
    assert data["translate"] == {"engine": "sarvam", "ready": True}
    assert set(data) == {"translate", "stt", "tts"}


def test_capabilities_not_ready_without_a_key(db, settings):
    settings.SARVAM_API_KEY = ""
    get_user_model().objects.create_user(username="asha", password="pw-123456-xyz")
    c = APIClient()
    assert c.login(username="asha", password="pw-123456-xyz")
    assert c.get("/api/ai/capabilities/").json()["stt"]["ready"] is False


def test_sarvam_calls_are_billed_and_unknown_engines_refused(settings):
    assert Engines().billed("translate") and Engines().billed("tts")
    settings.TRANSLATE_ENGINE = "local"
    with pytest.raises(ProviderNotConfigured):
        Engines()
