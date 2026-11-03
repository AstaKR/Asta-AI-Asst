"""Text-level echo guard.

Browsers' acoustic echo cancellation removes most of the translated audio a listener's speakers play
back into their microphone, but not always (laptop speakers, no headphones). If it leaks, the
listener's STT would transcribe the *translated* speech and translate it straight back.

We remember what was recently spoken TO each listener (in the listener's language). A transcript
from that same person that closely matches it within a short window is treated as echo and dropped.
"""

from __future__ import annotations

import re
import time
import unicodedata
from collections import deque
from difflib import SequenceMatcher

_PUNCT = re.compile(r"[\W_]+", re.UNICODE)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).lower()
    return _PUNCT.sub(" ", text).strip()


class EchoGuard:
    def __init__(self, window_s: float = 12.0, similarity: float = 0.75, clock=time.monotonic):
        self.window_s = window_s
        self.similarity = similarity
        self._clock = clock
        self._played: dict[str, deque[tuple[float, str]]] = {}

    def record_played(self, listener: str, text: str) -> None:
        norm = normalize(text)
        if norm:
            self._played.setdefault(listener, deque(maxlen=8)).append((self._clock(), norm))

    def is_echo(self, speaker: str, transcript: str) -> bool:
        """`speaker` is a person whose speakers recently played translated audio."""
        norm = normalize(transcript)
        if not norm:
            return False
        now = self._clock()
        history = self._played.get(speaker)
        if not history:
            return False
        while history and now - history[0][0] > self.window_s:
            history.popleft()
        for _, played in history:
            if norm in played:
                return True
            if SequenceMatcher(None, norm, played).ratio() >= self.similarity:
                return True
        return False
