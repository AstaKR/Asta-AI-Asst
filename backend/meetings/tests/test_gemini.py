import json

import httpx
import numpy as np
import pytest

from meetings.errors import ProviderAuthError
from meetings.transcription.gemini import GeminiTranscriber, _mmss, pcm_to_mp3, windows

RATE = 16000


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _reply(segments):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps({"segments": segments})}]}}], "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5}})


def test_mmss_parsing():
    assert _mmss("01:05") == 65000
    assert _mmss("1:02:03") == 3723000
    assert _mmss("12") == 12000
    assert _mmss("") == 0


def test_windows_cut_long_audio_at_quiet_points_and_cover_everything():
    n = RATE * 700
    pcm = (np.random.default_rng(1).normal(0, 3000, n)).astype(np.int16)
    pcm[RATE * 290 : RATE * 291] = 0  # quiet second near 290 s
    spans = windows(pcm.tobytes(), RATE)
    assert spans[0][0] == 0 and spans[-1][1] == n
    assert all(a[1] == b[0] for a, b in zip(spans, spans[1:]))
    assert 289 * RATE <= spans[0][1] <= 292 * RATE
    assert windows(pcm[: RATE * 60].tobytes(), RATE) == [(0, RATE * 60)]


def test_pcm_to_mp3_produces_audio():
    pcm = (np.sin(np.arange(RATE * 2) * 0.1) * 8000).astype(np.int16).tobytes()
    assert len(pcm_to_mp3(pcm, RATE)) > 1000


def test_transcribe_returns_speaker_segments_with_absolute_times():
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            return _reply([{"speaker": "Speaker 1", "start": "00:01", "end": "00:04", "language": "ta", "text": "வணக்கம்"}])
        return _reply([{"speaker": "Speaker 2", "start": "00:02", "end": "00:05", "language": "en", "text": "Hello"}])

    pcm = (np.random.default_rng(2).normal(0, 2000, RATE * 700)).astype(np.int16).tobytes()
    t = GeminiTranscriber(client=_client(handler))
    out = t.transcribe(pcm, RATE, None)
    assert [s.speaker for s in out] == ["Speaker 1", "Speaker 2", "Speaker 2"][: len(out)] or out[0].speaker == "Speaker 1"
    assert out[0].start_ms == 1000 and out[0].language == "ta"
    assert out[-1].start_ms > 250_000  # later windows are offset by their start
    assert "previous lines were" in calls[1]["contents"][0]["parts"][0]["text"]  # label continuity hint
    assert t.input_tokens == 10 * len(calls)


def test_bad_key_is_reported_as_auth_error():
    t = GeminiTranscriber(client=_client(lambda r: httpx.Response(400, text="API key not valid")))
    with pytest.raises(ProviderAuthError):
        t.transcribe((np.zeros(RATE * 2)).astype(np.int16).tobytes(), RATE, None)
