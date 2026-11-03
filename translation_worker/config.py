"""Worker configuration from environment variables (.env at repo root)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


@dataclass(frozen=True)
class SarvamConfig:
    api_key: str
    stt_api: str = "realtime"  # realtime | legacy
    stt_model: str = "saaras:v3-realtime"
    stt_stream_type: str = "balanced"
    stt_silence_ms: int = 500
    translate_model: str = "mayura:v1"
    translate_mode: str = ""  # empty = provider default
    tts_model: str = "bulbul:v3"
    tts_mode: str = "rest"  # rest | stream
    tts_sample_rate: int = 24000
    default_speaker: str = "shubh"
    timeout: float = 10.0
    base_url: str = "https://api.sarvam.ai"
    ws_base_url: str = "wss://api.sarvam.ai"


@dataclass(frozen=True)
class LocalAIConfig:
    """SPEECH_PROVIDER=local: the free open-source models of the local AI service (local_ai/)."""

    url: str = ""
    secret: str = ""
    timeout: float = 120.0
    vad_threshold_dbfs: float = -42.0  # louder than this counts as speech
    end_silence_ms: int = 700  # this much silence ends an utterance
    max_utterance_seconds: float = 15.0
    min_utterance_ms: int = 300


@dataclass(frozen=True)
class WorkerConfig:
    agent_name: str
    translation_enabled: bool
    provider: str
    backend_url: str
    worker_secret: str
    report_interval_s: float
    local_gate: bool
    gate_threshold_dbfs: float
    interrupt_on_listener_speech: bool
    max_pending_utterances: int
    echo_guard_window_s: float
    echo_guard_similarity: float
    phone_default_language: str
    phone_announcement: bool
    sarvam: SarvamConfig
    local: LocalAIConfig = LocalAIConfig()


def load_config() -> WorkerConfig:
    return WorkerConfig(
        agent_name=os.environ.get("AGENT_NAME", "call-translator"),
        translation_enabled=_bool("TRANSLATION_ENABLED", True),
        provider=os.environ.get("SPEECH_PROVIDER", "sarvam"),
        backend_url=os.environ.get("BACKEND_INTERNAL_URL", "http://127.0.0.1:8000").rstrip("/"),
        worker_secret=os.environ.get("WORKER_SHARED_SECRET", ""),
        report_interval_s=_float("USAGE_REPORT_INTERVAL_SECONDS", 15),
        local_gate=_bool("LOCAL_SPEECH_GATE", True),
        gate_threshold_dbfs=_float("LOCAL_SPEECH_GATE_DBFS", -45),
        interrupt_on_listener_speech=_bool("INTERRUPT_ON_LISTENER_SPEECH", False),
        max_pending_utterances=_int("MAX_PENDING_UTTERANCES", 2),
        echo_guard_window_s=_float("ECHO_GUARD_WINDOW_SECONDS", 12),
        echo_guard_similarity=_float("ECHO_GUARD_SIMILARITY", 0.75),
        phone_default_language=os.environ.get("PHONE_DEFAULT_LANGUAGE", "hi-IN"),
        phone_announcement=_bool("PHONE_ANNOUNCEMENT", True),
        sarvam=SarvamConfig(
            api_key=os.environ.get("SARVAM_API_KEY", "").strip(),
            stt_api=os.environ.get("SARVAM_STT_API", "realtime"),
            stt_model=os.environ.get("SARVAM_STT_MODEL", "saaras:v3-realtime"),
            stt_stream_type=os.environ.get("SARVAM_STT_STREAM_TYPE", "balanced"),
            stt_silence_ms=_int("SARVAM_STT_SILENCE_MS", 500),
            translate_model=os.environ.get("SARVAM_TRANSLATE_MODEL", "mayura:v1"),
            translate_mode=os.environ.get("SARVAM_TRANSLATE_MODE", ""),
            tts_model=os.environ.get("SARVAM_TTS_MODEL", "bulbul:v3"),
            tts_mode=os.environ.get("SARVAM_TTS_MODE", "rest"),
            tts_sample_rate=_int("SARVAM_TTS_SAMPLE_RATE", 24000),
            default_speaker=os.environ.get("SARVAM_DEFAULT_SPEAKER", "shubh"),
            timeout=_float("PROVIDER_TIMEOUT_SECONDS", 10),
        ),
        local=LocalAIConfig(
            url=os.environ.get("LOCAL_AI_URL", "").strip(),
            secret=os.environ.get("LOCAL_AI_SECRET", "").strip(),
            timeout=_float("LOCAL_AI_LIVE_TIMEOUT_SECONDS", 120),
            vad_threshold_dbfs=_float("LOCAL_VAD_THRESHOLD_DBFS", -42),
            end_silence_ms=_int("LOCAL_END_SILENCE_MS", 700),
            max_utterance_seconds=_float("LOCAL_MAX_UTTERANCE_SECONDS", 15),
        ),
    )


# Played to phone-line callers before translation starts (AI-processing notice).
# Native-speaker review recommended before production use.
PHONE_ANNOUNCEMENTS = {
    "hi-IN": "नमस्ते। यह कॉल एआई अनुवाद की मदद से हो रही है। कृपया बोलने के बाद थोड़ा रुकें।",
    "ta-IN": "வணக்கம். இந்த அழைப்பு செயற்கை நுண்ணறிவு மொழிபெயர்ப்பு உதவியுடன் நடைபெறுகிறது. பேசிய பிறகு சற்று நிறுத்துங்கள்.",
    "en-IN": "Hello. This call uses AI translation. Please pause briefly after you speak.",
}


async def with_backend_keys(cfg: WorkerConfig, http=None) -> WorkerConfig:
    """Use the Sarvam key an admin set in the web app (GET /api/internal/provider-keys/), else the env key.

    Fetched per call so a changed key applies to the next call without restarting the worker.
    """
    import dataclasses
    import logging

    import httpx

    if not cfg.worker_secret:
        return cfg
    try:
        client = http or httpx.AsyncClient(base_url=cfg.backend_url, timeout=3.0)
        try:
            resp = await client.get("/api/internal/provider-keys/", headers={"X-Worker-Secret": cfg.worker_secret})
        finally:
            if http is None:
                await client.aclose()
        key = (resp.json().get("sarvam_api_key") or "").strip() if resp.status_code == 200 else ""
    except Exception as exc:  # backend unreachable: keep the env key
        logging.getLogger(__name__).warning("could not fetch provider keys from backend: %s", exc.__class__.__name__)
        return cfg
    if not key or key == cfg.sarvam.api_key:
        return cfg
    return dataclasses.replace(cfg, sarvam=dataclasses.replace(cfg.sarvam, api_key=key))
