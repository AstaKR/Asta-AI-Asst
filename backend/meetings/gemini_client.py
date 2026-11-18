"""One Gemini generateContent call with JSON output, retries and the app's provider errors.

Shared by meeting transcripts (audio in), meeting notes and recall (text in). Plain REST over httpx; the key is
sent in the x-goog-api-key header, never in the URL.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass

import httpx

from integrations import secrets

from .errors import (
    ProviderAuthError,
    ProviderError,
    ProviderNotConfigured,
    ProviderRateLimited,
    ProviderRequestError,
    ProviderUnavailable,
)

API_BASE = "https://generativelanguage.googleapis.com/v1beta"


@dataclass
class GeminiResult:
    data: dict
    input_tokens: int
    output_tokens: int  # includes thinking tokens, which Google bills as output


def gemini_key() -> str:
    key = secrets.get("gemini_api_key")
    if not key:
        raise ProviderNotConfigured("The Gemini API key is not set (admin page or GEMINI_API_KEY).")
    return key


def generate_json(
    http: httpx.Client,
    key: str,
    model: str,
    parts: list[dict],
    *,
    schema: dict | None = None,
    json_schema: dict | None = None,
    system: str | None = None,
    temperature: float = 0,
    what: str = "a reply",
) -> GeminiResult:
    """`schema` is Gemini's OpenAPI-style schema; `json_schema` is a standard JSON Schema. Retries 429/5xx/timeouts."""
    config: dict = {"temperature": temperature, "response_mime_type": "application/json"}
    if schema is not None:
        config["response_schema"] = schema
    if json_schema is not None:
        config["response_json_schema"] = json_schema
    body: dict = {"contents": [{"role": "user", "parts": parts}], "generationConfig": config}
    if system:
        body["system_instruction"] = {"parts": [{"text": system}]}
    url = f"{API_BASE}/models/{model}:generateContent"
    error: ProviderError | None = None
    for attempt in range(3):
        try:
            resp = http.post(url, headers={"x-goog-api-key": key}, json=body)
        except httpx.TimeoutException:
            error = ProviderUnavailable("Gemini timed out.")
        except httpx.HTTPError as exc:
            error = ProviderUnavailable(f"Could not reach Gemini ({exc.__class__.__name__}).")
        else:
            if resp.status_code < 400:
                payload = resp.json()
                usage = payload.get("usageMetadata") or {}
                tokens_in = int(usage.get("promptTokenCount") or 0)
                tokens_out = int(usage.get("candidatesTokenCount") or 0) + int(usage.get("thoughtsTokenCount") or 0)
                try:
                    candidate = payload["candidates"][0]
                    if candidate.get("finishReason") in ("SAFETY", "PROHIBITED_CONTENT", "RECITATION", "BLOCKLIST"):
                        raise ProviderRequestError(f"Gemini declined to write {what}.")
                    if candidate.get("finishReason") == "MAX_TOKENS":
                        raise ProviderRequestError(f"Gemini's {what} was cut off; the input may be too long.")
                    text = "".join(p.get("text", "") for p in candidate["content"]["parts"] if not p.get("thought"))
                    data = json.loads(text)
                except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
                    raise ProviderRequestError(f"Gemini returned {what} in an unexpected format.") from exc
                if not isinstance(data, dict):
                    raise ProviderRequestError(f"Gemini returned {what} in an unexpected format.")
                return GeminiResult(data, tokens_in, tokens_out)
            if resp.status_code in (401, 403) or (resp.status_code == 400 and "API key" in resp.text):
                raise ProviderAuthError("The Gemini API key was rejected.")
            if resp.status_code == 400:
                raise ProviderRequestError(f"Gemini rejected the request (400): {resp.text[:200]}")
            error = ProviderRateLimited("Gemini rate limit reached.") if resp.status_code == 429 else ProviderUnavailable(f"Gemini error ({resp.status_code}).")
        if attempt < 2:
            time.sleep(2 * 2**attempt)
    raise error  # type: ignore[misc]
