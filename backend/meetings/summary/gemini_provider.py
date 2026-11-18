"""Gemini meeting notes (same prompt, schema and grounding as the Claude provider; REST via httpx)."""

from __future__ import annotations

import httpx
from django.conf import settings
from pydantic import ValidationError

from ..errors import ProviderRequestError
from ..gemini_client import gemini_key, generate_json
from .base import LANGUAGE_NAMES, SYSTEM_PROMPT, SummaryProvider, TranscriptLine, render_transcript
from .schema import NOTES_JSON_SCHEMA, MeetingNotes


class GeminiSummaryProvider(SummaryProvider):
    name = "gemini"

    def __init__(self, client: httpx.Client | None = None):
        self.key = gemini_key() if client is None else "injected-client"
        self.http = client or httpx.Client(timeout=300.0)
        self.model = settings.SUMMARY_MODEL

    def summarize(self, title: str, lines: list[TranscriptLine], language: str) -> MeetingNotes:
        result = generate_json(
            self.http,
            self.key,
            self.model,
            [{"text": render_transcript(title, lines)}],
            json_schema=NOTES_JSON_SCHEMA,
            system=SYSTEM_PROMPT.replace("{language}", LANGUAGE_NAMES.get(language, "English")),
            temperature=0.2,
            what="meeting notes",
        )
        self.input_tokens = result.input_tokens
        self.output_tokens = result.output_tokens
        try:
            return MeetingNotes.model_validate(result.data)
        except ValidationError as exc:
            raise ProviderRequestError("The AI returned notes in an unexpected format.") from exc
