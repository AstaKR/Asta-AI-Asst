"""Local AI engine routing: the backend talks to a mocked local service (no models needed)."""

import io
import json
import wave

import httpx
import numpy as np
import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from integrations import local_ai
from integrations.engines import Engines
from meetings.errors import ProviderNotConfigured, ProviderUnavailable
from quick.models import QuickUsage

User = get_user_model()
PASSWORD = "c0rrect-Horse-battery"


def wav(seconds: float, rate: int = 16000) -> bytes:
    t = np.arange(int(seconds * rate)) / rate
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.sin(2 * np.pi * 300 * t) * 8000).astype("<i2").tobytes())
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.LOCAL_AI_URL = "http://local-ai"
    settings.LOCAL_AI_SECRET = "s3cret"
    settings.SARVAM_API_KEY = ""
    settings.TRANSLATE_ENGINE = settings.STT_ENGINE = settings.TTS_ENGINE = "local"
    settings.DAILY_LIMITS = {"call_seconds": 1, "stt_seconds": 1, "tts_chars": 1, "translate_chars": 1}  # local is not budgeted
    cache.clear()
    local_ai.clear_health_cache()
    yield
    local_ai.clear_health_cache()


@pytest.fixture
def service(monkeypatch):
    """Fake local AI service; returns the requests it saw."""
    seen = Seen()
    state = {"down": False}

    def handler(request: httpx.Request):
        seen.append(request)
        assert request.headers["X-Local-AI-Secret"] == "s3cret"
        if state["down"]:
            raise httpx.ConnectError("refused")
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "ok", "translate": {"installed": True, "languages": ["en", "hi", "ta"]}, "stt": {"installed": True}, "tts": {"installed": False}, "loaded": []})
        if request.url.path == "/v1/translate":
            body = json.loads(request.content)
            return httpx.Response(200, json={"translation": f"[{body['target']}] {body['text']}"})
        if request.url.path == "/v1/transcribe":
            offset = len(seen)
            return httpx.Response(200, json={"segments": [{"start_ms": 100, "end_ms": 900, "text": f"part{offset}"}], "language": "ta"})
        if request.url.path == "/v1/tts":
            return httpx.Response(503, json={"detail": "indic-parler-tts is not available.", "code": "model_unavailable"})
        return httpx.Response(404)

    real = httpx.Client

    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr("integrations.local_ai.httpx.Client", client)
    seen.state = state
    return seen


class Seen(list):
    state: dict


@pytest.fixture
def api(db):
    User.objects.create_user(username="asha", password=PASSWORD)
    c = APIClient()
    assert c.login(username="asha", password=PASSWORD)
    return c


def test_quick_text_uses_local_engine_without_budget(api, service):
    resp = api.post("/api/quick/text/", {"text": "Hello", "source_language": "en", "target_language": "ta", "speak": False}, format="json")
    assert resp.status_code == 200, resp.content
    assert resp.json()["translation"] == "[ta] Hello"
    body = json.loads(service[0].content)
    assert body == {"text": "Hello", "source": "en", "target": "ta"}
    usage = QuickUsage.objects.get()
    assert usage.translate_chars == 0 and usage.tts_chars == 0  # free engine: nothing billed


def test_quick_speech_local_stt(api, service):
    upload = SimpleUploadedFile("a.wav", wav(1.0), content_type="audio/wav")
    resp = api.post("/api/quick/speech/", {"file": upload, "source_language": "auto", "target_language": "hi"}, format="multipart")
    assert resp.status_code == 200, resp.content
    data = resp.json()
    assert data["original"].startswith("part") and data["source_language"] == "ta" and data["translation"].startswith("[hi]")
    assert QuickUsage.objects.get().stt_seconds == 0


def test_missing_local_voice_is_a_clear_error(api, service):
    resp = api.post("/api/quick/text/", {"text": "Hello", "source_language": "en", "target_language": "ta", "speak": True}, format="json")
    assert resp.status_code == 502 and "parler" in resp.json()["detail"]


def test_service_down_is_reported(api, service):
    service.state["down"] = True
    resp = api.post("/api/quick/text/", {"text": "Hello", "source_language": "en", "target_language": "ta", "speak": False}, format="json")
    assert resp.status_code == 502 and "not running" in resp.json()["detail"]


def test_capabilities(api, service):
    data = api.get("/api/ai/capabilities/").json()
    assert data["translate"] == {"engine": "local", "ready": True, "languages": ["en", "hi", "ta"]}
    assert data["tts"]["ready"] is False and data["local_service"]["running"] is True
    assert APIClient().get("/api/ai/capabilities/").status_code in (401, 403)


def test_mixed_engines_and_script_guess(settings, service):
    e = Engines(translate="local", stt="sarvam", tts="sarvam")
    assert e.billed("stt") and not e.billed("translate")
    assert e.translate("வணக்கம்", "auto", "en-IN") == "[en] வணக்கம்"
    assert json.loads(service[-1].content)["source"] == "ta"
    assert local_ai.guess_language("नमस्ते") == "hi" and local_ai.guess_language("hello") == "en"


def test_not_configured(settings):
    settings.LOCAL_AI_URL = ""
    with pytest.raises(ProviderNotConfigured):
        local_ai.LocalAIClient()
    assert local_ai.health() is None


def test_meeting_transcription_in_chunks_keeps_absolute_times(settings, service):
    from meetings.transcription.local_service import LocalServiceTranscriber

    settings.LOCAL_AI_CHUNK_SECONDS = 2
    rate = 16000
    pcm = b"\x01\x00" * rate * 5  # 5 s -> pieces at 0 s, 2 s, 4 s
    progress = []
    segments = LocalServiceTranscriber().transcribe(pcm, rate, "ta", progress.append)
    assert [s.start_ms for s in segments] == [100, 2100, 4100]
    assert all(s.language == "ta" for s in segments) and progress[-1] == 1.0


def test_unreachable_service_raises_unavailable(settings, service):
    service.state["down"] = True
    with pytest.raises(ProviderUnavailable):
        local_ai.LocalAIClient().translate("hi", "en", "ta")
