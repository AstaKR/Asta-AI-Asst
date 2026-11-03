"""Service configuration from environment variables (.env at repo root)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:  # optional: the service also runs with plain environment variables
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # pragma: no cover
    pass


def _list(name: str, default: str) -> frozenset[str]:
    return frozenset(x.strip() for x in os.environ.get(name, default).split(",") if x.strip())


@dataclass(frozen=True)
class LocalAIConfig:
    host: str = "127.0.0.1"
    port: int = 8090
    secret: str = ""  # sent by clients as X-Local-AI-Secret; required when set
    # IndicTrans2 distilled checkpoints (MIT). Hindi<->Tamil uses the Indic-Indic model, or pivots
    # through English ("pivot") to save ~1.4 GB of RAM at some cost in quality.
    mt_en_indic: str = "ai4bharat/indictrans2-en-indic-dist-200M"
    mt_indic_en: str = "ai4bharat/indictrans2-indic-en-dist-200M"
    mt_indic_indic: str = "ai4bharat/indictrans2-indic-indic-dist-320M"
    mt_indic_indic_mode: str = "direct"  # direct | pivot
    mt_beams: int = 1  # model card uses 5; 1 (greedy) is several times faster on a CPU
    whisper_model: str = "small"  # meetings and uploads: accuracy first
    whisper_fast_model: str = "base"  # live turns (?fast=1): ~3x faster on a laptop CPU, weaker Tamil
    whisper_threads: int = 0  # 0 = library default
    whisper_compute_type: str = "int8"
    tts_model: str = "ai4bharat/indic-parler-tts"
    tts_dtype: str = "float32"  # float32 | bfloat16 (half the RAM; speed depends on the CPU)
    tts_languages: frozenset[str] = frozenset({"ta", "hi", "en"})
    memory_budget_gb: float = 5.5  # least-recently-used models are unloaded beyond this
    torch_threads: int = 0  # 0 = library default
    max_text_chars: int = 5000
    max_tts_chars: int = 1000
    max_audio_seconds: int = 900
    max_body_mb: int = 40


def load_config() -> LocalAIConfig:
    env = os.environ.get
    return LocalAIConfig(
        host=env("LOCAL_AI_HOST", "127.0.0.1"),
        port=int(env("LOCAL_AI_PORT", "8090")),
        secret=env("LOCAL_AI_SECRET", "").strip(),
        mt_en_indic=env("LOCAL_MT_EN_INDIC_MODEL", LocalAIConfig.mt_en_indic),
        mt_indic_en=env("LOCAL_MT_INDIC_EN_MODEL", LocalAIConfig.mt_indic_en),
        mt_indic_indic=env("LOCAL_MT_INDIC_INDIC_MODEL", LocalAIConfig.mt_indic_indic),
        mt_indic_indic_mode=env("LOCAL_MT_INDIC_INDIC_MODE", "direct"),
        mt_beams=int(env("LOCAL_MT_BEAMS", "1")),
        whisper_model=env("LOCAL_WHISPER_MODEL", "small"),
        whisper_fast_model=env("LOCAL_WHISPER_FAST_MODEL", "base"),
        whisper_threads=int(env("LOCAL_WHISPER_THREADS", "0")),
        whisper_compute_type=env("LOCAL_WHISPER_COMPUTE_TYPE", "int8"),
        tts_model=env("LOCAL_TTS_MODEL", LocalAIConfig.tts_model),
        tts_dtype=env("LOCAL_TTS_DTYPE", "float32"),
        tts_languages=_list("LOCAL_TTS_LANGUAGES", "ta,hi,en"),
        memory_budget_gb=float(env("LOCAL_AI_MEMORY_BUDGET_GB", "5.5")),
        torch_threads=int(env("LOCAL_AI_TORCH_THREADS", "0")),
        max_text_chars=int(env("LOCAL_AI_MAX_TEXT_CHARS", "5000")),
        max_tts_chars=int(env("LOCAL_AI_MAX_TTS_CHARS", "1000")),
        max_audio_seconds=int(env("LOCAL_AI_MAX_AUDIO_SECONDS", "900")),
        max_body_mb=int(env("LOCAL_AI_MAX_BODY_MB", "40")),
    )
