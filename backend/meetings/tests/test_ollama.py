import json

import httpx
import pytest

from meetings.errors import ProviderNotConfigured, ProviderRequestError, ProviderUnavailable
from meetings.summary import get_summarizer, summaries_enabled
from meetings.summary.base import TranscriptLine
from meetings.summary.ollama_provider import OllamaSummaryProvider
from meetings.summary.schema import NOTES_JSON_SCHEMA

NOTES = {
    "summary": "Ravi will send the report.",
    "key_points": [{"text": "Report due Friday", "segments": [0]}],
    "decisions": [],
    "action_items": [{"text": "Send the report", "owner": "Ravi", "owner_quote": "Ravi", "deadline": "Friday", "deadline_quote": "by Friday", "segments": [0]}],
    "open_questions": [],
}
LINES = [TranscriptLine(index=0, start_ms=0, speaker="", text="Ravi will send the report by Friday", translation="")]


def provider(handler, settings) -> OllamaSummaryProvider:
    settings.OLLAMA_MODEL = "qwen3:4b"
    return OllamaSummaryProvider(http=httpx.Client(base_url="http://ollama", transport=httpx.MockTransport(handler)))


def test_structured_notes_request(settings):
    seen = []

    def handler(req: httpx.Request):
        seen.append(json.loads(req.content))
        return httpx.Response(200, json={"message": {"role": "assistant", "content": json.dumps(NOTES)}})

    notes = provider(handler, settings).summarize("Weekly sync", LINES, "ta")
    assert notes.action_items[0].owner == "Ravi"
    body = seen[0]
    assert body["model"] == "qwen3:4b" and body["stream"] is False and body["format"] == NOTES_JSON_SCHEMA
    assert "Tamil" in body["messages"][0]["content"] and "[0]" in body["messages"][1]["content"]


@pytest.mark.parametrize(
    "response, error",
    [
        (httpx.Response(404, json={"error": "model not found"}), ProviderNotConfigured),
        (httpx.Response(200, json={"message": {"content": "not json"}}), ProviderRequestError),
        (httpx.Response(200, json={"message": {"content": json.dumps({"summary": "x"})}}), ProviderRequestError),
        (httpx.Response(500, text="boom"), ProviderRequestError),
    ],
)
def test_errors(settings, response, error):
    with pytest.raises(error):
        provider(lambda req: response, settings).summarize("t", LINES, "en")


def test_not_running(settings):
    def down(req):
        raise httpx.ConnectError("refused")

    with pytest.raises(ProviderUnavailable, match="Ollama is not running"):
        provider(down, settings).summarize("t", LINES, "en")


def test_selected_by_setting(settings):
    settings.SUMMARY_PROVIDER = "ollama"
    assert summaries_enabled() and isinstance(get_summarizer(), OllamaSummaryProvider)
