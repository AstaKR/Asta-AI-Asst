"""Service tests with fake engines: no ML libraries or model downloads needed."""

from __future__ import annotations

import io
import wave

import pytest
import pytest_asyncio
from aiohttp.test_utils import TestClient, TestServer

from local_ai.config import LocalAIConfig
from local_ai.registry import ModelRegistry, ModelUnavailable
from local_ai.server import create_app
from local_ai.text import normalize_language, paragraphs, split_sentences


class FakeTranslator:
    def __init__(self):
        self.calls = []

    def status(self):
        return {"engine": "fake", "installed": True}

    def translate(self, text, source, target):
        self.calls.append((text, source, target))
        return f"[{target}] {text}"


class FakeSTT:
    def status(self):
        return {"engine": "fake", "installed": True}

    def transcribe(self, pcm, language, fast=False):
        return {"segments": [{"start_ms": 0, "end_ms": 1000, "text": "வணக்கம்"}], "language": language or "ta", "detected_language": "ta", "duration": len(pcm) / 32000}


class FakeTTS:
    def status(self):
        return {"engine": "fake", "installed": True}

    def synthesize(self, text, language, speaker=None):
        if text == "boom":
            raise ModelUnavailable("model not downloaded")
        return b"\x01\x00" * 160, 16000


def wav(seconds=0.5, rate=16000, channels=1):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds) * channels)
    return buf.getvalue()


@pytest_asyncio.fixture
async def client():
    cfg = LocalAIConfig(secret="s3cret", max_text_chars=50, tts_languages=frozenset({"ta", "hi"}))
    engines = {"registry": ModelRegistry(2), "translate": FakeTranslator(), "stt": FakeSTT(), "tts": FakeTTS()}
    c = TestClient(TestServer(create_app(cfg, engines)))
    await c.start_server()
    c.engines = engines
    yield c
    await c.close()


H = {"X-Local-AI-Secret": "s3cret"}


@pytest.mark.asyncio
async def test_secret_required(client):
    assert (await client.get("/health")).status == 401
    resp = await client.get("/health", headers=H)
    assert resp.status == 200 and (await resp.json())["translate"]["engine"] == "fake"


@pytest.mark.asyncio
async def test_translate_normalises_codes_and_validates(client):
    resp = await client.post("/v1/translate", json={"text": "नमस्ते", "source": "hi-IN", "target": "ta"}, headers=H)
    assert resp.status == 200 and (await resp.json())["translation"] == "[ta] नमस्ते"
    assert client.engines["translate"].calls == [("नमस्ते", "hi", "ta")]
    bad = await client.post("/v1/translate", json={"text": "x", "source": "fr", "target": "ta"}, headers=H)
    assert bad.status == 400 and (await bad.json())["code"] == "unsupported_language"
    assert (await client.post("/v1/translate", json={"text": "  ", "source": "en", "target": "ta"}, headers=H)).status == 400
    assert (await client.post("/v1/translate", json={"text": "x" * 51, "source": "en", "target": "ta"}, headers=H)).status == 413
    assert (await client.post("/v1/translate", data="nope", headers=H)).status == 400


@pytest.mark.asyncio
async def test_transcribe_requires_16k_mono_wav(client):
    ok = await client.post("/v1/transcribe?language=ta-IN", data=wav(), headers=H)
    body = await ok.json()
    assert ok.status == 200 and body["segments"][0]["text"] == "வணக்கம்" and body["language"] == "ta"
    assert (await client.post("/v1/transcribe", data=wav(rate=8000), headers=H)).status == 400
    assert (await client.post("/v1/transcribe", data=wav(channels=2), headers=H)).status == 400
    assert (await client.post("/v1/transcribe", data=b"not a wav", headers=H)).status == 400
    assert (await client.post("/v1/transcribe", data=wav(seconds=0.01), headers=H)).status == 400


@pytest.mark.asyncio
async def test_tts_returns_wav_and_reports_missing_voice(client):
    resp = await client.post("/v1/tts", json={"text": "வணக்கம்", "language": "ta"}, headers=H)
    assert resp.status == 200 and resp.content_type == "audio/wav"
    with wave.open(io.BytesIO(await resp.read())) as w:
        assert w.getframerate() == 16000 and w.getnframes() == 160
    no_voice = await client.post("/v1/tts", json={"text": "hello", "language": "en"}, headers=H)
    assert no_voice.status == 400 and "No local voice" in (await no_voice.json())["detail"]
    missing = await client.post("/v1/tts", json={"text": "boom", "language": "hi"}, headers=H)
    assert missing.status == 503 and (await missing.json())["code"] == "model_unavailable"


def test_registry_unloads_least_recently_used():
    reg = ModelRegistry(budget_gb=2.0)
    reg.get("a", 1.0, lambda: "A")
    reg.get("b", 1.0, lambda: "B")
    reg.get("a", 1.0, lambda: "never")  # cached; now most recent
    reg.get("c", 1.0, lambda: "C")
    assert reg.loaded() == ["a", "c"]

    def broken():
        raise RuntimeError("no files")

    with pytest.raises(ModelUnavailable):
        reg.get("d", 0.5, broken)


def test_text_helpers_keep_structure():
    assert normalize_language("ta-IN") == "ta" and normalize_language("fr") is None and normalize_language(None) is None
    assert paragraphs("One.\n\nTwo.") == ["One.", "", "Two."]
    assert split_sentences("मैं घर गया। फिर सो गया! OK?") == ["मैं घर गया।", "फिर सो गया!", "OK?"]
    long = ", ".join(["word " * 10] * 20)
    assert all(len(s) <= 400 for s in split_sentences(long))


def test_translator_routes_language_pairs():
    from local_ai.engines.translate import Translator

    cfg = LocalAIConfig()
    t = Translator(cfg, ModelRegistry(5))
    assert t.models_for("en", "ta") == [(cfg.mt_en_indic, "en", "ta")]
    assert t.models_for("ta", "en") == [(cfg.mt_indic_en, "ta", "en")]
    assert t.models_for("hi", "ta") == [(cfg.mt_indic_indic, "hi", "ta")]
    assert t.models_for("ta", "ta") == []
    pivot = Translator(LocalAIConfig(mt_indic_indic_mode="pivot"), ModelRegistry(5))
    assert [h[1:] for h in pivot.models_for("hi", "ta")] == [("hi", "en"), ("en", "ta")]
