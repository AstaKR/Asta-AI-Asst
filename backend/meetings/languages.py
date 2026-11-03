"""Meeting features use short language codes (ta, en, hi); providers use BCP-47 (ta-IN, ...)."""

MEETING_LANGUAGES = {"ta": "Tamil", "en": "English", "hi": "Hindi"}
AUTO = "auto"

_TO_BCP47 = {"ta": "ta-IN", "en": "en-IN", "hi": "hi-IN"}
_FROM_BCP47 = {v: k for k, v in _TO_BCP47.items()}


def to_bcp47(code: str) -> str:
    return _TO_BCP47[code]


def from_bcp47(code: str | None) -> str | None:
    """'ta-IN' -> 'ta'; also accepts short codes. Unknown/None -> None."""
    if not code:
        return None
    if code in MEETING_LANGUAGES:
        return code
    return _FROM_BCP47.get(code)
