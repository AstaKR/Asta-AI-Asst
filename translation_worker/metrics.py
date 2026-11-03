"""Latency measurement. Values are in milliseconds and measured with time.monotonic()."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

log = logging.getLogger("translation_worker.metrics")

METRIC_NAMES = (
    "end_to_audio_ms",  # speech end (provider VAD) -> first translated audio frame queued
    "first_transcript_ms",  # speech end -> final transcript received
    "translation_ms",  # translate request duration
    "tts_first_chunk_ms",  # TTS request -> first audio chunk
    "utterance_total_ms",  # speech end -> last translated audio frame queued
)


class LatencyStats:
    def __init__(self, cap: int = 500):
        self.samples: dict[str, list[float]] = {name: [] for name in METRIC_NAMES}
        self.cap = cap

    def add(self, name: str, value_ms: float) -> None:
        values = self.samples.setdefault(name, [])
        values.append(round(value_ms, 1))
        if len(values) > self.cap:
            del values[0]

    def summary(self) -> dict[str, dict[str, float]]:
        out = {}
        for name, values in self.samples.items():
            if not values:
                continue
            ordered = sorted(values)
            out[name] = {
                "count": len(ordered),
                "avg": round(sum(ordered) / len(ordered), 1),
                "p50": ordered[len(ordered) // 2],
                "p95": ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))],
                "max": ordered[-1],
            }
        return out


@dataclass
class UtteranceTiming:
    utterance_id: str
    speech_end_at: float | None = None
    final_at: float | None = None
    translate_started_at: float | None = None
    translate_done_at: float | None = None
    tts_started_at: float | None = None
    first_audio_at: float | None = None
    last_audio_at: float | None = None
    marks: dict[str, float] = field(default_factory=dict)

    def record(self, stats: LatencyStats, route: str) -> dict[str, float]:
        result: dict[str, float] = {}
        anchor = self.speech_end_at or self.final_at

        def put(name, start, end):
            if start is not None and end is not None and end >= start:
                result[name] = (end - start) * 1000
                stats.add(name, result[name])

        put("first_transcript_ms", self.speech_end_at, self.final_at)
        put("translation_ms", self.translate_started_at, self.translate_done_at)
        put("tts_first_chunk_ms", self.tts_started_at, self.first_audio_at)
        put("end_to_audio_ms", anchor, self.first_audio_at)
        put("utterance_total_ms", anchor, self.last_audio_at)
        log.info("latency route=%s utt=%s %s", route, self.utterance_id,
                 " ".join(f"{k}={v:.0f}" for k, v in result.items()))
        return result
