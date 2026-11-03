"""Language codes and sentence splitting that keeps paragraph structure."""

from __future__ import annotations

import re

LANGUAGES = {"ta": "Tamil", "hi": "Hindi", "en": "English"}
# IndicTrans2 (FLORES-200) codes
FLORES = {"ta": "tam_Taml", "hi": "hin_Deva", "en": "eng_Latn"}

# Split after sentence-final punctuation (incl. Devanagari danda) followed by whitespace.
_SENTENCE_END = re.compile(r"(?<=[.!?।॥])\s+")
_SOFT_BREAK = re.compile(r"(?<=[,;:])\s+")


def normalize_language(code: str | None) -> str | None:
    """'ta-IN' / 'ta' -> 'ta'. Unknown -> None."""
    if not code:
        return None
    short = code.split("-")[0].lower()
    return short if short in LANGUAGES else None


def split_sentences(paragraph: str, max_chars: int = 400) -> list[str]:
    """Sentences of one paragraph; over-long sentences are split at commas, then at spaces."""
    out: list[str] = []
    for sentence in _SENTENCE_END.split(paragraph.strip()):
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= max_chars:
            out.append(sentence)
            continue
        piece = ""
        for part in _SOFT_BREAK.split(sentence):
            for word in part.split(" ") if len(part) > max_chars else [part]:
                if piece and len(piece) + 1 + len(word) > max_chars:
                    out.append(piece)
                    piece = word
                else:
                    piece = f"{piece} {word}" if piece else word
        if piece:
            out.append(piece)
    return out


def paragraphs(text: str) -> list[str]:
    """Lines of the text; blank lines are kept as '' so the layout can be rebuilt."""
    return [line.strip() for line in text.replace("\r\n", "\n").split("\n")]
