# Implementation checklist

Legend: [x] done & verified · [~] implemented, verification pending (needs credentials/people) · [ ] pending · [!] blocked

## Phase 1 — Environment & architecture
- [x] Environment inspected (Windows 11, Node 24.21, Python 3.14.7, Git; no Docker/PostgreSQL)
- [x] LiveKit Python SDKs install on Python 3.14; local LiveKit server 1.13.10 in `tools/livekit`
- [x] Sarvam APIs researched from official docs ([PROVIDER_EVALUATION.md](PROVIDER_EVALUATION.md))
- [x] Project structure, `.env.example`, `.gitignore`, requirements, setup script

## Phase 2 — Working WebRTC call
- [x] Django models + migrations (LanguagePreference, CallRoom, CallParticipant, CallUsage), session auth, rooms, tokens
- [x] React app: landing, auth, create/join, language selection, call, summary, settings/usage
- [x] Two participants hear each other on a real LiveKit server (Python WebRTC clients, `integration_call_test.py`)
- [~] Two real browsers with microphones (in-app browser blocks mic; do the manual test)

## Phase 3/4 — Translation, both directions
- [x] Provider abstraction + Sarvam implementation (realtime/legacy STT, translate, REST/stream TTS)
- [x] Worker: explicit dispatch, participant-aware routing, per-listener tracks + permissions (verified on real server)
- [x] Feedback-loop prevention, echo guard, backlog/stale handling, optional barge-in, reconnects
- [x] Real Sarvam STT → translate → TTS, both directions (`sarvam_smoke_test.py`: PASS, correct transcripts & translations)
- [~] Real Tamil↔Hindi call between two people in browsers (manual two-browser test pending)

## Phase 5 — UI
- [x] Subtitles (partial/final/translation/skipped), per-speaker status, connection/translator chips, mute, mic &
      speaker selection, original-voice level, language change mid-call, reconnect banner, rejoin, duration warning,
      limit/credit/disabled notices, invite card, summary with usage & latency

## Phase 6 — Testing & measurement
- [x] Backend 28 tests, worker 48 tests, frontend 8 tests (all mocked, no credits)
- [x] Latency instrumentation end to end (worker → backend → summary page)
- [x] Provider latency measured: speech end → first translated audio 2.3 s (ta→hi), 3.4 s (hi→ta) on synthetic speech
- [~] In-call latency p50/p95, accuracy on human voices, echo behaviour (two-person test pending)

## Phase 7 — Docs
- [x] README (Windows first), API, architecture, provider evaluation, limitations/privacy/costs/production checklist, test report

## Mobile & phone calls — step 1 (no accounts needed)
- [x] Mobile-number login: OTP request/verify, hashed single-use codes, expiry, lockout, resend cooldown, hourly cap, token auth (11 tests)
- [~] Real SMS delivery — needs a DLT-registered SMS provider (dev: codes printed to backend log)
- [x] Worker: phone-line (SIP) callers translated; auto language detection; same-language skip; consent announcement (cached) (7 new tests)
- [x] Web + app: phone callers receive only the translation (mic restricted to the translator while translation works)
- [x] Android app (Expo SDK 58): OTP login, home, call screen (subtitles, mute, speaker/earpiece, ducking), summary, settings, call-forwarding guide
- [x] App checks: typecheck, expo-doctor 20/20, Android JS bundle export
- [!] App on a real phone — needs an EAS (Expo) account or Android Studio
- [~] Cloud deployment files (Docker Compose: Postgres, Django/gunicorn, worker, Caddy HTTPS); `check --deploy` passes; Docker build not yet run
- [x] Telephony provider research ([TELEPHONY_PROVIDERS.md](TELEPHONY_PROVIDERS.md)) — **regulatory confirmation needed**
- [ ] Step 2: LiveKit Cloud + server deployment (your accounts)
- [ ] Step 3: telephony provider, SIP trunk, inbound dispatch to the right user, outbound calling
- [ ] Step 4: background calls, ringing incoming calls (push notifications), Play Store release

## Meeting Assistant upgrade (LEVELUP SYSTEMS)
- [x] `meetings` app: Meeting, TranscriptSegment, ActionItem, MeetingJob models + migrations (additive only)
- [x] Upload validation by decoding (WAV/MP3/M4A/AAC/WebM/OGG/FLAC), size/duration limits, private storage, Range streaming, playback MP3
- [x] DB-backed job runner (`process_meetings`): transcribe → translate → optional notes; retries, stale recovery, failure messages
- [x] Transcription interface: Sarvam (pause-split, exact offsets) + optional faster-whisper
- [x] Translation stored separately; per-segment language; mixed speech (codemix)
- [x] Claude notes with JSON schema + grounding (no invented decisions/owners/deadlines) — [~] needs ANTHROPIC_API_KEY for a live run
- [x] Search/filter/pagination, owner-only access, segment edits, action items, TXT/DOCX export, PDF via print view
- [x] LiveKit: live-meeting mode (transcribe/translate/optional voice), call "Save transcript" with two-party consent
- [x] Meeting usage counts toward existing daily AI limits; every paid service switchable off
- [x] Real Sarvam integration test (upload + live) PASS; existing call/routing integration tests still PASS
- [ ] ESLint not configured in the frontend (TypeScript strict typecheck used instead)
- [x] Mobile app: meetings history, new (live / record / upload), detail (player, transcript seek + edit, notes, translate, TXT/Word share, delete) — typecheck, expo-doctor 20/20 and Android bundle pass
- [ ] Mobile meetings tested on a real phone (needs a new EAS dev build with expo-audio etc.)

## Translator tools — phase 1 (face to face, instant)
- [x] Backend `quick` app: `POST /api/quick/text/` and `/api/quick/speech/` (Sarvam STT → translate → bulbul TTS, WAV parts joined); only usage numbers stored; daily budget + `quick` throttle (14 tests)
- [x] Real Sarvam smoke test: en→ta text + voice 2.4 s; that Tamil audio back → auto-detected, → Hindi 1.5 s
- [x] Mobile *Face to face* (split screen, top half upside down, hold to speak, translation spoken on the other side) and *Instant translate* (type or hold to speak, play, copy) — typecheck, lint, expo-doctor 20/20, Android bundle
- [ ] Face to face / Instant tested on a real phone
- [x] Video calls: `video` option on room creation, camera publish granted only in video rooms, `VIDEO_CALLS_ENABLED` switch (2 tests); web (video tile, self view, caption overlay, camera button, join notice) and mobile (video, self view, captions, camera on/off, flip, loudspeaker default, 360p) — typecheck/tests pass
- [ ] Video call tested between two real devices (the in-app browser pane cannot connect WebRTC media; mobile needs a new EAS build for the camera permission)
- [x] AI assistant (Claude): `POST /api/assistant/chat/` language-helper chat (history sent by the app, never stored; alternation/size validated; per-user + global daily caps; refusal handling) and `/api/assistant/image/` photo text translation (JPEG/PNG/WebP sniffed from bytes, ≤5 MB, structured JSON output) — 16 tests; shared Anthropic error mapping with meeting notes
- [x] `quick/speech` `transcribe_only` (dictation for the assistant) — 1 test
- [x] Mobile *AI assistant* (chat, answer language, hold-to-dictate, Listen via Sarvam voice, Copy, suggestions) and *Photo translate* (camera or gallery, crop, resized to 1600 px JPEG, line-by-line translation, Listen, Copy all) — typecheck, lint, expo-doctor 20/20, bundle; adds expo-image-picker + expo-image-manipulator (needs the final EAS build)
- [ ] Assistant + photo tested with a real ANTHROPIC_API_KEY (not set in .env yet)
- [x] Phone calls (`telephony` app): dial out (`POST /api/phone/dial/`: E.164 normalisation, +91-only by default, per-user daily cap, room + translator created before ringing), incoming forwarded calls via signed LiveKit webhook (owner by dedicated `PhoneLine` or forwarding-number attribute; unknown → hung up), ringing list / answer / decline / ring timeout → missed, caller hang-up ends the call, phone rooms not joinable by invite code; `manage.py setup_sip` creates trunks + dispatch rule — 24 tests
- [x] Mobile *Call a phone number* (dial pad, caller language or detect, recent calls), incoming-call card on Home (Answer / Decline, polled while open), call screen *Calling… / Ringing* states and pick-up report — typecheck, lint, expo-doctor 20/20, bundle
- [x] `deploy/docker-compose.livekit.yml`: self-hosted LiveKit + LiveKit SIP + Redis with the webhook (config via `LIVEKIT_CONFIG` / `SIP_CONFIG_BODY`)
- [ ] Phone calls end-to-end: needs an Exotel/Plivo SIP trunk, a Linux server with public IP for LiveKit SIP, `setup_sip`, and confirming whether the provider can send the forwarding number in an X-* header
- [ ] Ringing when the app is closed (push notifications + Android full-screen call UI) — later step
- [ ] Voice clone: research only (Sarvam has no cloning; needs a paid provider and consent design)

## Admin, keys and plans
- [x] Provider API keys from the web admin page (`integrations`): Fernet-encrypted at rest (`SECRETS_ENCRYPTION_KEY`, required in production), write-only API (only source + last 4 shown), admin-only, audit log of set / remove / test, key test with one tiny request, .env fallback, 30 s cache; worker fetches the Sarvam key per call over the worker-secret channel — 11 backend + 5 worker tests
- [x] Plans (`billing`): Free / Pro / Business seeded (example prices), per-user daily call minutes, assistant requests, monthly meeting minutes, video, phone calls; enforced on calls, joins, assistant, meetings, dial and incoming calls; admins unlimited; `GET /api/me/plan/`
- [x] Admin dashboard (`adminpanel`): estimated ₹ cost per day (Sarvam + Claude, configurable rates), today's budget meters, activity table, top users; users (search, plan change, deactivate → signs out); plan editing; `manage.py grant_admin` — 15 tests
- [x] Abandoned rooms count at most their max length in usage
- [x] Web redesign: token-based light/dark theme (follows OS + toggle), sidebar app shell with mobile drawer, admin section, plan card in Settings
- [ ] Meeting-notes Claude tokens are not yet metered into the cost estimate
- [ ] Payments (Razorpay) — not connected; plan changes are manual
- [x] Mobile redesign: bottom tabs (Calls, Translate, Assistant, Meetings, Settings), Translate tools hub, vector icons instead of emoji, refreshed UI kit (list rows, tiles, icon badges, card shadows, colours matching web), plan card in Settings — typecheck, expo-doctor 20/20, bundle (icons are JS + font: no new native build needed)
- [x] Voice clone research: `docs/VOICE_CLONE_RESEARCH.md` (Sarvam / ElevenLabs / Google / Azure, consent design)
- [ ] Ringing with the app closed: needs a Firebase project (FCM) for Android push — waiting for go-ahead

## Local open-source AI (no paid keys) — docs/LOCAL_AI.md
- [x] Exports: CSV, JSON, SRT, VTT added to TXT/Word (web + mobile); search, filters, pagination already existed
- [x] Local AI service (`local_ai/`, own Python 3.12 venv): IndicTrans2, faster-whisper, Indic Parler-TTS, LRU RAM budget, secret header
- [x] Backend engine switch (`AI_ENGINE` / per-job), quick tools + meeting translation + meeting transcription via the service; local work is not billed
- [x] Live calls: `SPEECH_PROVIDER=local` turn-based provider in the worker (own end-of-turn detection, ordered results)
- [x] Summaries: `SUMMARY_PROVIDER=ollama` (Qwen3 4B, Apache-2.0), same evidence grounding as Claude
- [x] Web Translate page: language selectors, swap, copy, clear, mic, play/pause/resume/stop, char count, states
- [x] `GET /api/ai/capabilities/`
- [x] Whisper measured on the laptop: small 11.4 s / base 3.6 s for 8.2 s of English speech, exact transcripts
- [x] Ollama + Qwen3 4B installed; real summary: 100 s, correct structure and evidence, one garbled date
- [!] IndicTrans2 + Indic Parler-TTS: gated on Hugging Face — owner must accept terms and run `hf auth login`
- [ ] Measure translation and speech latency on the laptop; native listeners check Tamil/Hindi voices
- [ ] Tamil speech recognition quality with Whisper (real speakers)
- [ ] Live local call latency on target hardware (expect several seconds per turn without a GPU)
- [ ] Speaker diarization (not available locally; transcripts show no speaker rather than a guess)
- [x] Local assistant chat + photo translate (`ASSISTANT_PROVIDER=ollama`, Qwen3 + Qwen3-VL); local requests counted but not priced
