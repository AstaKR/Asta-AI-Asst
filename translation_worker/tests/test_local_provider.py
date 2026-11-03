"""LocalProvider against a mocked local AI service (no models needed)."""

from __future__ import annotations

import asyncio
import io
import json
import math
import struct
import wave

import httpx
import pytest

from translation_worker.config import LocalAIConfig
from translation_worker.providers.base import ProviderConfigError, ProviderRequestError, ProviderUnavailableError
from translation_worker.providers.local import LocalProvider

FRAME = 320  # 20 ms at 16 kHz


def tone(ms: int, amp: float = 0.3) -> bytes:
    n = 16 * ms
    return b"".join(struct.pack("<h", int(amp * 32767 * math.sin(2 * math.pi * 300 * i / 16000))) for i in range(n))


def silence(ms: int) -> bytes:
    return b"\x00\x00" * 16 * ms


def frames(pcm: bytes):
    for i in range(0, len(pcm), FRAME * 2):
        yield pcm[i : i + FRAME * 2]


def wav_body(pcm: bytes, rate=16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def make(handler, **cfg) -> LocalProvider:
    transport = httpx.MockTransport(handler)
    return LocalProvider(LocalAIConfig(url="http://local", **cfg), http=httpx.AsyncClient(base_url="http://local", transport=transport))


async def collect(stream, n, kind=None):
    """The first `n` events (or the first `n` of type `kind`)."""
    out = []
    async for ev in stream.events():
        if kind is None or ev.type == kind:
            out.append(ev)
        if len(out) == n:
            break
    return out


@pytest.mark.asyncio
async def test_utterances_are_cut_on_silence_and_recognised_in_order():
    seen = []

    def handler(req: httpx.Request):
        assert req.url.path == "/v1/transcribe" and req.url.params["fast"] == "1" and req.url.params["language"] == "ta-IN"
        with wave.open(io.BytesIO(req.content)) as w:
            seconds = w.getnframes() / w.getframerate()
        seen.append(round(seconds, 1))
        return httpx.Response(200, json={"segments": [{"start_ms": 0, "end_ms": 1, "text": f"utt{len(seen)}"}], "language": "ta"})

    p = make(handler, end_silence_ms=400)
    stt = await p.open_stt_stream("ta-IN")
    for f in frames(silence(200) + tone(600) + silence(500) + tone(400) + silence(500)):
        await stt.push_audio(f)
    events = await asyncio.wait_for(collect(stt, 6), 5)
    assert [e.type for e in events if e.type != "final"] == ["speech_start", "speech_end", "speech_start", "speech_end"]
    finals = [e for e in events if e.type == "final"]
    assert [f.text for f in finals] == ["utt1", "utt2"] and finals[0].language == "ta-IN"
    assert seen == [0.6, 0.4]  # trailing silence is not sent
    await stt.aclose()
    await p.aclose()


@pytest.mark.asyncio
async def test_long_speech_is_split_and_short_clicks_skip_the_service():
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(200, json={"segments": [{"start_ms": 0, "end_ms": 1, "text": "x"}], "language": "hi"})

    p = make(handler, max_utterance_seconds=1.0, min_utterance_ms=300)
    stt = await p.open_stt_stream("auto")
    for f in frames(tone(100) + silence(800) + tone(1500)):
        await stt.push_audio(f)
    finals = await asyncio.wait_for(collect(stt, 2, "final"), 5)
    assert finals[0].text == "" and finals[1].text == "x" and finals[1].language == "hi-IN"
    assert len(calls) == 1 and "language" not in calls[0].url.params
    await stt.aclose()


@pytest.mark.asyncio
async def test_service_errors_map_to_provider_errors():
    responses = iter(
        [
            httpx.Response(503, json={"detail": "model not downloaded", "code": "model_unavailable"}),
            httpx.Response(400, json={"detail": "bad"}),
        ]
    )
    p = make(lambda req: next(responses))
    with pytest.raises(ProviderConfigError, match="model not downloaded"):
        await p.translate("hello", "en-IN", "ta-IN")
    with pytest.raises(ProviderRequestError):
        await p.translate("hello", "en-IN", "ta-IN")

    def down(req):
        raise httpx.ConnectError("refused")

    with pytest.raises(ProviderUnavailableError):
        await make(down).translate("hello", "en-IN", "hi-IN")
    with pytest.raises(ProviderRequestError):
        await p.translate("hello", "en-IN", "fr-FR")
    assert await p.translate("same", "ta-IN", "ta-IN") == "same"


@pytest.mark.asyncio
async def test_failed_recognition_ends_the_stream_with_a_retryable_error():
    p = make(lambda req: httpx.Response(500, json={"detail": "boom"}), end_silence_ms=200)
    stt = await p.open_stt_stream("en-IN")
    for f in frames(tone(500) + silence(300)):
        await stt.push_audio(f)
    with pytest.raises(ProviderUnavailableError):
        await asyncio.wait_for(collect(stt, 10), 5)
    assert stt.closed
    with pytest.raises(ProviderUnavailableError):
        await stt.push_audio(tone(20))


@pytest.mark.asyncio
async def test_translate_and_synthesize_sentence_by_sentence():
    tts_texts = []

    def handler(req: httpx.Request):
        body = json.loads(req.content)
        if req.url.path == "/v1/translate":
            assert body == {"text": "hello", "source": "en-IN", "target": "ta-IN"}
            return httpx.Response(200, json={"translation": "வணக்கம்"})
        tts_texts.append(body["text"])
        assert "speaker" not in body  # Sarvam voice names are not passed on
        return httpx.Response(200, content=wav_body(tone(100), rate=44100 // 2), headers={"Content-Type": "audio/wav"})

    p = make(handler)
    assert await p.translate("hello", "en-IN", "ta-IN") == "வணக்கம்"
    chunks = [c async for c in p.synthesize("முதல் வாக்கியம். இரண்டாவது வாக்கியம்.", "ta-IN", "shubh")]
    assert len(tts_texts) >= 1 and all(c.sample_rate == 22050 and c.pcm for c in chunks)
    assert p.usage.translate_chars == 0 and p.usage.tts_chars == 0  # free engine: nothing billed


def test_factory_requires_url():
    from translation_worker.config import load_config
    from translation_worker.providers import create_provider

    import dataclasses

    cfg = dataclasses.replace(load_config(), provider="local", local=LocalAIConfig(url=""))
    with pytest.raises(ProviderConfigError, match="LOCAL_AI_URL"):
        create_provider(cfg)
