from django.conf import settings

from integrations import secrets

from ..errors import ProviderNotConfigured
from .base import Segment, Transcriber

ENGINES = ("gemini", "sarvam")


def get_transcriber(engine: str | None = None) -> Transcriber:
    engine = engine or settings.MEETING_STT_ENGINE
    if engine == "sarvam":
        from .sarvam import SarvamTranscriber

        return SarvamTranscriber()
    if engine == "gemini":
        from .gemini import GeminiTranscriber

        return GeminiTranscriber()
    raise ProviderNotConfigured(f"Unknown transcription engine {engine!r}")


def available_engines() -> dict[str, bool]:
    return {"gemini": bool(secrets.get("gemini_api_key")), "sarvam": bool(secrets.get("sarvam_api_key"))}


__all__ = ["ENGINES", "Segment", "Transcriber", "available_engines", "get_transcriber"]
