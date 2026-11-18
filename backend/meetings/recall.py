"""Recall: answer a question from the user's own past meetings, with the meeting and moment it came from.

Retrieval is plain database search (no embeddings service): the notes and open action items of the most recent
meetings, plus transcript lines that contain words from the question. The notes model (Gemini or Claude, per
SUMMARY_PROVIDER) answers only from that context and
must cite meeting numbers and segment numbers; citations that do not exist are dropped.
"""

from __future__ import annotations

import json
import re

import anthropic
import httpx
from django.conf import settings
from django.db.models import Q

from integrations import secrets

from .claude_errors import anthropic_errors
from .errors import ProviderNotConfigured, ProviderRequestError
from .gemini_client import gemini_key, generate_json
from .models import Meeting, TranscriptSegment

MAX_MEETINGS = 25
MAX_LINES = 40
STOP = {"the", "and", "what", "when", "who", "did", "was", "were", "about", "that", "this", "with", "have", "has", "for", "from", "our", "last", "week", "meeting", "said", "say", "tell", "me"}

SYSTEM = """You answer questions about the user's own past meetings. You are given numbered meetings (M1, M2, ...) with their notes and action items, and transcript lines written [M1#12] = meeting 1, segment 12.

Rules:
- Answer only from this material. If it does not contain the answer, say you could not find it in the meetings. Never guess.
- Name who said or promised something only when the material says so.
- Cite every claim with the meeting number and, when you used a transcript line, its segment number.
- Reply in the same language as the question. Keep the answer short and direct."""

SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "sources": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"meeting": {"type": "integer"}, "segment": {"anyOf": [{"type": "integer"}, {"type": "null"}]}},
                "required": ["meeting", "segment"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["answer", "sources"],
    "additionalProperties": False,
}


def _terms(question: str) -> list[str]:
    words = re.findall(r"[\w஀-௿ऀ-ॿ]{3,}", question.lower())
    return [w for w in dict.fromkeys(words) if w not in STOP][:8]


def build_context(user, question: str) -> tuple[str, dict[int, Meeting]]:
    meetings = list(Meeting.objects.filter(owner=user).exclude(status=Meeting.Status.DRAFT).order_by("-recorded_at")[:MAX_MEETINGS])
    numbered = {i + 1: m for i, m in enumerate(meetings)}
    by_id = {m.id: n for n, m in numbered.items()}
    parts: list[str] = []
    for n, m in numbered.items():
        parts.append(f"M{n}: \"{m.title}\" on {m.recorded_at:%d %b %Y}")
        if m.summary_text:
            parts.append(f"  Notes: {m.summary_text[:1500]}")
        for a in m.action_items.all()[:15]:
            extra = "".join([f", owner {a.owner_name}" if a.owner_name else "", f", deadline {a.deadline}" if a.deadline else "", " (done)" if a.done else " (open)"])
            parts.append(f"  Action: {a.text}{extra}")
    terms = _terms(question)
    if terms and by_id:
        q = Q()
        for t in terms:
            q |= Q(original_text__icontains=t) | Q(translated_text__icontains=t)
        lines = TranscriptSegment.objects.filter(meeting_id__in=by_id).filter(q).select_related("meeting").order_by("-meeting__recorded_at", "index")[:MAX_LINES]
        if lines:
            parts.append("\nTranscript lines:")
        for s in lines:
            who = f"{s.speaker}: " if s.speaker else ""
            parts.append(f"[M{by_id[s.meeting_id]}#{s.index}] {who}{s.original_text[:400]}")
    return "\n".join(parts), numbered


def _ask_claude(prompt: str, client: anthropic.Anthropic | None) -> tuple[dict, int, int]:
    key = secrets.get("anthropic_api_key") if client is None else ""
    if client is None and not key:
        raise ProviderNotConfigured("The Anthropic API key is not set (admin page or ANTHROPIC_API_KEY).")
    client = client or anthropic.Anthropic(api_key=key, timeout=120.0)
    with anthropic_errors():
        response = client.beta.messages.create(
            model=settings.SUMMARY_MODEL,
            max_tokens=2000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise ProviderRequestError("The AI could not answer that.")
    try:
        data = json.loads("".join(b.text for b in response.content if b.type == "text"))
    except json.JSONDecodeError as exc:
        raise ProviderRequestError("The AI returned an answer in an unexpected format.") from exc
    usage = getattr(response, "usage", None)
    return data, int(getattr(usage, "input_tokens", 0) or 0), int(getattr(usage, "output_tokens", 0) or 0)


def _ask_gemini(prompt: str, http: httpx.Client | None) -> tuple[dict, int, int]:
    key = gemini_key() if http is None else "injected-client"
    result = generate_json(
        http or httpx.Client(timeout=120.0), key, settings.SUMMARY_MODEL, [{"text": prompt}], json_schema=SCHEMA, system=SYSTEM, what="an answer"
    )
    return result.data, result.input_tokens, result.output_tokens


def ask(user, question: str, *, client: anthropic.Anthropic | None = None, http: httpx.Client | None = None) -> dict:
    """Uses the notes provider (SUMMARY_PROVIDER). `client` / `http` are injected by tests."""
    question = question.strip()
    if not question:
        raise ProviderRequestError("Ask a question.")
    context, numbered = build_context(user, question)
    if not numbered:
        return {"answer": "There are no meetings to search yet.", "sources": [], "input_tokens": 0, "output_tokens": 0}
    prompt = f"{context}\n\nQuestion: {question}"
    if settings.SUMMARY_PROVIDER == "gemini" and client is None:
        data, tokens_in, tokens_out = _ask_gemini(prompt, http)
    else:
        data, tokens_in, tokens_out = _ask_claude(prompt, client)
    try:
        answer = str(data["answer"]).strip()
        raw_sources = data["sources"]
    except (KeyError, TypeError) as exc:
        raise ProviderRequestError("The AI returned an answer in an unexpected format.") from exc
    sources, seen = [], set()
    for s in raw_sources:
        meeting = numbered.get(s.get("meeting")) if isinstance(s, dict) else None
        if meeting is None:
            continue
        seg = s.get("segment")
        start_ms = None
        if isinstance(seg, int):
            row = meeting.segments.filter(index=seg).first()
            if row is None:
                seg = None
            else:
                start_ms = row.start_ms
        key2 = (meeting.id, seg)
        if key2 in seen:
            continue
        seen.add(key2)
        sources.append({"meeting_id": str(meeting.id), "title": meeting.title, "recorded_at": meeting.recorded_at.isoformat(), "segment": seg, "start_ms": start_ms})
    return {"answer": answer, "sources": sources, "input_tokens": tokens_in, "output_tokens": tokens_out}
