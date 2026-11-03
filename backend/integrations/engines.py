"""Routes each AI job (translate / speech-to-text / text-to-speech) to Sarvam (cloud, paid) or the local
open-source service (free), per TRANSLATE_ENGINE / STT_ENGINE / TTS_ENGINE (all default to AI_ENGINE).
"""

from __future__ import annotations

from django.conf import settings

from meetings.errors import ProviderNotConfigured

from . import local_ai, secrets

ENGINES = ("sarvam", "local")


def engine_for(kind: str) -> str:
    engine = {"translate": settings.TRANSLATE_ENGINE, "stt": settings.STT_ENGINE, "tts": settings.TTS_ENGINE}[kind]
    if engine not in ENGINES:
        raise ProviderNotConfigured(f"Unknown {kind} engine {engine!r} (use sarvam or local).")
    return engine


class Engines:
    """Same methods as SarvamClient; each call goes to the engine configured for that job."""

    def __init__(self, *, translate: str | None = None, stt: str | None = None, tts: str | None = None, clients: dict | None = None):
        self.names = {"translate": translate or engine_for("translate"), "stt": stt or engine_for("stt"), "tts": tts or engine_for("tts")}
        self._clients = dict(clients or {})

    def _client(self, kind: str):
        name = self.names[kind]
        if name not in self._clients:
            if name == "local":
                self._clients[name] = local_ai.LocalAIClient()
            else:
                from meetings.sarvam_client import SarvamClient

                self._clients[name] = SarvamClient(min_interval=0)
        return self._clients[name]

    def billed(self, kind: str) -> bool:
        """Only Sarvam calls cost money and count against the daily AI budget."""
        return self.names[kind] == "sarvam"

    def translate(self, text: str, source: str, target: str) -> str:
        return self._client("translate").translate(text, source, target)

    def speech_to_text(self, wav: bytes, language: str | None):
        return self._client("stt").speech_to_text(wav, language)

    def text_to_speech(self, text: str, language: str, speaker: str | None = None) -> list[bytes]:
        if self.names["tts"] == "local":
            speaker = None  # Sarvam voice names do not apply; the local service picks its recommended voice
        return self._client("tts").text_to_speech(text, language, speaker)


def capabilities() -> dict:
    """What each job runs on and whether it is ready, for the apps and the admin page."""
    health = local_ai.health()
    sarvam_ready = bool(secrets.get("sarvam_api_key"))

    def local_ready(key: str) -> bool:
        part = (health or {}).get(key) or {}
        # Gated models must already be downloaded; Whisper downloads itself on first use.
        return bool(part.get("installed")) and all((part.get("models") or {}).values())

    out = {}
    for kind, key in (("translate", "translate"), ("stt", "stt"), ("tts", "tts")):
        engine = engine_for(kind)
        ready = sarvam_ready if engine == "sarvam" else local_ready(key)
        entry = {"engine": engine, "ready": ready}
        if engine == "local" and health:
            entry["languages"] = (health.get(key) or {}).get("languages", [])
        out[kind] = entry
    out["local_service"] = {"configured": local_ai.configured(), "running": health is not None, "loaded": (health or {}).get("loaded", [])}
    if health:
        out["local_service"].update({k: health.get(k) for k in ("translate", "stt", "tts")})
    return out
