"""Client for the local open-source AI service (local_ai/ at the repo root: IndicTrans2, faster-whisper,
Indic Parler-TTS). Same method shapes as meetings.sarvam_client.SarvamClient so callers can switch engine.

The service runs on this machine (LOCAL_AI_URL); nothing is sent to an outside AI provider.
"""

from __future__ import annotations

import json
import logging
import time

import httpx
from django.conf import settings

from meetings.errors import ProviderError, ProviderNotConfigured, ProviderRequestError, ProviderUnavailable

log = logging.getLogger(__name__)
_HEALTH: dict = {"at": 0.0, "data": None}
HEALTH_TTL = 15.0


def configured() -> bool:
    return bool(settings.LOCAL_AI_URL)


def _short(code: str | None) -> str | None:
    return code.split("-")[0] if code and code != "auto" else None


def guess_language(text: str) -> str:
    """Script-based guess for text with no recorded language: Tamil / Devanagari (Hindi) / English."""
    tamil = sum("஀" <= ch <= "௿" for ch in text)
    deva = sum("ऀ" <= ch <= "ॿ" for ch in text)
    if not tamil and not deva:
        return "en"
    return "ta" if tamil >= deva else "hi"


class LocalAIClient:
    def __init__(self, *, http: httpx.Client | None = None, timeout: float | None = None):
        if http is None and not settings.LOCAL_AI_URL:
            raise ProviderNotConfigured("The local AI service is not set up (LOCAL_AI_URL). See docs/LOCAL_AI.md.")
        headers = {"X-Local-AI-Secret": settings.LOCAL_AI_SECRET} if settings.LOCAL_AI_SECRET else {}
        self.http = http or httpx.Client(
            base_url=settings.LOCAL_AI_URL.rstrip("/"), timeout=timeout or settings.LOCAL_AI_TIMEOUT_SECONDS, headers=headers
        )

    def _call(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            resp = self.http.request(method, path, **kwargs)
        except httpx.TimeoutException as exc:
            raise ProviderUnavailable("The local AI service took too long to answer.") from exc
        except httpx.HTTPError as exc:
            raise ProviderUnavailable("The local AI service is not running. Start it with: python -m local_ai.server") from exc
        if resp.status_code < 400:
            return resp
        try:
            detail = resp.json().get("detail", "")
        except (json.JSONDecodeError, ValueError):
            detail = resp.text[:200]
        if resp.status_code == 503:
            raise ProviderNotConfigured(f"Local AI: {detail}"[:300])
        if resp.status_code >= 500:
            raise ProviderUnavailable(f"Local AI error: {detail}"[:300])
        raise ProviderRequestError(f"Local AI rejected the request: {detail}"[:300])

    # ---------- capabilities ----------

    def health(self) -> dict:
        return self._call("GET", "/health").json()

    # ---------- same shapes as SarvamClient ----------

    def translate(self, text: str, source: str, target: str) -> str:
        """`source`/`target` are BCP-47 ('ta-IN') or short codes; 'auto' guesses from the script."""
        src = _short(source) or guess_language(text)
        tgt = _short(target)
        if src == tgt or not text.strip():
            return text
        return self._call("POST", "/v1/translate", json={"text": text, "source": src, "target": tgt}).json()["translation"]

    def speech_to_text(self, wav: bytes, language: str | None) -> tuple[str, str | None]:
        data = self.transcribe(wav, language)
        text = " ".join(s["text"] for s in data.get("segments", [])).strip()
        detected = data.get("language")
        return text, (f"{detected}-IN" if detected else None)

    def transcribe(self, wav: bytes, language: str | None) -> dict:
        params = {"language": _short(language)} if _short(language) else {}
        return self._call("POST", "/v1/transcribe", content=wav, params=params, headers={"Content-Type": "audio/wav"}).json()

    def text_to_speech(self, text: str, language: str, speaker: str | None = None) -> list[bytes]:
        body = {"text": text, "language": _short(language)}
        if speaker:
            body["speaker"] = speaker
        return [self._call("POST", "/v1/tts", json=body).content]


def health() -> dict | None:
    """Cached capabilities of the local service, or None when it is not configured / not running."""
    if not configured():
        return None
    now = time.monotonic()
    if now - _HEALTH["at"] < HEALTH_TTL:
        return _HEALTH["data"]
    try:
        data = LocalAIClient(timeout=3.0).health()
    except ProviderError as exc:
        log.info("local AI service unavailable: %s", exc)
        data = None
    _HEALTH.update(at=now, data=data)
    return data


def clear_health_cache() -> None:
    _HEALTH.update(at=0.0, data=None)
