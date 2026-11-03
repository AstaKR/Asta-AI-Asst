import asyncio
import base64
import io
import json
import wave

import httpx
import pytest
from websockets.exceptions import ConnectionClosedError
from websockets.frames import Close

from translation_worker.config import SarvamConfig, load_config
from translation_worker.providers import create_provider
from translation_worker.providers.base import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderQuotaError,
    ProviderRateLimitError,
    ProviderTimeoutError,
)
from translation_worker.providers.sarvam import SarvamProvider, split_sentences


def wav_b64(n_samples=2400, rate=24000) -> str:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x01\x00" * n_samples)
    return base64.b64encode(buf.getvalue()).decode()


def provider_with(handler, **cfg) -> tuple[SarvamProvider, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request):
        seen.append(request)
        return handler(request)

    http = httpx.AsyncClient(base_url="https://api.sarvam.ai", transport=httpx.MockTransport(wrapped))
    return SarvamProvider(SarvamConfig(api_key="test-key", **cfg), http=http), seen


def test_missing_api_key_is_a_config_error(monkeypatch):
    with pytest.raises(ProviderConfigError, match="SARVAM_API_KEY"):
        SarvamProvider(SarvamConfig(api_key=""))
    monkeypatch.setenv("SARVAM_API_KEY", "")
    with pytest.raises(ProviderConfigError):
        create_provider(load_config())


def test_unknown_provider_rejected(monkeypatch):
    monkeypatch.setenv("SPEECH_PROVIDER", "nope")
    with pytest.raises(ProviderConfigError):
        create_provider(load_config())


@pytest.mark.asyncio
async def test_translate_request_shape():
    provider, seen = provider_with(lambda r: httpx.Response(200, json={"translated_text": "नमस्ते"}))
    out = await provider.translate("வணக்கம்", "ta-IN", "hi-IN")
    assert out == "नमस्ते"
    req = seen[0]
    assert req.url.path == "/translate"
    assert req.headers["api-subscription-key"] == "test-key"
    body = json.loads(req.content)
    assert body == {
        "input": "வணக்கம்",
        "source_language_code": "ta-IN",
        "target_language_code": "hi-IN",
        "model": "mayura:v1",
    }
    assert provider.usage.translate_chars == len("வணக்கம்")


@pytest.mark.asyncio
async def test_translate_same_language_or_empty_makes_no_request():
    provider, seen = provider_with(lambda r: httpx.Response(500))
    assert await provider.translate("hello", "en-IN", "en-IN") == "hello"
    assert await provider.translate("   ", "ta-IN", "hi-IN") == ""
    assert seen == []


@pytest.mark.asyncio
async def test_quota_error_is_not_retried():
    body = {"error": {"code": "insufficient_quota_error", "message": "no credits"}}
    provider, seen = provider_with(lambda r: httpx.Response(429, json=body))
    with pytest.raises(ProviderQuotaError):
        await provider.translate("a", "ta-IN", "hi-IN")
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_rate_limit_retried_once_then_raised():
    body = {"error": {"code": "rate_limit_exceeded_error", "message": "slow down"}}
    provider, seen = provider_with(lambda r: httpx.Response(429, json=body))
    with pytest.raises(ProviderRateLimitError):
        await provider.translate("a", "ta-IN", "hi-IN")
    assert len(seen) == 2


@pytest.mark.asyncio
async def test_auth_error():
    body = {"error": {"code": "invalid_api_key_error", "message": "bad key"}}
    provider, _ = provider_with(lambda r: httpx.Response(403, json=body))
    with pytest.raises(ProviderAuthError):
        await provider.translate("a", "ta-IN", "hi-IN")


@pytest.mark.asyncio
async def test_server_error_then_success():
    responses = iter([httpx.Response(500, text="boom"), httpx.Response(200, json={"translated_text": "ok"})])
    provider, seen = provider_with(lambda r: next(responses))
    assert await provider.translate("a", "ta-IN", "hi-IN") == "ok"
    assert len(seen) == 2


@pytest.mark.asyncio
async def test_timeout_maps_to_provider_timeout():
    def raise_timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    provider, seen = provider_with(raise_timeout)
    with pytest.raises(ProviderTimeoutError):
        await provider.translate("a", "ta-IN", "hi-IN")
    assert len(seen) == 2


@pytest.mark.asyncio
async def test_tts_rest_request_and_wav_decoding():
    provider, seen = provider_with(lambda r: httpx.Response(200, json={"request_id": "x", "audios": [wav_b64()]}))
    chunks = [c async for c in provider.synthesize("नमस्ते।", "hi-IN", "kavya")]
    assert len(chunks) == 1
    assert chunks[0].sample_rate == 24000 and len(chunks[0].pcm) == 4800
    body = json.loads(seen[0].content)
    assert seen[0].url.path == "/text-to-speech"
    assert body == {
        "text": "नमस्ते।",
        "language_code": "hi-IN",
        "speaker": "kavya",
        "model": "bulbul:v3",
        "speech_sample_rate": 24000,
    }


@pytest.mark.asyncio
async def test_tts_rest_long_text_is_split_and_ordered():
    def handler(request):
        text = json.loads(request.content)["text"]
        n = 100 if text.startswith("One") else 200
        return httpx.Response(200, json={"audios": [wav_b64(n)]})

    provider, seen = provider_with(handler)
    text = "One " + "word " * 60 + ". Two " + "word " * 60 + "."
    chunks = [c async for c in provider.synthesize(text, "hi-IN", None)]
    assert [len(c.pcm) for c in chunks] == [200, 400]
    assert json.loads(seen[0].content)["speaker"] == "shubh"  # default speaker


def test_split_sentences():
    assert split_sentences("नमस्ते। आप कैसे हैं? ठीक") == ["नमस्ते।", "आप कैसे हैं?", "ठीक"]
    assert split_sentences("") == []
    long = "x " * 400
    assert all(len(c) <= 440 for c in split_sentences(long))


class FakeWS:
    def __init__(self):
        self.sent: list[dict] = []
        self.incoming: asyncio.Queue = asyncio.Queue()
        self.close_code = None
        self.close_reason = ""

    async def send(self, msg):
        self.sent.append(json.loads(msg))

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.incoming.get()
        if item is StopAsyncIteration:
            raise StopAsyncIteration
        if isinstance(item, Exception):
            raise item
        return item

    async def close(self):
        self.incoming.put_nowait(StopAsyncIteration)


def ws_provider():
    ws = FakeWS()
    calls = {}

    async def connect(url, **kwargs):
        calls["url"], calls["kwargs"] = url, kwargs
        return ws

    provider = SarvamProvider(SarvamConfig(api_key="k"), ws_connect=connect, http=httpx.AsyncClient())
    return provider, ws, calls


@pytest.mark.asyncio
async def test_realtime_stt_protocol():
    provider, ws, calls = ws_provider()
    stream = await provider.open_stt_stream("ta-IN")
    assert calls["url"].startswith("wss://api.sarvam.ai/speech-to-text-realtime/ws?")
    assert "language_code=ta-IN" in calls["url"] and "encoding=linear16" in calls["url"]
    assert "sample_rate=16000" in calls["url"] and "model=saaras%3Av3-realtime" in calls["url"]
    assert calls["kwargs"]["additional_headers"] == {"API-SUBSCRIPTION-KEY": "k"}

    await stream.push_audio(b"\x00" * 3000)
    assert ws.sent == []  # buffered until 100 ms
    await stream.push_audio(b"\x00" * 400)
    assert ws.sent[0]["event"] == "audio_input"
    assert len(base64.b64decode(ws.sent[0]["audio"])) == 3200
    assert provider.usage.stt_seconds == pytest.approx(0.1)

    for msg in [
        {"type": "session.begin", "request_id": "r"},
        {"type": "vad.speech_start", "utterance_idx": 0},
        {"type": "transcript.partial", "utterance_idx": 0, "text": "வண"},
        {"type": "vad.speech_end", "utterance_idx": 0},
        {"type": "transcript.final", "utterance_idx": 0, "text": "வணக்கம்"},
    ]:
        ws.incoming.put_nowait(json.dumps(msg))
    events = []
    async for ev in stream.events():
        events.append((ev.type, ev.text, ev.utterance_id))
        if ev.type == "final":
            break
    assert events == [
        ("speech_start", "", "0"),
        ("partial", "வண", "0"),
        ("speech_end", "", "0"),
        ("final", "வணக்கம்", "0"),
    ]
    await stream.aclose()
    assert ws.sent[-1] == {"event": "end"}


@pytest.mark.asyncio
async def test_realtime_stt_quota_close_code():
    provider, ws, _ = ws_provider()
    stream = await provider.open_stt_stream("hi-IN")
    ws.incoming.put_nowait(ConnectionClosedError(Close(1003, "quota exhausted"), None))
    with pytest.raises(ProviderQuotaError):
        async for _ in stream.events():
            pass
    assert stream.closed


@pytest.mark.asyncio
async def test_realtime_stt_fatal_error_message():
    provider, ws, _ = ws_provider()
    stream = await provider.open_stt_stream("hi-IN")
    ws.incoming.put_nowait(json.dumps({"type": "error", "code": "invalid_api_key_error", "is_fatal": True,
                                       "message": "bad", "status_code": 403}))
    with pytest.raises(ProviderAuthError):
        async for _ in stream.events():
            pass


@pytest.mark.asyncio
async def test_handshake_failure_is_mapped():
    async def connect(url, **kwargs):
        raise TimeoutError()

    provider = SarvamProvider(SarvamConfig(api_key="k"), ws_connect=connect, http=httpx.AsyncClient())
    with pytest.raises(ProviderTimeoutError):
        await provider.open_stt_stream("ta-IN")


@pytest.mark.asyncio
async def test_legacy_stt_protocol():
    ws = FakeWS()
    calls = {}

    async def connect(url, **kwargs):
        calls["url"], calls["kwargs"] = url, kwargs
        return ws

    provider = SarvamProvider(SarvamConfig(api_key="k", stt_api="legacy"), ws_connect=connect, http=httpx.AsyncClient())
    stream = await provider.open_stt_stream("hi-IN")
    assert calls["url"].startswith("wss://api.sarvam.ai/speech-to-text/ws?")
    assert "language-code=hi-IN" in calls["url"] and "model=saaras%3Av3" in calls["url"]
    assert calls["kwargs"]["additional_headers"] == {"Api-Subscription-Key": "k"}
    await stream.push_audio(b"\x00" * 3200)
    assert ws.sent[0]["audio"]["sample_rate"] == "16000"
    ws.incoming.put_nowait(json.dumps({"type": "events", "data": {"signal_type": "START_SPEECH"}}))
    ws.incoming.put_nowait(json.dumps({"type": "data", "data": {"transcript": "नमस्ते", "request_id": "r"}}))
    got = []
    async for ev in stream.events():
        got.append(ev.type)
        if ev.type == "final":
            assert ev.text == "नमस्ते"
            break
    assert got == ["speech_start", "final"]
    await stream.aclose()


@pytest.mark.asyncio
async def test_auto_language_stt_urls():
    provider, ws, calls = ws_provider()
    await (await provider.open_stt_stream("auto")).aclose()
    assert "language_code=auto" in calls["url"]
    ws2, calls2 = FakeWS(), {}

    async def connect(url, **kwargs):
        calls2["url"] = url
        return ws2

    legacy = SarvamProvider(SarvamConfig(api_key="k", stt_api="legacy"), ws_connect=connect, http=httpx.AsyncClient())
    await (await legacy.open_stt_stream("auto")).aclose()
    assert "language-code=unknown" in calls2["url"]
