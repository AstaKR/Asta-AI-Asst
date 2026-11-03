from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from .schema import MeetingNotes

LANGUAGE_NAMES = {"ta": "Tamil", "en": "English", "hi": "Hindi"}

SYSTEM_PROMPT = """You write meeting notes from a transcript. The transcript may mix Tamil, Hindi and English.

Rules:
- Use only what the transcript says. Do not add facts, names, numbers, dates or commitments.
- Every key point, decision, action item and open question must list the transcript segment numbers [n] that support it.
- A decision is something the participants explicitly agreed or decided. If nothing was decided, return an empty list.
- For an action item, set "owner" only if the transcript explicitly names who will do it, and copy the exact words naming them into "owner_quote" (in the transcript's own language and script). Otherwise both are null.
- Set "deadline" only if a deadline is explicitly stated, and copy the exact words into "deadline_quote". Otherwise both are null.
- Open questions are questions raised and not answered, or follow-ups the participants said they still need.
- Write the summary and every item text in {language}. Keep the summary to 2-4 sentences."""


@dataclass
class TranscriptLine:
    index: int
    start_ms: int
    speaker: str
    text: str
    translation: str


def render_transcript(title: str, lines: list[TranscriptLine]) -> str:
    out = [f"Meeting title: {title}", "", "Transcript:"]
    for line in lines:
        mm, ss = divmod(line.start_ms // 1000, 60)
        who = f" {line.speaker}:" if line.speaker else ""
        extra = f" (translation: {line.translation})" if line.translation and line.translation != line.text else ""
        out.append(f"[{line.index}] ({mm:02d}:{ss:02d}){who} {line.text}{extra}")
    return "\n".join(out)


class SummaryProvider(ABC):
    name = "base"
    model = ""

    @abstractmethod
    def summarize(self, title: str, lines: list[TranscriptLine], language: str) -> MeetingNotes:
        """Returns schema-validated notes (grounding is applied by the caller)."""
