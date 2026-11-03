"""Real-credential smoke test of the Sarvam provider (spends a small amount of credit, ~₹1 or less).

Exercises the exact production provider code, in both directions:
    1. TTS   : synthesize a sentence in the source language (used as "the speaker's voice")
    2. STT   : stream that audio in real time (100 ms chunks) to the realtime STT WebSocket
    3. Translate source -> target
    4. TTS   : synthesize the translation (first-chunk latency measured)

Usage:
    .venv\\Scripts\\python scripts\\sarvam_smoke_test.py            # ta-IN -> hi-IN and hi-IN -> ta-IN
    .venv\\Scripts\\python scripts\\sarvam_smoke_test.py --save out  # also write WAV files to ./out
Requires SARVAM_API_KEY in .env. Does not need LiveKit, the backend, or a microphone.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from translation_worker.config import load_config  # noqa: E402
from translation_worker.providers.base import ProviderError  # noqa: E402
from translation_worker.providers.sarvam import SarvamProvider  # noqa: E402

SAMPLES = {
    "ta-IN": "வணக்கம், இன்று மாலை நான்கு மணிக்கு கூட்டம் இருக்கிறது.",
    "hi-IN": "नमस्ते, मैं कल सुबह आपको रिपोर्ट भेज दूँगा।",
}


def save_wav(path: Path, pcm: bytes, rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


async def one_direction(provider: SarvamProvider, src: str, dst: str, save: Path | None) -> dict:
    text = SAMPLES[src]
    print(f"\n=== {src} -> {dst} ===\nsource text: {text}")

    # 1) Speaker audio (synthetic) at the STT sample rate.
    pcm = b"".join([c.pcm async for c in provider.synthesize(text, src, None)])
    print(f"source audio: {len(pcm) / 2 / 16000:.1f} s")
    if save:
        save_wav(save / f"{src}_source.wav", pcm, 16000)

    # 2) Stream to realtime STT in real time, then 1 s of silence so server VAD ends the turn.
    stt = await provider.open_stt_stream(src)
    events, final_text, t = [], "", {}

    async def reader():
        nonlocal final_text
        async for ev in stt.events():
            events.append(ev.type)
            if ev.type == "speech_end":
                t.setdefault("speech_end", time.monotonic())
            if ev.type == "partial":
                t.setdefault("first_partial", time.monotonic())
            if ev.type == "final" and ev.text.strip():
                t["final"] = time.monotonic()
                final_text = ev.text
                return

    read_task = asyncio.create_task(reader())
    t["audio_start"] = time.monotonic()
    chunk = 3200
    for i in range(0, len(pcm), chunk):
        await stt.push_audio(pcm[i : i + chunk])
        await asyncio.sleep(0.1)
    t["audio_end"] = time.monotonic()
    for _ in range(15):
        if read_task.done():
            break
        await stt.push_audio(b"\x00" * chunk)
        await asyncio.sleep(0.1)
    await asyncio.wait_for(read_task, 10)
    await stt.aclose()
    anchor = t.get("speech_end", t["audio_end"])
    print(f"STT events: {events}")
    print(f"transcript: {final_text}")

    # 3) Translate.
    t0 = time.monotonic()
    translated = await provider.translate(final_text, src, dst)
    t_translate = time.monotonic() - t0
    print(f"translation: {translated}")

    # 4) Synthesize translation, measure first chunk.
    t0 = time.monotonic()
    first = None
    out = bytearray()
    rate = provider.cfg.tts_sample_rate
    async for c in provider.synthesize(translated, dst, None):
        first = first or time.monotonic()
        out.extend(c.pcm)
        rate = c.sample_rate
    if save:
        save_wav(save / f"{src}_to_{dst}.wav", bytes(out), rate)

    result = {
        "direction": f"{src}->{dst}",
        "first_partial_after_audio_start_ms": round((t["first_partial"] - t["audio_start"]) * 1000) if "first_partial" in t else None,
        "final_after_speech_end_ms": round((t["final"] - anchor) * 1000),
        "translate_ms": round(t_translate * 1000),
        "tts_first_chunk_ms": round((first - t0) * 1000) if first else None,
        "speech_end_to_first_translated_audio_ms": round((t["final"] - anchor + t_translate + ((first or t0) - t0)) * 1000),
        "translated_audio_s": round(len(out) / 2 / rate, 2),
    }
    for k, v in result.items():
        print(f"  {k}: {v}")
    return result


async def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Tamil/Hindi on Windows consoles
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", type=Path, default=None, help="directory to save WAV files")
    args = parser.parse_args()
    cfg = load_config()
    if not cfg.sarvam.api_key:
        print("SARVAM_API_KEY is not set in .env - nothing to test.")
        return 2
    # Source audio is generated at 16 kHz so it can be streamed straight into STT.
    provider = SarvamProvider(dataclasses.replace(cfg.sarvam, tts_sample_rate=16000))
    results = []
    try:
        for src, dst in (("ta-IN", "hi-IN"), ("hi-IN", "ta-IN")):
            results.append(await one_direction(provider, src, dst, args.save))
    except ProviderError as exc:
        print(f"\nPROVIDER ERROR ({exc.__class__.__name__}): {exc}")
        return 1
    finally:
        print(f"\nusage: {provider.usage}")
        await provider.aclose()
    print("\nPASS (review the transcripts/translations above for accuracy)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
