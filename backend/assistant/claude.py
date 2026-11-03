"""Claude calls for the assistant: language-helper chat and photo text translation (official Anthropic SDK)."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass

import anthropic
from django.conf import settings
from pydantic import BaseModel, ValidationError

from integrations import secrets
from meetings.claude_errors import anthropic_errors
from meetings.errors import ProviderNotConfigured, ProviderRequestError
from meetings.languages import MEETING_LANGUAGES

CHAT_SYSTEM = """You are the built-in assistant of the AI Call Translator mobile app, used in India.
You help people communicate across Tamil, Hindi and English: translating words and sentences, explaining
meaning, tone and politeness, writing short messages or replies for them, giving pronunciation in Latin
letters, and explaining local etiquette. You can also explain the app's features: calls with live voice
translation, video calls, Face to face mode (one phone between two people), Instant translate, Photo
translate, and Meetings (record or upload audio, transcripts, AI notes, exports).

Reply in {language} unless the person asks for another language. Put any translation on its own line so it
can be copied. Keep answers short: people read on a phone and may listen to the reply. Use plain sentences
with no markdown tables, headings or bold. If you are not sure about a translation, say so."""

IMAGE_SYSTEM = """You read the text in a photo or screenshot and translate it into {language}.
Transcribe the visible text faithfully in reading order, grouping it into short lines (a sign, a menu item,
a sentence). Translate each line into {language}; if a line is already in {language}, repeat it unchanged.
Skip decorative or unreadable fragments. In `summary`, say in one short {language} sentence what the image
shows (for example "A bus timetable"). If there is no readable text, return an empty `lines` list."""

IMAGE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "detected_language": {"type": "string", "description": "Main language of the text, in English, e.g. Tamil"},
        "summary": {"type": "string"},
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"original": {"type": "string"}, "translation": {"type": "string"}},
                "required": ["original", "translation"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["detected_language", "summary", "lines"],
    "additionalProperties": False,
}


class PhotoLine(BaseModel):
    original: str
    translation: str


class PhotoTranslation(BaseModel):
    detected_language: str
    summary: str
    lines: list[PhotoLine]


@dataclass
class Usage:
    model: str
    input_tokens: int
    output_tokens: int


def assistant_enabled() -> bool:
    return bool(secrets.get("anthropic_api_key"))


class AssistantClient:
    def __init__(self, client: anthropic.Anthropic | None = None):
        key = secrets.get("anthropic_api_key") if client is None else ""
        if client is None and not key:
            raise ProviderNotConfigured("The Anthropic API key is not set (admin page or ANTHROPIC_API_KEY).")
        self.client = client or anthropic.Anthropic(api_key=key, timeout=120.0)
        self.model = settings.ASSISTANT_MODEL

    def _create(self, *, system: str, messages: list, max_tokens: int, output_format: dict | None = None):
        output_config: dict = {"effort": settings.ASSISTANT_EFFORT}
        if output_format:
            output_config["format"] = output_format
        with anthropic_errors():
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",  # a declined request is retried server-side on a fallback model
                system=system,
                messages=messages,
                output_config=output_config,
            )
        if response.stop_reason == "refusal":
            raise ProviderRequestError("The assistant declined to answer this.")
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        usage = Usage(response.model, response.usage.input_tokens, response.usage.output_tokens)
        return response, text, usage

    def chat(self, messages: list[dict], language: str) -> tuple[str, Usage]:
        """messages: [{"role": "user"|"assistant", "content": str}], ending with the user's turn."""
        response, text, usage = self._create(
            system=CHAT_SYSTEM.replace("{language}", MEETING_LANGUAGES[language]),
            messages=messages,
            max_tokens=settings.ASSISTANT_MAX_TOKENS,
        )
        if not text:
            raise ProviderRequestError("The assistant returned an empty answer; please try again.")
        if response.stop_reason == "max_tokens":
            text += " …"
        return text, usage

    def read_image(self, data: bytes, media_type: str, language: str) -> tuple[PhotoTranslation, Usage]:
        image = {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(data).decode()}}
        response, text, usage = self._create(
            system=IMAGE_SYSTEM.replace("{language}", MEETING_LANGUAGES[language]),
            messages=[{"role": "user", "content": [image, {"type": "text", "text": "Read and translate the text in this image."}]}],
            max_tokens=settings.ASSISTANT_MAX_TOKENS * 2,
            output_format={"type": "json_schema", "schema": IMAGE_JSON_SCHEMA},
        )
        if response.stop_reason == "max_tokens":
            raise ProviderRequestError("The image has too much text to translate at once; crop it and try again.")
        try:
            return PhotoTranslation.model_validate(json.loads(text)), usage
        except (json.JSONDecodeError, ValidationError) as exc:
            raise ProviderRequestError("The AI returned the translation in an unexpected format.") from exc
