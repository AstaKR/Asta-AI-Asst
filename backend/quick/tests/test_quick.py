import base64
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

from calls.usage import daily_totals
from quick.models import QuickUsage

User = get_user_model()
PASSWORD = "c0rrect-Horse-battery"


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.SARVAM_API_KEY = "test-key"
    settings.DAILY_LIMITS = {"call_seconds": 36000, "stt_seconds": 3600, "tts_chars": 100000, "translate_chars": 100000}
    cache.clear()


def wav(seconds: float, rate: int = 16000, freq: float = 300) -> bytes:
    t = np.arange(int(seconds * rate)) / rate
    pcm = (np.sin(2 * np.pi * freq * t) * 8000).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


class Seen(list):
    state: dict


@pytest.fixture
def sarvam(monkeypatch):
    """Fake Sarvam API; returns the list of requests it saw. Set .transcript to control STT output."""
    seen = Seen()
    state = {"transcript": "வணக்கம்", "language": "ta-IN"}

    def handler(request: httpx.Request):
        seen.append(request)
        if request.url.path == "/speech-to-text":
            return httpx.Response(200, json={"transcript": state["transcript"], "language_code": state["language"]})
        body = json.loads(request.content)
        if request.url.path == "/translate":
            return httpx.Response(200, json={"translated_text": f"[{body['target_language_code']}] {body['input']}"})
        if request.url.path == "/text-to-speech":
            return httpx.Response(200, json={"audios": [base64.b64encode(wav(0.2, 24000)).decode()] * 2})
        return httpx.Response(404)

    real = httpx.Client

    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr("meetings.sarvam_client.httpx.Client", client)
    seen.state = state
    return seen


@pytest.fixture
def api(db):
    User.objects.create_user(username="asha", password=PASSWORD)
    c = APIClient()
    assert c.login(username="asha", password=PASSWORD)
    return c


def test_requires_login(db):
    assert APIClient().post("/api/quick/text/", {}, format="json").status_code in (401, 403)


def test_text_translation_with_speech(api, sarvam):
    res = api.post("/api/quick/text/", {"text": "Hello", "source_language": "en", "target_language": "ta", "speak": True, "voice": "priya"}, format="json")
    assert res.status_code == 200, res.content
    body = res.json()
    assert body["translation"] == "[ta-IN] Hello" and body["source_language"] == "en"
    # Two WAV parts are joined into one playable file.
    with wave.open(io.BytesIO(base64.b64decode(body["audio"]))) as w:
        assert w.getframerate() == 24000 and w.getnframes() == 2 * int(0.2 * 24000)
    tts = json.loads(sarvam[-1].content)
    assert tts["speaker"] == "priya" and tts["language_code"] == "ta-IN" and tts["model"] == "bulbul:v3"
    u = QuickUsage.objects.get()
    assert (u.translate_chars, u.tts_chars, u.stt_seconds) == (5, len("[ta-IN] Hello"), 0)
    assert daily_totals()["tts_chars"] == u.tts_chars


def test_text_same_language_skips_translation(api, sarvam):
    res = api.post("/api/quick/text/", {"text": "Hi", "source_language": "en", "target_language": "en"}, format="json")
    assert res.json()["translation"] == "Hi" and res.json()["audio"] is None
    assert sarvam == []


def test_text_validation(api, sarvam, settings):
    assert api.post("/api/quick/text/", {"text": "x", "source_language": "fr", "target_language": "ta"}, format="json").status_code == 400
    long = "a" * (settings.QUICK_MAX_TEXT_CHARS + 1)
    assert api.post("/api/quick/text/", {"text": long, "source_language": "en", "target_language": "ta"}, format="json").status_code == 400
    assert api.post("/api/quick/text/", {"text": "x", "source_language": "en", "target_language": "ta", "voice": "nobody"}, format="json").status_code == 400


def test_speech_auto_detect(api, sarvam):
    f = SimpleUploadedFile("talk.wav", wav(1.5), content_type="audio/wav")
    res = api.post("/api/quick/speech/", {"file": f, "target_language": "hi"}, format="multipart")
    assert res.status_code == 200, res.content
    body = res.json()
    assert body["original"] == "வணக்கம்" and body["source_language"] == "ta" and body["translation"] == "[hi-IN] வணக்கம்"
    assert body["audio"] is None
    stt = sarvam[0]
    assert b'name="language_code"\r\n\r\nunknown' in stt.content
    assert QuickUsage.objects.get().stt_seconds == pytest.approx(1.5, abs=0.05)


def test_speech_fixed_language_is_sent(api, sarvam):
    f = SimpleUploadedFile("talk.wav", wav(1), content_type="audio/wav")
    api.post("/api/quick/speech/", {"file": f, "source_language": "ta", "target_language": "en"}, format="multipart")
    assert b'name="language_code"\r\n\r\nta-IN' in sarvam[0].content


def test_speech_no_speech(api, sarvam):
    sarvam.state["transcript"] = ""
    f = SimpleUploadedFile("talk.wav", wav(1), content_type="audio/wav")
    res = api.post("/api/quick/speech/", {"file": f, "target_language": "en"}, format="multipart")
    assert res.status_code == 422 and res.json()["code"] == "no_speech"
    assert QuickUsage.objects.get().stt_seconds > 0  # still counted: Sarvam charged for it


@pytest.mark.parametrize(
    "data,name,message",
    [(b"not audio" * 50, "x.wav", "could not be read"), (b"x", "x.exe", "Unsupported")],
    ids=["garbage", "extension"],
)
def test_speech_rejects_bad_files(api, sarvam, data, name, message):
    res = api.post("/api/quick/speech/", {"file": SimpleUploadedFile(name, data), "target_language": "en"}, format="multipart")
    assert res.status_code == 400 and message in res.json()["detail"]
    assert sarvam == []


def test_speech_too_long(api, sarvam, settings):
    settings.QUICK_MAX_SPEECH_SECONDS = 2
    res = api.post("/api/quick/speech/", {"file": SimpleUploadedFile("a.wav", wav(4)), "target_language": "en"}, format="multipart")
    assert res.status_code == 400 and "at most 2 seconds" in res.json()["detail"]


def test_budget_blocks_before_calling_provider(api, sarvam, settings):
    settings.DAILY_LIMITS = {**settings.DAILY_LIMITS, "translate_chars": 3}
    res = api.post("/api/quick/text/", {"text": "Hello", "source_language": "en", "target_language": "ta"}, format="json")
    assert res.status_code == 429 and res.json()["code"] == "budget"
    assert sarvam == []


def test_tts_budget(api, sarvam, settings):
    settings.DAILY_LIMITS = {**settings.DAILY_LIMITS, "tts_chars": 5}
    res = api.post("/api/quick/text/", {"text": "Hello", "source_language": "en", "target_language": "ta", "speak": True}, format="json")
    assert res.status_code == 429


def test_provider_error_is_502(api, monkeypatch):
    def handler(request):
        return httpx.Response(403, json={"error": {"code": "invalid_api_key_error", "message": "bad"}})

    real = httpx.Client
    monkeypatch.setattr("meetings.sarvam_client.httpx.Client", lambda *a, **k: real(*a, **{**k, "transport": httpx.MockTransport(handler)}))
    res = api.post("/api/quick/text/", {"text": "Hello", "source_language": "en", "target_language": "ta"}, format="json")
    assert res.status_code == 502 and "rejected" in res.json()["detail"]


def test_not_configured(api, settings):
    settings.SARVAM_API_KEY = ""
    res = api.post("/api/quick/text/", {"text": "Hello", "source_language": "en", "target_language": "ta"}, format="json")
    assert res.status_code == 502 and "SARVAM_API_KEY" in res.json()["detail"]


def test_speech_transcribe_only(api, sarvam):
    f = SimpleUploadedFile("talk.wav", wav(1), content_type="audio/wav")
    res = api.post("/api/quick/speech/", {"file": f, "target_language": "en", "transcribe_only": True, "speak": True}, format="multipart")
    body = res.json()
    assert res.status_code == 200 and body["translation"] == body["original"] == "வணக்கம்" and body["audio"] is None
    assert [r.url.path for r in sarvam] == ["/speech-to-text"]
