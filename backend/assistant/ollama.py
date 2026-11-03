"""Local assistant through Ollama (free, runs on this server): chat with a text model (Qwen3 Instruct) and photo
translation with a vision model (Qwen3-VL Instruct). Use instruct builds: "thinking" builds ignore
`think: false` and write long reasoning first, which takes minutes on a CPU. Same methods and results as claude.AssistantClient.

Small local models are weaker than Claude: translations can be less accurate, and reading Tamil/Hindi text in
photos depends on the vision model — test with real photos before offering it to users.
"""

from __future__ import annotations

import base64
import json
import re

import httpx
from django.conf import settings
from pydantic import ValidationError

from meetings.errors import ProviderNotConfigured, ProviderRequestError, ProviderUnavailable
from meetings.languages import MEETING_LANGUAGES

from .claude import CHAT_SYSTEM, IMAGE_JSON_SCHEMA, IMAGE_SYSTEM, PhotoTranslation, Usage

# Ollama decodes these formats; WebP is refused before calling it.
LOCAL_IMAGE_TYPES = {"image/jpeg", "image/png"}
_THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


class OllamaAssistantClient:
    def __init__(self, http: httpx.Client | None = None):
        self.chat_model = settings.ASSISTANT_OLLAMA_MODEL
        self.vision_model = settings.ASSISTANT_VISION_MODEL
        self.http = http or httpx.Client(base_url=settings.OLLAMA_URL.rstrip("/"), timeout=settings.OLLAMA_TIMEOUT_SECONDS)

    def _chat(self, model: str, messages: list[dict], fmt: dict | None = None, max_tokens: int | None = None) -> tuple[str, Usage]:
        body: dict = {"model": model, "stream": False, "think": False, "messages": messages, "options": {"temperature": 0.2}}
        if fmt:
            body["format"] = fmt
        if max_tokens:
            body["options"]["num_predict"] = max_tokens
        try:
            resp = self.http.post("/api/chat", json=body)
        except httpx.TimeoutException as exc:
            raise ProviderUnavailable("The local assistant took too long to answer.") from exc
        except httpx.HTTPError as exc:
            raise ProviderUnavailable("Ollama is not running. Start it, or set ASSISTANT_PROVIDER=anthropic.") from exc
        if resp.status_code == 404:
            raise ProviderNotConfigured(f"The local model {model!r} is not installed. Run: ollama pull {model}")
        if resp.status_code >= 400:
            raise ProviderRequestError(f"Ollama rejected the request ({resp.status_code}).")
        data = resp.json()
        text = _THINK.sub("", (data.get("message") or {}).get("content", "")).strip()
        usage = Usage(f"ollama:{model}", int(data.get("prompt_eval_count") or 0), int(data.get("eval_count") or 0))
        if data.get("done_reason") == "length" and not fmt:
            text += " …"
        return text, usage

    def chat(self, messages: list[dict], language: str) -> tuple[str, Usage]:
        system = {"role": "system", "content": CHAT_SYSTEM.replace("{language}", MEETING_LANGUAGES[language])}
        text, usage = self._chat(self.chat_model, [system, *messages], max_tokens=settings.ASSISTANT_OLLAMA_MAX_TOKENS)
        if not text:
            raise ProviderRequestError("The assistant returned an empty answer; please try again.")
        return text, usage

    def read_image(self, data: bytes, media_type: str, language: str) -> tuple[PhotoTranslation, Usage]:
        if media_type not in LOCAL_IMAGE_TYPES:
            raise ProviderRequestError("Use a JPEG or PNG image.")
        messages = [
            {"role": "system", "content": IMAGE_SYSTEM.replace("{language}", MEETING_LANGUAGES[language])},
            {"role": "user", "content": "Read and translate the text in this image.", "images": [base64.b64encode(data).decode()]},
        ]
        text, usage = self._chat(self.vision_model, messages, fmt=IMAGE_JSON_SCHEMA, max_tokens=settings.ASSISTANT_OLLAMA_MAX_TOKENS * 3)
        try:
            return PhotoTranslation.model_validate(json.loads(text)), usage
        except (json.JSONDecodeError, ValidationError) as exc:
            raise ProviderRequestError("The local model could not read this image. Try a clearer, closer photo.") from exc
