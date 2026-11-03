"""Meeting notes from a local model served by Ollama (https://ollama.com; free, runs on this server).

Uses Ollama's chat API with a JSON-schema `format`, so the reply must match the notes schema. The same
evidence grounding as the Claude provider is applied by the caller, so uncited items are dropped.
Small local models write weaker notes than Claude; the notes are labelled with the model name.
"""

from __future__ import annotations

import json

import httpx
from django.conf import settings
from pydantic import ValidationError

from ..errors import ProviderNotConfigured, ProviderRequestError, ProviderUnavailable
from .base import LANGUAGE_NAMES, SYSTEM_PROMPT, SummaryProvider, TranscriptLine, render_transcript
from .schema import NOTES_JSON_SCHEMA, MeetingNotes


class OllamaSummaryProvider(SummaryProvider):
    name = "ollama"

    def __init__(self, http: httpx.Client | None = None):
        self.model = settings.OLLAMA_MODEL
        self.http = http or httpx.Client(base_url=settings.OLLAMA_URL.rstrip("/"), timeout=settings.OLLAMA_TIMEOUT_SECONDS)

    def summarize(self, title: str, lines: list[TranscriptLine], language: str) -> MeetingNotes:
        body = {
            "model": self.model,
            "stream": False,
            "think": False,
            "format": NOTES_JSON_SCHEMA,
            "options": {"temperature": 0},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT.replace("{language}", LANGUAGE_NAMES.get(language, "English"))},
                {"role": "user", "content": render_transcript(title, lines)},
            ],
        }
        try:
            resp = self.http.post("/api/chat", json=body)
        except httpx.TimeoutException as exc:
            raise ProviderUnavailable("The local summary model took too long.") from exc
        except httpx.HTTPError as exc:
            raise ProviderUnavailable("Ollama is not running. Start it, or set SUMMARY_PROVIDER=anthropic.") from exc
        if resp.status_code == 404:
            raise ProviderNotConfigured(f"The local model {self.model!r} is not installed. Run: ollama pull {self.model}")
        if resp.status_code >= 400:
            raise ProviderRequestError(f"Ollama rejected the request ({resp.status_code}).")
        try:
            content = resp.json()["message"]["content"]
            return MeetingNotes.model_validate(json.loads(content))
        except (KeyError, json.JSONDecodeError, ValidationError) as exc:
            raise ProviderRequestError("The local model returned notes in an unexpected format. Try again or use a larger model.") from exc
