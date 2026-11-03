"""Local assistant (ASSISTANT_PROVIDER=ollama) against a mocked Ollama server."""

import base64
import json

import httpx
import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from assistant.models import AssistantUsage

User = get_user_model()
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 64
PHOTO = {"detected_language": "Tamil", "summary": "A shop sign", "lines": [{"original": "மருந்தகம்", "translation": "Pharmacy"}]}


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.ASSISTANT_PROVIDER = "ollama"
    settings.ANTHROPIC_API_KEY = ""
    settings.ASSISTANT_OLLAMA_MODEL = "qwen3:4b"
    settings.ASSISTANT_VISION_MODEL = "qwen3-vl:4b-instruct"
    settings.ASSISTANT_DAILY_REQUESTS_PER_USER = 100
    settings.ASSISTANT_DAILY_REQUESTS = 500
    cache.clear()


class Seen(list):
    state: dict


@pytest.fixture
def ollama(monkeypatch):
    seen = Seen()
    state = {"status": 200, "content": "<think>hmm</think>வணக்கம் means hello."}

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        seen.append(body)
        if state["status"] != 200:
            return httpx.Response(state["status"], json={"error": "x"})
        content = json.dumps(PHOTO) if body.get("format") else state["content"]
        return httpx.Response(200, json={"message": {"role": "assistant", "content": content}, "done_reason": "stop", "prompt_eval_count": 50, "eval_count": 9})

    real = httpx.Client

    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr("assistant.ollama.httpx.Client", client)
    seen.state = state
    return seen


@pytest.fixture
def api(db):
    User.objects.create_user(username="asha", password="pw-123456-xyz")
    c = APIClient()
    assert c.login(username="asha", password="pw-123456-xyz")
    return c


def test_config_reports_local_provider_without_a_key(api):
    data = api.get("/api/assistant/config/").json()
    assert data["enabled"] is True and data["provider"] == "ollama"


def test_chat_uses_local_model_and_strips_thinking(api, ollama):
    resp = api.post("/api/assistant/chat/", {"messages": [{"role": "user", "content": "What is வணக்கம்?"}], "language": "ta"}, format="json")
    assert resp.status_code == 200, resp.content
    assert resp.json()["reply"] == "வணக்கம் means hello."
    body = ollama[0]
    assert body["model"] == "qwen3:4b" and body["think"] is False and body["stream"] is False
    assert body["options"]["num_predict"] == 700  # reply length is capped for slow CPUs
    assert body["messages"][0]["role"] == "system" and "Tamil" in body["messages"][0]["content"]
    usage = AssistantUsage.objects.get()
    assert usage.model == "ollama:qwen3:4b" and usage.input_tokens == 50


def test_photo_uses_vision_model_with_schema(api, ollama):
    upload = SimpleUploadedFile("p.jpg", JPEG, content_type="image/jpeg")
    resp = api.post("/api/assistant/image/", {"image": upload, "language": "en"}, format="multipart")
    assert resp.status_code == 200, resp.content
    assert resp.json()["lines"][0]["translation"] == "Pharmacy"
    body = ollama[0]
    assert body["model"] == "qwen3-vl:4b-instruct" and body["format"]["required"] == ["detected_language", "summary", "lines"]
    assert base64.b64decode(body["messages"][1]["images"][0]) == JPEG


def test_webp_is_refused_locally(api, ollama):
    upload = SimpleUploadedFile("p.webp", WEBP, content_type="image/webp")
    resp = api.post("/api/assistant/image/", {"image": upload, "language": "en"}, format="multipart")
    assert resp.status_code == 502 and "JPEG or PNG" in resp.json()["detail"] and not ollama


def test_missing_model_is_explained(api, ollama):
    ollama.state["status"] = 404
    resp = api.post("/api/assistant/chat/", {"messages": [{"role": "user", "content": "hi"}]}, format="json")
    assert resp.status_code == 502 and "ollama pull qwen3:4b" in resp.json()["detail"]


def test_local_usage_costs_nothing_on_the_dashboard(db):
    user = User.objects.create_user(username="x", password="pw-123456-xyz")
    AssistantUsage.objects.create(user=user, kind="chat", model="ollama:qwen3:4b", input_tokens=10**6, output_tokens=10**6)
    AssistantUsage.objects.create(user=user, kind="chat", model="claude-opus-5-5", input_tokens=10**6, output_tokens=0)
    admin = User.objects.create_user(username="boss", password="pw-123456-xyz", is_staff=True)
    c = APIClient()
    c.force_authenticate(admin)
    today = c.get("/api/admin/overview/").json()["days"][-1]
    assert today["assistant_requests"] == 2  # both requests counted
    from adminpanel.views import estimate_inr

    assert today["cost_inr"] == estimate_inr(input_tokens=10**6)  # only the Claude tokens are priced
