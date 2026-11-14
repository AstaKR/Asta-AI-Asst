"""Gemini speech-to-text with speaker labels, for group meetings recorded on one device.

Audio is cut into ~5-minute windows (at the quietest moment near the end, so words are not split), each sent to
Gemini as a small MP3 with a JSON schema that returns who spoke, when and what. Speakers are labelled
"Speaker 1", "Speaker 2"... and the last lines of the previous window are passed along so labels stay the same
across windows. Timestamps are made absolute by adding the window's start.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
import time

import av
import httpx
import numpy as np
from django.conf import settings

from integrations import secrets

from ..errors import (
    ProviderAuthError,
    ProviderError,
    ProviderNotConfigured,
    ProviderRateLimited,
    ProviderRequestError,
    ProviderUnavailable,
)
from .base import ProgressCallback, Segment, Transcriber

log = logging.getLogger(__name__)
API_BASE = "https://generativelanguage.googleapis.com/v1beta"
LANGS = {"ta": "Tamil", "hi": "Hindi", "en": "English"}

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "segments": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "speaker": {"type": "STRING"},
                    "start": {"type": "STRING", "description": "MM:SS from the start of this audio"},
                    "end": {"type": "STRING", "description": "MM:SS from the start of this audio"},
                    "language": {"type": "STRING", "enum": ["ta", "hi", "en", "other"]},
                    "text": {"type": "STRING"},
                },
                "required": ["speaker", "start", "end", "language", "text"],
            },
        }
    },
    "required": ["segments"],
}

PROMPT = """Transcribe this meeting audio exactly as spoken. Several people may be talking; the speech may mix Tamil, Hindi and English.

Rules:
- Return one segment per speaker turn (split a very long turn at sentence ends, at most ~30 seconds each).
- "speaker" is "Speaker 1", "Speaker 2", ... Use the same label for the same voice throughout. Do not invent names.
- Write each language in its own script (Tamil in Tamil script, Hindi in Devanagari, English in Latin). Do not translate.
- "start" and "end" are MM:SS counted from the start of THIS audio.
- Do not add words that were not said. Skip silence, music and background noise. If nobody speaks, return an empty list.{context}"""


def pcm_to_mp3(pcm: bytes, rate: int, bitrate: int = 48000) -> bytes:
    """Mono 16-bit PCM -> small MP3 bytes (a 5-minute window is ~1.8 MB)."""
    buf = io.BytesIO()
    out = av.open(buf, "w", format="mp3")
    try:
        stream = out.add_stream("libmp3lame", rate=rate, layout="mono")
        stream.bit_rate = bitrate
        samples = np.frombuffer(pcm, dtype=np.int16).reshape(1, -1)
        frame = av.AudioFrame.from_ndarray(samples, format="s16", layout="mono")
        frame.sample_rate = rate
        resampler = av.AudioResampler(format=stream.codec_context.format.name, layout="mono", rate=rate)
        for rf in resampler.resample(frame):
            for packet in stream.encode(rf):
                out.mux(packet)
        for rf in resampler.resample(None):
            for packet in stream.encode(rf):
                out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)
    finally:
        out.close()
    return buf.getvalue()


def windows(pcm: bytes, rate: int, target_s: float = 300.0, search_s: float = 20.0) -> list[tuple[int, int]]:
    """Cuts [0, n) samples into windows of about target_s, each cut at the quietest 100 ms in the last search_s."""
    n = len(pcm) // 2
    if n <= int((target_s + search_s) * rate):
        return [(0, n)]
    x = np.abs(np.frombuffer(pcm, dtype=np.int16).astype(np.float32))
    step = rate // 10
    out, start = [], 0
    while n - start > int((target_s + search_s) * rate):
        lo = start + int((target_s - search_s) * rate)
        hi = start + int(target_s * rate)
        seg = x[lo:hi][: (hi - lo) // step * step].reshape(-1, step).mean(axis=1)
        cut = lo + int(np.argmin(seg)) * step + step // 2
        out.append((start, cut))
        start = cut
    out.append((start, n))
    return out


def _mmss(value: str) -> int:
    """'MM:SS' (or 'H:MM:SS', or plain seconds) -> milliseconds; 0 when unreadable."""
    parts = re.findall(r"\d+(?:\.\d+)?", value or "")
    if not parts:
        return 0
    secs = 0.0
    for p in parts[-3:]:
        secs = secs * 60 + float(p)
    return int(secs * 1000)


class GeminiTranscriber(Transcriber):
    name = "gemini"
    billed = False  # not counted against the Sarvam daily budget

    def __init__(self, client: httpx.Client | None = None):
        super().__init__()
        self.key = secrets.get("gemini_api_key") if client is None else "injected-client"
        if not self.key and client is None:
            raise ProviderNotConfigured("The Gemini API key is not set (admin page or GEMINI_API_KEY).")
        self.model = settings.MEETING_GEMINI_MODEL
        self.http = client or httpx.Client(timeout=300.0)
        self.input_tokens = 0
        self.output_tokens = 0
        self.prior: list[str] = []  # last transcript lines before this audio (keeps speaker labels steady)

    def _generate(self, mp3: bytes, context: str, language: str | None) -> list[dict]:
        hint = f"\nThe main spoken language is {LANGS[language]}." if language in LANGS else ""
        body = {
            "contents": [
                {
                    "parts": [
                        {"text": PROMPT.format(context=hint + context)},
                        {"inline_data": {"mime_type": "audio/mp3", "data": base64.b64encode(mp3).decode()}},
                    ]
                }
            ],
            "generationConfig": {"temperature": 0, "response_mime_type": "application/json", "response_schema": SCHEMA},
        }
        url = f"{API_BASE}/models/{self.model}:generateContent"
        error: ProviderError | None = None
        for attempt in range(3):
            try:
                resp = self.http.post(url, headers={"x-goog-api-key": self.key}, json=body)
            except httpx.TimeoutException:
                error = ProviderUnavailable("Gemini timed out.")
            except httpx.HTTPError as exc:
                error = ProviderUnavailable(f"Could not reach Gemini ({exc.__class__.__name__}).")
            else:
                if resp.status_code < 400:
                    data = resp.json()
                    usage = data.get("usageMetadata") or {}
                    self.input_tokens += int(usage.get("promptTokenCount") or 0)
                    self.output_tokens += int(usage.get("candidatesTokenCount") or 0)
                    try:
                        text = data["candidates"][0]["content"]["parts"][0]["text"]
                        return json.loads(text).get("segments", [])
                    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
                        raise ProviderRequestError("Gemini returned a transcript in an unexpected format.") from exc
                if resp.status_code in (401, 403) or (resp.status_code == 400 and "API key" in resp.text):
                    raise ProviderAuthError("The Gemini API key was rejected.")
                if resp.status_code == 400:
                    raise ProviderRequestError("Gemini rejected the audio (400).")
                error = ProviderRateLimited("Gemini rate limit reached.") if resp.status_code == 429 else ProviderUnavailable(f"Gemini error ({resp.status_code}).")
            if attempt < 2:
                time.sleep(2 * 2**attempt)
        raise error  # type: ignore[misc]

    def transcribe(self, pcm: bytes, rate: int, language: str | None, on_progress: ProgressCallback | None = None) -> list[Segment]:
        wins = windows(pcm, rate)
        out: list[Segment] = []
        for i, (a, b) in enumerate(wins):
            context = ""
            lines = [f"{s.speaker}: {s.text}" for s in out[-3:]] or self.prior
            if lines:
                tail = "\n".join(lines)
                context = f"\nThis audio continues a meeting. The previous lines were:\n{tail}\nKeep the same speaker labels for the same voices."
            rows = self._generate(pcm_to_mp3(pcm[a * 2 : b * 2], rate), context, language)
            base_ms = round(a * 1000 / rate)
            for r in rows:
                text = (r.get("text") or "").strip()
                if not text:
                    continue
                start = base_ms + _mmss(r.get("start", ""))
                end = max(start, base_ms + _mmss(r.get("end", "")))
                lang = r.get("language")
                out.append(
                    Segment(start_ms=start, end_ms=end, text=text, language=lang if lang in LANGS else None, speaker=(r.get("speaker") or "").strip()[:80])
                )
            if on_progress:
                on_progress((i + 1) / len(wins))
        out.sort(key=lambda s: s.start_ms)
        return out
