from django.conf import settings

from integrations import local_ai, secrets

from ..errors import ProviderNotConfigured
from .base import Segment, Transcriber

ENGINES = ("sarvam", "local")


def get_transcriber(engine: str | None = None) -> Transcriber:
    engine = engine or settings.MEETING_STT_ENGINE
    if engine == "sarvam":
        from .sarvam import SarvamTranscriber

        return SarvamTranscriber()
    if engine == "local":
        if local_ai.configured():  # the shared local AI service (models loaded once, own virtualenv)
            from .local_service import LocalServiceTranscriber

            return LocalServiceTranscriber()
        from .local_whisper import LocalWhisperTranscriber  # in-process fallback

        return LocalWhisperTranscriber()
    raise ProviderNotConfigured(f"Unknown transcription engine {engine!r}")


def available_engines() -> dict[str, bool]:
    if local_ai.configured():
        local = bool(((local_ai.health() or {}).get("stt") or {}).get("installed"))
    else:
        try:
            import faster_whisper  # noqa: F401

            local = True
        except ImportError:
            local = False
    return {"sarvam": bool(secrets.get("sarvam_api_key")), "local": local}


__all__ = ["ENGINES", "Segment", "Transcriber", "available_engines", "get_transcriber"]
