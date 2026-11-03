"""Meeting-notes schema and evidence grounding.

The model must cite transcript segment numbers for every item and quote the exact words that name an
owner or a deadline. `ground()` then drops anything without valid evidence, so decisions, owners and
deadlines can never be invented: an unsupported owner/deadline is blanked, an uncited item removed.
"""

from __future__ import annotations

import re
import unicodedata

from pydantic import BaseModel, Field, ValidationError  # noqa: F401  (re-exported for callers)


class Point(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    segments: list[int]


class Action(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    owner: str | None = None
    owner_quote: str | None = None
    deadline: str | None = None
    deadline_quote: str | None = None
    segments: list[int]


class MeetingNotes(BaseModel):
    summary: str = Field(min_length=1, max_length=2000)
    key_points: list[Point]
    decisions: list[Point]
    action_items: list[Action]
    open_questions: list[Point]


_NULLABLE_STR = {"anyOf": [{"type": "string"}, {"type": "null"}]}
_POINT = {
    "type": "object",
    "properties": {"text": {"type": "string"}, "segments": {"type": "array", "items": {"type": "integer"}}},
    "required": ["text", "segments"],
    "additionalProperties": False,
}

# JSON schema sent to the model (structured outputs). Kept in step with MeetingNotes above.
NOTES_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "key_points": {"type": "array", "items": _POINT},
        "decisions": {"type": "array", "items": _POINT},
        "action_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "owner": _NULLABLE_STR,
                    "owner_quote": _NULLABLE_STR,
                    "deadline": _NULLABLE_STR,
                    "deadline_quote": _NULLABLE_STR,
                    "segments": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["text", "owner", "owner_quote", "deadline", "deadline_quote", "segments"],
                "additionalProperties": False,
            },
        },
        "open_questions": {"type": "array", "items": _POINT},
    },
    "required": ["summary", "key_points", "decisions", "action_items", "open_questions"],
    "additionalProperties": False,
}

_WS = re.compile(r"\s+")


def _norm(text: str) -> str:
    return _WS.sub(" ", unicodedata.normalize("NFC", text or "")).strip().casefold()


def _quote_supported(quote: str | None, segment_texts: list[str]) -> bool:
    q = _norm(quote or "")
    return bool(q) and any(q in _norm(t) for t in segment_texts)


def ground(notes: MeetingNotes, segments: dict[int, tuple[str, str]]) -> dict:
    """segments: index -> (original_text, translated_text). Returns the cleaned dict to store."""

    def valid_refs(refs: list[int]) -> list[int]:
        return sorted({r for r in refs if r in segments})

    def points(items: list[Point]) -> list[dict]:
        out = []
        for p in items:
            refs = valid_refs(p.segments)
            if refs:  # an item with no evidence in the transcript is dropped
                out.append({"text": p.text.strip(), "segments": refs})
        return out

    actions = []
    for a in notes.action_items:
        refs = valid_refs(a.segments)
        if not refs:
            continue
        texts = [t for r in refs for t in segments[r] if t]
        owner = a.owner.strip() if a.owner and _quote_supported(a.owner_quote, texts) else None
        deadline = a.deadline.strip() if a.deadline and _quote_supported(a.deadline_quote, texts) else None
        actions.append({"text": a.text.strip(), "owner": owner, "deadline": deadline, "segments": refs})

    return {
        "summary": notes.summary.strip(),
        "key_points": points(notes.key_points),
        "decisions": points(notes.decisions),
        "action_items": actions,
        "open_questions": points(notes.open_questions),
    }
