"""Claude summaries via the official Anthropic SDK (structured JSON output, server-side refusal fallback)."""

from __future__ import annotations

import json

import anthropic
from django.conf import settings
from pydantic import ValidationError

from integrations import secrets

from ..claude_errors import anthropic_errors
from ..errors import ProviderNotConfigured, ProviderRequestError
from .base import LANGUAGE_NAMES, SYSTEM_PROMPT, SummaryProvider, TranscriptLine, render_transcript
from .schema import NOTES_JSON_SCHEMA, MeetingNotes


class AnthropicSummaryProvider(SummaryProvider):
    name = "anthropic"

    def __init__(self, client: anthropic.Anthropic | None = None):
        key = secrets.get("anthropic_api_key") if client is None else ""
        if client is None and not key:
            raise ProviderNotConfigured("The Anthropic API key is not set (admin page or ANTHROPIC_API_KEY).")
        self.client = client or anthropic.Anthropic(api_key=key, timeout=300.0)
        self.model = settings.SUMMARY_MODEL

    def summarize(self, title: str, lines: list[TranscriptLine], language: str) -> MeetingNotes:
        with anthropic_errors():
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",  # a declined request is retried server-side on a fallback model
                system=SYSTEM_PROMPT.replace("{language}", LANGUAGE_NAMES.get(language, "English")),
                messages=[{"role": "user", "content": render_transcript(title, lines)}],
                output_config={
                    "effort": settings.SUMMARY_EFFORT,
                    "format": {"type": "json_schema", "schema": NOTES_JSON_SCHEMA},
                },
            )

        if response.stop_reason == "refusal":
            raise ProviderRequestError("The AI declined to summarize this transcript.")
        if response.stop_reason == "max_tokens":
            raise ProviderRequestError("The summary was cut off; the transcript may be too long.")
        text = "".join(b.text for b in response.content if b.type == "text")
        try:
            return MeetingNotes.model_validate(json.loads(text))
        except (json.JSONDecodeError, ValidationError) as exc:
            raise ProviderRequestError("The AI returned notes in an unexpected format.") from exc
