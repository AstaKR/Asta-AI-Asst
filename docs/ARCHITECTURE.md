# Architecture

```
 Browser A (React)            LiveKit server (SFU)              Browser B (React)
  mic ──────────────► track "microphone" (A) ───────────────────► plays A's original (ducked)
  plays ◄──────────── track "translation-for-A" (agent) 
                              track "translation-for-B" (agent) ─► plays translation
  plays B's original ◄─────── track "microphone" (B) ◄──────────── mic
        ▲                          │      ▲
        │ data "translator"        │      │ publish (per-listener permissions)
        └──────────────────────────┤      │
                          Translation worker (LiveKit Agents job, one per call)
                           Direction A→B: STT(ta) → translate(ta→hi) → TTS(hi)
                           Direction B→A: STT(hi) → translate(hi→ta) → TTS(ta)
                                   │ usage report (shared secret)
 Django API ◄──────────────────────┘
  auth, rooms, tokens, limits, usage (SQLite dev / PostgreSQL prod)
```

## Call setup

1. Host creates a room (`POST /rooms/`), guest joins with the invite code.
2. Each client fetches a short-lived token. The token carries signed participant attributes (languages, voice)
   and a room configuration that **explicitly dispatches** the `call-translator` agent when the room is created.
   The worker therefore only ever joins rooms created through this backend.
3. The worker job connects with `auto_subscribe=SUBSCRIBE_NONE`, immediately sets its track permissions to
   *deny everyone*, then subscribes only to human microphone tracks.

## Routing (translation_worker/routing.py)

- Speakers/listeners are participants of kind `STANDARD` only (max two). Agent participants — including the worker
  itself — are never subscribed to or translated. **This is the primary feedback-loop protection.**
- Route per ordered pair (speaker, listener) when `speaker.spoken_language != listener.listen_language`.
  Same-language pairs have no route and cost nothing; the listener hears the original at full volume.
- Each listener gets one published track `translation-for-<identity>`; `set_track_subscription_permissions`
  allows each listener exactly their own track SID. Verified on a real server: a forced cross-subscription is refused.
- Language changes mid-call update participant attributes via the server API; the worker re-computes routes and
  restarts only the affected direction.

## Pipeline per direction (translation_worker/pipeline.py)

```
mic frames (16 kHz mono, 20 ms) ─► local energy gate ─► STT WebSocket ─► events
   speech_start / partial  → status + partial subtitles
   speech_end              → timestamp (latency anchor)
   final                   → echo guard → de-dup → backlog queue (max 2, oldest dropped & marked "skipped")
queue ─► translate (timeout) ─► subtitle ─► TTS (per sentence, pipelined) ─► AudioSource (paced, 20 ms frames)
```

- **Streaming vs turn-based (honest description):** recognition is streamed continuously with partial transcripts
  (Sarvam realtime STT). Translation and speech synthesis run **per completed utterance** (after the provider's VAD
  finalises a turn), because translating partial sentences produces unstable output. Synthesis is split per sentence
  and the next sentence is requested while the current one plays. So this is a *streaming-recognition,
  utterance-level translation* pipeline, not simultaneous word-by-word interpretation.
- **Cost gate:** silence is not sent to the STT API (energy gate with 300 ms pre-roll and 1.2 s hang-over so the
  provider still sees end-of-turn silence). The STT socket is opened lazily and re-opened after inactivity closes it.
- **Reconnects:** retryable STT failures reconnect with backoff (0.5 → 8 s); after 6 consecutive failures the
  direction stops and notifies. Auth/credit/config errors stop immediately (no retry loops).
- **Stale output:** backlog overflow drops the oldest pending sentence so an old translation never plays after a
  newer one has superseded it. Optional barge-in (`INTERRUPT_ON_LISTENER_SPEECH`) cancels in-flight synthesis and
  clears the queued audio when the listener starts talking.
- **Echo guard:** what was spoken *to* a listener is remembered for 12 s; that listener's transcripts that match it
  (substring or ≥ 0.75 similarity) are dropped, preventing translated speech that leaks from speakers into the mic
  from being translated back. Browser AEC (`echoCancellation: true`) is the first line of defence; headphones the best.
- **Limits:** a single `UsageGate` per call combines per-call caps (from dispatch metadata), backend decisions (daily
  caps, room ended) and provider credit exhaustion. When closed, no further paid request is made.

## Latency measurement (translation_worker/metrics.py)

Per utterance, with `time.monotonic()` in the worker:
`first_transcript_ms` (VAD speech-end → final transcript), `translation_ms`, `tts_first_chunk_ms`,
`end_to_audio_ms` (speech-end → first translated frame queued to WebRTC), `utterance_total_ms`.
Aggregates (avg/p50/p95/max) are reported to the backend and shown on the call summary. Not included: WebRTC
network + jitter-buffer delay on the listener side (typically tens of ms on LAN; measure separately in real tests).

## Provider abstraction (translation_worker/providers/base.py)

`SpeechProvider`: `open_stt_stream(language) → STTStream` (`push_audio`, `events()`, `aclose`), `translate`,
`synthesize → async iterator of PCM chunks`, `capabilities`, per-call `usage`, and a typed error hierarchy
(`ProviderConfigError`, `ProviderAuthError`, `ProviderQuotaError`, `ProviderRateLimitError`,
`ProviderTimeoutError`, `ProviderUnavailableError`, `ProviderRequestError`) with `retryable` semantics.
Cancellation = cancelling the consuming task (HTTP requests and WebSockets are closed). New providers are added in
`providers/` and registered in `providers/__init__.py`; test doubles live only under `tests/` and are never selectable.

## Frontend audio policy (frontend/src/lib/audioPolicy.ts)

- Other person's original voice: 100 % if no translation is needed or the translator is unavailable; otherwise the
  user's "original voice" level (default 15 %).
- Only the agent track named `translation-for-<my identity>` is played (and the server only permits that one).
