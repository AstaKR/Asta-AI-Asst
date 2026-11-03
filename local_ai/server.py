"""HTTP API of the local AI service. Binds to 127.0.0.1 by default; set LOCAL_AI_SECRET when it is
reachable from other machines.

  GET  /health          capabilities: which engines are installed, downloaded and loaded
  POST /v1/translate    {"text", "source", "target"} -> {"translation"}
  POST /v1/transcribe   WAV body (mono 16-bit 16 kHz), ?language=ta|hi|en&fast=1 -> {"segments", "language", ...}
  POST /v1/tts          {"text", "language", "speaker"?} -> WAV body

Models are CPU-bound, so each request runs in a worker thread and each engine handles one request
at a time. Nothing sent to the service is stored.
"""

from __future__ import annotations

import asyncio
import hmac
import io
import logging
import time
import wave

from aiohttp import web

from .config import LocalAIConfig, load_config
from .registry import ModelRegistry, ModelUnavailable
from .text import LANGUAGES, normalize_language

log = logging.getLogger("local_ai")
ENGINES = web.AppKey("engines", dict)
CONFIG = web.AppKey("config", LocalAIConfig)


def _error(status: int, detail: str, code: str) -> web.Response:
    return web.json_response({"detail": detail, "code": code}, status=status)


@web.middleware
async def auth_and_errors(request: web.Request, handler):
    cfg = request.app[CONFIG]
    if cfg.secret and not hmac.compare_digest(request.headers.get("X-Local-AI-Secret", ""), cfg.secret):
        return _error(401, "Missing or wrong X-Local-AI-Secret.", "unauthorized")
    try:
        return await handler(request)
    except ModelUnavailable as exc:
        return _error(503, str(exc), "model_unavailable")
    except web.HTTPException:
        raise
    except Exception:
        log.exception("local AI request failed: %s", request.path)
        return _error(500, "The local AI engine failed. See the service log.", "engine_error")


async def _in_thread(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


async def health(request: web.Request) -> web.Response:
    engines = request.app[ENGINES]
    registry: ModelRegistry = engines["registry"]
    return web.json_response(
        {
            "status": "ok",
            "languages": LANGUAGES,
            "translate": engines["translate"].status(),
            "stt": engines["stt"].status(),
            "tts": engines["tts"].status(),
            "loaded": registry.loaded(),
            "memory_budget_gb": registry.budget_gb,
        }
    )


async def _json(request: web.Request) -> dict:
    try:
        data = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text='{"detail": "Body must be JSON.", "code": "invalid"}', content_type="application/json")
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(text='{"detail": "Body must be a JSON object.", "code": "invalid"}', content_type="application/json")
    return data


async def translate(request: web.Request) -> web.Response:
    cfg = request.app[CONFIG]
    data = await _json(request)
    text = str(data.get("text") or "")
    source, target = normalize_language(data.get("source")), normalize_language(data.get("target"))
    if not source or not target:
        return _error(400, f"source and target must be one of: {', '.join(LANGUAGES)}.", "unsupported_language")
    if not text.strip():
        return _error(400, "Text is empty.", "empty")
    if len(text) > cfg.max_text_chars:
        return _error(413, f"Text is longer than {cfg.max_text_chars} characters.", "too_long")
    started = time.perf_counter()
    translation = await _in_thread(request.app[ENGINES]["translate"].translate, text, source, target)
    return web.json_response(
        {"translation": translation, "source": source, "target": target, "seconds": round(time.perf_counter() - started, 3)}
    )


def _read_wav(body: bytes) -> bytes:
    """Mono 16-bit 16 kHz PCM from a WAV body; anything else is rejected (clients convert first)."""
    try:
        with wave.open(io.BytesIO(body)) as w:
            if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, 16000):
                raise ValueError("WAV must be mono, 16-bit, 16 kHz.")
            return w.readframes(w.getnframes())
    except (wave.Error, EOFError) as exc:
        raise ValueError("The body is not a valid WAV file.") from exc


async def transcribe(request: web.Request) -> web.Response:
    cfg = request.app[CONFIG]
    language = request.query.get("language") or None
    if language and not normalize_language(language):
        return _error(400, f"language must be one of: {', '.join(LANGUAGES)}.", "unsupported_language")
    try:
        pcm = _read_wav(await request.read())
    except ValueError as exc:
        return _error(400, str(exc), "invalid_audio")
    seconds = len(pcm) / 2 / 16000
    if seconds < 0.1:
        return _error(400, "The audio is empty.", "empty")
    if seconds > cfg.max_audio_seconds:
        return _error(413, f"Audio is longer than {cfg.max_audio_seconds} seconds.", "too_long")
    started = time.perf_counter()
    fast = request.query.get("fast") in ("1", "true")
    result = await _in_thread(request.app[ENGINES]["stt"].transcribe, pcm, normalize_language(language), fast)
    result["seconds"] = round(time.perf_counter() - started, 3)
    return web.json_response(result)


async def tts(request: web.Request) -> web.Response:
    cfg = request.app[CONFIG]
    data = await _json(request)
    text = str(data.get("text") or "").strip()
    language = normalize_language(data.get("language"))
    if not language or language not in cfg.tts_languages:
        return _error(400, "No local voice is installed for this language.", "unsupported_language")
    if not text:
        return _error(400, "Text is empty.", "empty")
    if len(text) > cfg.max_tts_chars:
        return _error(413, f"Text is longer than {cfg.max_tts_chars} characters.", "too_long")
    started = time.perf_counter()
    pcm, rate = await _in_thread(request.app[ENGINES]["tts"].synthesize, text, language, data.get("speaker"))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return web.Response(
        body=buf.getvalue(),
        content_type="audio/wav",
        headers={"X-Seconds": f"{time.perf_counter() - started:.3f}", "X-Sample-Rate": str(rate)},
    )


def create_app(cfg: LocalAIConfig | None = None, engines: dict | None = None) -> web.Application:
    cfg = cfg or load_config()
    if engines is None:
        from .engines.stt import SpeechToText
        from .engines.translate import Translator
        from .engines.tts import TextToSpeech

        registry = ModelRegistry(cfg.memory_budget_gb)
        engines = {
            "registry": registry,
            "translate": Translator(cfg, registry),
            "stt": SpeechToText(cfg, registry),
            "tts": TextToSpeech(cfg, registry),
        }
    app = web.Application(middlewares=[auth_and_errors], client_max_size=cfg.max_body_mb * 1024 * 1024)
    app[CONFIG] = cfg
    app[ENGINES] = engines
    app.add_routes(
        [
            web.get("/health", health),
            web.post("/v1/translate", translate),
            web.post("/v1/transcribe", transcribe),
            web.post("/v1/tts", tts),
        ]
    )
    return app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    if cfg.host not in ("127.0.0.1", "localhost", "::1") and not cfg.secret:
        raise SystemExit("Set LOCAL_AI_SECRET before binding the local AI service to a non-local address.")
    web.run_app(create_app(cfg), host=cfg.host, port=cfg.port)


if __name__ == "__main__":
    main()
