import httpx
import pytest

from translation_worker.audio import EnergyGate
from translation_worker.echo_guard import EchoGuard
from translation_worker.metrics import LatencyStats, UtteranceTiming
from translation_worker.pipeline import Counters, UsageGate
from translation_worker.providers.base import ProviderUsage
from translation_worker.usage_reporter import UsageReporter

from .fakes import loud_frame, silent_frame


def test_energy_gate_drops_silence_and_keeps_preroll():
    gate = EnergyGate(16000, preroll_ms=40, hangover_ms=40)
    assert gate.process(silent_frame()) == b""
    assert gate.process(silent_frame()) == b""
    out = gate.process(loud_frame())
    assert len(out) == 3 * 640  # 40 ms preroll + current frame
    assert gate.process(silent_frame()) != b""  # hangover
    assert gate.process(silent_frame()) != b""
    assert gate.process(silent_frame()) == b""


def test_echo_guard_window():
    now = [0.0]
    guard = EchoGuard(window_s=5, similarity=0.8, clock=lambda: now[0])
    guard.record_played("b", "आप कैसे हैं?")
    assert guard.is_echo("b", "आप कैसे हैं")
    assert guard.is_echo("b", "कैसे हैं")  # partial of played text
    assert not guard.is_echo("a", "आप कैसे हैं")  # only the listener's own mic is checked
    assert not guard.is_echo("b", "मैं ठीक हूँ")
    now[0] = 10
    assert not guard.is_echo("b", "आप कैसे हैं")


def test_latency_stats():
    stats = LatencyStats()
    t = UtteranceTiming("1", speech_end_at=1.0, final_at=1.3, translate_started_at=1.3, translate_done_at=1.5,
                        tts_started_at=1.5, first_audio_at=1.9, last_audio_at=3.0)
    result = t.record(stats, "a->b")
    assert round(result["end_to_audio_ms"]) == 900
    assert round(result["first_transcript_ms"]) == 300
    summary = stats.summary()
    assert summary["end_to_audio_ms"]["count"] == 1 and summary["end_to_audio_ms"]["p95"] == 900


def test_usage_gate_per_call_limits():
    usage = ProviderUsage()
    gate = UsageGate(usage, {"stt_seconds": 10, "tts_chars": 100, "translate_chars": 100})
    assert gate.allowed
    usage.stt_seconds = 10
    assert not gate.allowed and gate.reason == "per_call_stt_seconds_limit"


@pytest.mark.asyncio
async def test_reporter_applies_backend_denial():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"allowed": False, "reason": "daily_tts_chars_limit"})

    usage = ProviderUsage(stt_seconds=3.5, tts_chars=10)
    gate = UsageGate(usage)
    reporter = UsageReporter(
        backend_url="http://backend", secret="s3cret", room_name="call-x", usage=usage, counters=Counters(),
        stats=LatencyStats(), gate=gate,
        http=httpx.AsyncClient(base_url="http://backend", transport=httpx.MockTransport(handler)),
    )
    await reporter.report()
    assert seen[0].headers["X-Worker-Secret"] == "s3cret"
    assert seen[0].url.path == "/api/internal/usage/"
    assert not gate.allowed and gate.reason == "daily_tts_chars_limit"


@pytest.mark.asyncio
async def test_reporter_tolerates_backend_outage():
    def handler(request):
        raise httpx.ConnectError("down")

    usage = ProviderUsage()
    gate = UsageGate(usage)
    reporter = UsageReporter(
        backend_url="http://backend", secret="s", room_name="call-x", usage=usage, counters=Counters(),
        stats=LatencyStats(), gate=gate,
        http=httpx.AsyncClient(base_url="http://backend", transport=httpx.MockTransport(handler)),
    )
    assert await reporter.report() is None
    assert gate.allowed and reporter.consecutive_failures == 1
