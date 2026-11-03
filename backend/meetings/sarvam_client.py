"""Minimal synchronous Sarvam REST client for batch meeting work (the live worker has its own async client).

Endpoints (docs.sarvam.ai): POST /speech-to-text (multipart: file, model, mode, language_code; <= 30 s of
audio), POST /translate (JSON: input, source_language_code, target_language_code, model), POST /text-to-speech
(JSON: text, language_code, speaker, model, speech_sample_rate -> {"audios": [<b64 WAV>]}; same request as the
live worker's REST mode).
Header: api-subscription-key. Errors: {"error": {"code", "message"}}.
"""

from __future__ import annotations

import base64
import json
import logging
import time

import httpx
from django.conf import settings

from .errors import (
    ProviderAuthError,
    ProviderError,
    ProviderNotConfigured,
    ProviderQuotaError,
    ProviderRateLimited,
    ProviderRequestError,
    ProviderUnavailable,
)

log = logging.getLogger(__name__)
BASE_URL = "https://api.sarvam.ai"


def _error(status: int, body: str) -> ProviderError:
    code, message = "", body[:200]
    try:
        err = json.loads(body).get("error", {})
        code, message = err.get("code", ""), err.get("message", message)
    except Exception:
        pass
    if status == 403 or code == "invalid_api_key_error":
        return ProviderAuthError("The Sarvam API key was rejected.")
    if code == "insufficient_quota_error":
        return ProviderQuotaError("Sarvam credits are exhausted.")
    if status in (429, 503) or code == "rate_limit_exceeded_error":
        return ProviderRateLimited("Sarvam rate limit reached.")
    if status >= 500:
        return ProviderUnavailable(f"Sarvam server error ({status}).")
    return ProviderRequestError(f"Sarvam rejected the request ({status}): {message}"[:300])


class SarvamClient:
    def __init__(self, api_key: str | None = None, *, http: httpx.Client | None = None, min_interval: float | None = None):
        if api_key is None:
            from integrations import secrets

            api_key = secrets.get("sarvam_api_key")
        self.api_key = api_key
        if not self.api_key:
            raise ProviderNotConfigured("The Sarvam API key is not set (admin page or SARVAM_API_KEY).")
        self.http = http or httpx.Client(base_url=BASE_URL, timeout=settings.PROVIDER_TIMEOUT_SECONDS)
        # Starter plan: 60 requests/minute. Pace calls so long recordings don't trip the limit.
        self.min_interval = settings.SARVAM_MIN_REQUEST_INTERVAL if min_interval is None else min_interval
        self._last = 0.0

    def _pace(self):
        wait = self.min_interval - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def _post(self, path: str, **kwargs) -> dict:
        headers = {"api-subscription-key": self.api_key}
        for attempt in range(4):
            self._pace()
            try:
                resp = self.http.post(path, headers=headers, **kwargs)
            except httpx.TimeoutException:
                error: ProviderError = ProviderUnavailable("Sarvam timed out.")
            except httpx.HTTPError as exc:
                error = ProviderUnavailable(f"Could not reach Sarvam ({exc.__class__.__name__}).")
            else:
                if resp.status_code < 400:
                    return resp.json()
                error = _error(resp.status_code, resp.text)
            if not error.retryable or attempt == 3:
                raise error
            time.sleep(min(8.0, 1.0 * 2**attempt))
        raise AssertionError("unreachable")

    def speech_to_text(self, wav: bytes, language: str | None) -> tuple[str, str | None]:
        """language: BCP-47 (e.g. 'ta-IN') or None to auto-detect. Returns (transcript, language_code)."""
        data = {
            "model": settings.MEETING_STT_MODEL,
            "mode": settings.MEETING_STT_MODE,
            "language_code": language or "unknown",
        }
        body = self._post("/speech-to-text", files={"file": ("chunk.wav", wav, "audio/wav")}, data=data)
        return (body.get("transcript") or "").strip(), body.get("language_code")

    def translate(self, text: str, source: str, target: str) -> str:
        if not text.strip() or source == target:
            return text
        body = self._post(
            "/translate",
            json={
                "input": text[:1000],
                "source_language_code": source,
                "target_language_code": target,
                "model": settings.MEETING_TRANSLATE_MODEL,
            },
        )
        return (body.get("translated_text") or "").strip()

    def text_to_speech(self, text: str, language: str, speaker: str) -> list[bytes]:
        """language: BCP-47. Returns the WAV file(s) Sarvam produced (usually one)."""
        body = self._post(
            "/text-to-speech",
            json={
                "text": text,
                "language_code": language,
                "speaker": speaker,
                "model": settings.QUICK_TTS_MODEL,
                "speech_sample_rate": settings.QUICK_TTS_SAMPLE_RATE,
            },
        )
        return [base64.b64decode(a) for a in body.get("audios") or []]
