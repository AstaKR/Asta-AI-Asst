import asyncio

import pytest

from translation_worker.echo_guard import EchoGuard
from translation_worker.metrics import LatencyStats
from translation_worker.pipeline import Counters, DirectionSettings, TranslationDirection, UsageGate
from translation_worker.providers.base import (
    ProviderQuotaError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    SpeechEvent,
)
from translation_worker.routing import Route

from .fakes import FakeNotifier, FakeOutput, FakeProvider, frames_until, wait_for

A, B = "user-1", "user-2"
FLOW_A = Route(A, B, "ta-IN", "hi-IN", "kavya")
FLOW_B = Route(B, A, "hi-IN", "ta-IN", "rahul")


def make(route=FLOW_A, provider=None, *, guard=None, limits=None, settings=None, on_barge_in=None, counters=None):
    provider = provider or FakeProvider()
    output, notifier = FakeOutput(), FakeNotifier()
    direction = TranslationDirection(
        route,
        provider,
        output,
        notifier,
        echo_guard=guard or EchoGuard(),
        usage_gate=UsageGate(provider.usage, limits),
        stats=LatencyStats(),
        counters=counters or Counters(),
        settings=settings or DirectionSettings(request_timeout_s=0.2, tts_chunk_timeout_s=0.2),
        on_barge_in=on_barge_in,
    )
    return direction, provider, output, notifier


async def start(direction, provider):
    stop = asyncio.Event()
    task = asyncio.create_task(direction.run(frames_until(stop)))
    await asyncio.wait_for(provider.stream_opened.wait(), 2)
    return stop, task


async def finish(stop, task):
    stop.set()
    await asyncio.wait_for(task, 2)


def say(stream, text, utt="1"):
    stream.emit(SpeechEvent("speech_start", utterance_id=utt))
    stream.emit(SpeechEvent("speech_end", utterance_id=utt))
    stream.emit(SpeechEvent("final", text=text, utterance_id=utt))


@pytest.mark.asyncio
async def test_flow_a_tamil_to_hindi_reaches_listener():
    direction, provider, output, notifier = make()
    stop, task = await start(direction, provider)
    stream = provider.streams[0]
    assert stream.language == "ta-IN"  # recognition runs in the speaker's language
    assert len(stream.pushed) > 0  # mic audio is forwarded
    say(stream, "வணக்கம்")
    await wait_for(lambda: len(output.chunks) == 2)
    assert provider.translations == [("வணக்கம்", "ta-IN", "hi-IN")]
    assert provider.syntheses == [("[hi-IN] வணக்கம்", "hi-IN", "kavya")]
    subs = notifier.of("subtitle", stage="translation")
    assert subs and subs[0][0]["text"] == "[hi-IN] வணக்கம்" and subs[0][0]["listener"] == B
    # Subtitles only ever go to the two call participants.
    assert all(set(dest) <= {A, B} for _, dest in notifier.messages)
    await wait_for(lambda: notifier.of("metrics"))
    metrics = notifier.of("metrics")[0][0]
    assert "end_to_audio_ms" in metrics and "translation_ms" in metrics
    await finish(stop, task)


@pytest.mark.asyncio
async def test_bidirectional_audio_isolation():
    provider = FakeProvider()
    guard, counters = EchoGuard(), Counters()
    dir_a, _, out_for_b, _ = make(FLOW_A, provider, guard=guard, counters=counters)
    dir_b, _, out_for_a, _ = make(FLOW_B, provider, guard=guard, counters=counters)
    stop = asyncio.Event()
    tasks = [asyncio.create_task(d.run(frames_until(stop))) for d in (dir_a, dir_b)]
    await wait_for(lambda: len(provider.streams) == 2)
    stream_a = next(s for s in provider.streams if s.language == "ta-IN")
    stream_b = next(s for s in provider.streams if s.language == "hi-IN")
    say(stream_a, "நான் நலம்")
    say(stream_b, "मैं ठीक हूँ")
    await wait_for(lambda: len(out_for_b.chunks) == 2 and len(out_for_a.chunks) == 2)
    # Person B receives only Hindi audio; person A receives only Tamil audio.
    assert all(c.pcm.startswith(b"hi-IN") for c in out_for_b.chunks)
    assert all(c.pcm.startswith(b"ta-IN") for c in out_for_a.chunks)
    assert set(provider.translations) == {("நான் நலம்", "ta-IN", "hi-IN"), ("मैं ठीक हूँ", "hi-IN", "ta-IN")}
    stop.set()
    await asyncio.wait_for(asyncio.gather(*tasks), 2)


@pytest.mark.asyncio
async def test_echo_of_translated_audio_is_not_retranslated():
    provider = FakeProvider()
    guard = EchoGuard()
    dir_a, _, out_for_b, _ = make(FLOW_A, provider, guard=guard)
    dir_b, _, out_for_a, notifier_b = make(FLOW_B, provider, guard=guard)
    counters = dir_b.counters
    stop = asyncio.Event()
    tasks = [asyncio.create_task(d.run(frames_until(stop))) for d in (dir_a, dir_b)]
    await wait_for(lambda: len(provider.streams) == 2)
    stream_a = next(s for s in provider.streams if s.language == "ta-IN")
    stream_b = next(s for s in provider.streams if s.language == "hi-IN")
    say(stream_a, "வணக்கம்")
    await wait_for(lambda: len(out_for_b.chunks) == 2)
    # B's microphone picks up the Hindi translation played from B's speakers.
    say(stream_b, "hi-IN  வணக்கம்!", utt="9")
    await asyncio.sleep(0.1)
    assert len(provider.translations) == 1
    assert out_for_a.chunks == []
    assert counters.echo_dropped >= 1
    stop.set()
    await asyncio.wait_for(asyncio.gather(*tasks), 2)


@pytest.mark.asyncio
async def test_translate_timeout_is_reported_and_pipeline_continues():
    provider = FakeProvider(translate_delay=1.0)
    direction, provider, output, notifier = make(provider=provider)
    stop, task = await start(direction, provider)
    say(provider.streams[0], "first")
    await wait_for(lambda: notifier.of("status", state="error"))
    provider.translate_delay = 0
    say(provider.streams[0], "second", utt="2")
    await wait_for(lambda: len(output.chunks) == 2)
    assert provider.syntheses[0][0] == "[hi-IN] second"
    await finish(stop, task)


@pytest.mark.asyncio
async def test_quota_exhausted_stops_paid_processing():
    provider = FakeProvider()
    provider.translate_errors = [ProviderQuotaError("credits exhausted")]
    direction, provider, output, notifier = make(provider=provider)
    stop, task = await start(direction, provider)
    say(provider.streams[0], "hello")
    await wait_for(lambda: notifier.of("status", state="limit"))
    assert direction.stopped_reason == "provider_credits_exhausted"
    assert direction.usage_gate.allowed is False
    assert provider.syntheses == []
    await asyncio.wait_for(task, 2)  # direction ends itself


@pytest.mark.asyncio
async def test_per_call_usage_limit_blocks_tts():
    direction, provider, output, notifier = make(limits={"tts_chars": 5, "stt_seconds": 1000, "translate_chars": 1000})
    stop, task = await start(direction, provider)
    say(provider.streams[0], "first sentence")
    await wait_for(lambda: len(output.chunks) == 2)
    say(provider.streams[0], "second sentence", utt="2")
    await wait_for(lambda: notifier.of("status", state="limit"))
    assert len(provider.syntheses) == 1
    assert direction.usage_gate.reason == "per_call_tts_chars_limit"
    await asyncio.wait_for(task, 2)


@pytest.mark.asyncio
async def test_stt_reconnects_after_retryable_failure():
    settings = DirectionSettings(reconnect_backoff_s=(0.01,), request_timeout_s=0.2)
    direction, provider, output, notifier = make(settings=settings)
    stop, task = await start(direction, provider)
    provider.streams[0].emit(ProviderUnavailableError("network drop"))
    await wait_for(lambda: len(provider.streams) == 2)
    assert direction.counters.reconnects == 1
    assert notifier.of("status", state="reconnecting")
    say(provider.streams[1], "after reconnect")
    await wait_for(lambda: len(output.chunks) == 2)
    await finish(stop, task)


@pytest.mark.asyncio
async def test_repeated_stt_failures_stop_direction():
    settings = DirectionSettings(reconnect_backoff_s=(0.0,), max_consecutive_failures=2)
    provider = FakeProvider()
    provider.open_errors = [ProviderTimeoutError("t")] * 5
    direction, provider, output, notifier = make(provider=provider, settings=settings)
    stop = asyncio.Event()
    task = asyncio.create_task(direction.run(frames_until(stop, loud=50)))
    await wait_for(lambda: direction.stopped_reason == "provider_error")
    assert notifier.of("status", state="error")
    await asyncio.wait_for(task, 2)


@pytest.mark.asyncio
async def test_barge_in_interrupts_current_playback():
    direction, provider, output, notifier = make()
    provider.tts_chunks = 50
    output.push_delay = 0.02
    stop, task = await start(direction, provider)
    say(provider.streams[0], "a long sentence")
    await wait_for(lambda: len(output.chunks) >= 2)
    direction.interrupt()  # listener started talking
    await wait_for(lambda: notifier.of("status", state="interrupted"))
    played = len(output.chunks)
    await asyncio.sleep(0.1)
    assert len(output.chunks) == played < 50
    assert output.cleared == 1
    assert direction.counters.interruptions == 1
    await finish(stop, task)


@pytest.mark.asyncio
async def test_listener_partial_triggers_barge_in_callback():
    calls = []
    direction, provider, output, notifier = make(FLOW_B, on_barge_in=calls.append)
    stop, task = await start(direction, provider)
    provider.streams[0].emit(SpeechEvent("partial", text="सुनिए", utterance_id="1"))
    provider.streams[0].emit(SpeechEvent("partial", text="सुनिए जी", utterance_id="1"))
    await wait_for(lambda: calls)
    await asyncio.sleep(0.05)
    assert calls == [B]  # once per utterance
    await finish(stop, task)


@pytest.mark.asyncio
async def test_stale_backlog_is_dropped():
    provider = FakeProvider(translate_delay=0.15)
    direction, provider, output, notifier = make(
        provider=provider, settings=DirectionSettings(max_pending=1, request_timeout_s=1)
    )
    stop, task = await start(direction, provider)
    for i in range(4):
        say(provider.streams[0], f"sentence {i}", utt=str(i))
    await wait_for(lambda: any(s[0] == "[hi-IN] sentence 3" for s in provider.syntheses), timeout=3)
    spoken = [s[0] for s in provider.syntheses]
    # Older, superseded sentences never play after the newest one; the newest always plays.
    assert spoken[-1] == "[hi-IN] sentence 3"
    assert len(spoken) < 4
    assert direction.counters.dropped_utterances >= 1
    assert notifier.of("subtitle", stage="skipped")
    await finish(stop, task)


@pytest.mark.asyncio
async def test_empty_and_duplicate_text_cost_nothing():
    direction, provider, output, notifier = make()
    stop, task = await start(direction, provider)
    say(provider.streams[0], "   ")
    say(provider.streams[0], "same words", utt="2")
    say(provider.streams[0], "same words.", utt="3")
    await wait_for(lambda: len(output.chunks) == 2)
    await asyncio.sleep(0.05)
    assert provider.translations == [("same words", "ta-IN", "hi-IN")]
    await finish(stop, task)


@pytest.mark.asyncio
async def test_silence_is_not_sent_to_stt():
    direction, provider, output, notifier = make()
    stop = asyncio.Event()

    async def only_silence():
        from .fakes import silent_frame

        for _ in range(100):
            yield silent_frame()

    await asyncio.wait_for(direction.run(only_silence()), 2)
    assert provider.streams == []  # no stream opened, nothing billed
    assert provider.usage.stt_seconds == 0


@pytest.mark.asyncio
async def test_track_end_closes_direction_cleanly():
    direction, provider, output, notifier = make()
    stop, task = await start(direction, provider)
    await finish(stop, task)
    assert provider.streams[0].closed


# ---------- auto-detected language (phone callers) ----------

CALLER_FLOW = Route("sip-caller", A, "auto", "ta-IN", "")


@pytest.mark.asyncio
async def test_auto_route_uses_detected_language_and_reports_it():
    detected = []
    direction, provider, output, notifier = make(CALLER_FLOW)
    direction.on_language_detected = lambda speaker, lang: detected.append((speaker, lang))
    stop, task = await start(direction, provider)
    assert provider.streams[0].language == "auto"
    stream = provider.streams[0]
    stream.emit(SpeechEvent("final", text="मेरा नाम रवि है", utterance_id="1", language="hi-IN"))
    await wait_for(lambda: len(output.chunks) == 2)
    assert provider.translations == [("मेरा नाम रवि है", "hi-IN", "ta-IN")]
    assert detected == [("sip-caller", "hi-IN")]
    await finish(stop, task)


@pytest.mark.asyncio
async def test_auto_route_same_language_skips_paid_calls():
    direction, provider, output, notifier = make(CALLER_FLOW)
    stop, task = await start(direction, provider)
    provider.streams[0].emit(SpeechEvent("final", text="வணக்கம்", utterance_id="1", language="ta-IN"))
    await wait_for(lambda: notifier.of("subtitle", stage="translation"))
    assert provider.translations == [] and provider.syntheses == [] and output.chunks == []
    await finish(stop, task)


@pytest.mark.asyncio
async def test_auto_route_without_detection_does_not_guess():
    direction, provider, output, notifier = make(CALLER_FLOW)
    stop, task = await start(direction, provider)
    provider.streams[0].emit(SpeechEvent("final", text="???", utterance_id="1", language=None))
    await wait_for(lambda: notifier.of("status", state="error"))
    assert provider.translations == []
    await finish(stop, task)


# ---------- live meetings: transcripts, subtitles-only, saved segments ----------


@pytest.mark.asyncio
async def test_transcribe_only_route_reports_segments_without_paid_translation():
    segments = []
    route = Route(A, A, "ta-IN", "ta-IN", "", speak=False)
    direction, provider, output, notifier = make(route)
    direction.on_segment = segments.append
    stop, task = await start(direction, provider)
    stream = provider.streams[0]
    stream.emit(SpeechEvent("speech_start", utterance_id="1"))
    stream.emit(SpeechEvent("speech_end", utterance_id="1"))
    stream.emit(SpeechEvent("final", text="கூட்டம் தொடங்கியது", utterance_id="1"))
    await wait_for(lambda: segments)
    await asyncio.sleep(0.05)
    assert provider.translations == [] and provider.syntheses == [] and output.chunks == []
    seg = segments[0]
    assert seg["text"] == "கூட்டம் தொடங்கியது" and seg["translation"] == "" and seg["language"] == "ta-IN"
    assert 0 < seg["start_epoch_ms"] <= seg["end_epoch_ms"]
    await finish(stop, task)


@pytest.mark.asyncio
async def test_subtitles_only_route_translates_but_does_not_synthesize():
    segments = []
    route = Route(A, A, "ta-IN", "en-IN", "", speak=False)
    direction, provider, output, notifier = make(route)
    direction.on_segment = segments.append
    stop, task = await start(direction, provider)
    say(provider.streams[0], "வணக்கம்")
    await wait_for(lambda: len(segments) == 2)
    assert provider.translations == [("வணக்கம்", "ta-IN", "en-IN")]
    assert provider.syntheses == [] and output.chunks == []
    # Same utterance id for the text and its later translation (the backend upserts by id).
    assert segments[0]["utterance_id"] == segments[1]["utterance_id"]
    assert segments[1]["translation"] == "[en-IN] வணக்கம்" and segments[1]["translation_language"] == "en-IN"
    await finish(stop, task)


@pytest.mark.asyncio
async def test_segment_reporter_posts_and_requires_secret():
    import httpx

    from translation_worker.usage_reporter import SegmentReporter

    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"stored": 1})

    reporter = SegmentReporter(
        backend_url="http://backend", secret="s", room_name="call-x",
        http=httpx.AsyncClient(base_url="http://backend", transport=httpx.MockTransport(handler)),
    )
    reporter.submit({"utterance_id": "u", "text": "hi", "start_epoch_ms": 1, "end_epoch_ms": 2})
    await reporter.flush()
    assert seen[0].url.path == "/api/internal/meeting-segments/" and seen[0].headers["X-Worker-Secret"] == "s"
    assert b'"room_name":"call-x"' in seen[0].content.replace(b" ", b"")
    await reporter.aclose()
    silent = SegmentReporter(backend_url="http://backend", secret="", room_name="r")
    silent.submit({"utterance_id": "u"})
    assert silent._task is None  # nothing is sent without the shared secret
    await silent.aclose()
