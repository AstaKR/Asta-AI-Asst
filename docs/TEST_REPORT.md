# Test report

Environment: Windows 11 Pro, Python 3.14.7, Node 24.21, LiveKit server 1.13.10 (`--dev`, localhost),
livekit 1.1.20 / livekit-agents 1.8.8, Django 6.1.2, React 19.2, Vite 7.1. Date: 2026-10-21.

## Automated (no credits spent; third-party APIs mocked)

| Suite | Command | Result |
|---|---|---|
| Backend (health, auth, room creation/authorization, room full/expired/ended, token grants/TTL/dispatch, LiveKit-not-configured, language validation, mid-call language change, worker secret, per-call + daily limits, AI budget disabling translation, call duration expiry, rate limiting) | `cd backend; ..\.venv\Scripts\python -m pytest -q` | **28 passed** |
| Worker (direction correctness ta→hi / hi→ta / en↔hi, asymmetric prefs, agents & self excluded, subscription rules, track-permission isolation, bidirectional audio isolation, echo not re-translated, translate timeout, credit exhaustion, per-call limit, STT reconnect, repeated failure stop, barge-in, backlog drop, empty/duplicate text, silence not billed, missing credentials, Sarvam request shapes, error mapping, WAV decoding, realtime + legacy STT protocol, usage reporter) | `.\.venv\Scripts\python -m pytest -q` | **48 passed** |
| Frontend (audio policy, translator-event reducer, message parsing) + typecheck + production build | `npm --prefix frontend test`, `run typecheck`, `run build` | **8 passed**, typecheck clean, build OK |

## Integration on real infrastructure (no AI provider)

| Test | Result |
|---|---|
| `scripts/integration_call_test.py` — two LiveKit clients authenticated through the backend publish 440 Hz / 880 Hz tones | **PASS**: B received 440 Hz from A, A received 880 Hz from B; screen-share-audio publish refused by token; *End call* disconnected both |
| Agent dispatch via token room config (worker in `dev` and `start` modes) | **PASS**: job received, worker joined, announced `provider_not_configured` (no key), exited cleanly on room deletion, sent final usage report to backend |
| `scripts/integration_routing_test.py` — real `CallSession` on the real server with a test-only tone provider | **PASS**: A got only `translation-for-A` (1000 Hz = Tamil target), B only `translation-for-B` (600 Hz = Hindi target); forced cross-subscriptions refused; subtitles delivered to both |
| Browser UI (in-app browser): register → choose language → create call → call screen → end → summary → settings/usage | **PASS** for flow and LiveKit connection; microphone capture is blocked in that browser pane, so no audio was sent from a real browser |

Bugs found and fixed during integration: awaiting a synchronous SDK method (`set_track_subscription_permissions`);
SQLite "database is locked" under concurrent token requests (now IMMEDIATE transactions + busy timeout);
React StrictMode double token fetch; barge-in cancelling translations when both people talk at once (now opt-in).

Worker-side overhead measured with the tone provider (fake final transcript → first translated frame queued):
**0.19–0.40 s** across runs. This excludes all real AI time and is only the plumbing cost.

## NOT yet verified (requires credentials / people)

| Item | How to verify |
|---|---|
| Real Tamil→Hindi and Hindi→Tamil voice translation between two people | Manual two-browser test in README |
| Measured latency (speech end → translated audio), accuracy, audio quality | Smoke test output + call summary table |
| Legacy STT socket (`SARVAM_STT_API=legacy`) and streaming TTS (`SARVAM_TTS_MODE=stream`) | Smoke test with those settings |
| Echo behaviour on laptop speakers without headphones | Manual test |
| Two physical devices over the internet (needs LiveKit Cloud or deployed server) | Manual test |
| Mobile browsers | Manual test |

## Real Sarvam provider — `scripts/sarvam_smoke_test.py` (2026-10-21, user's machine)

Production provider code (`saaras:v3-realtime` STT, `mayura:v1` translate, `bulbul:v3` REST TTS), defaults
(`silence_duration_ms=500`, `stream_type=balanced`). Input audio was **Sarvam-synthesised speech streamed in real
time** (100 ms chunks), not a human microphone — accuracy on real voices, accents and noise is still untested.

| Direction | first partial (from audio start) | VAD speech end → final transcript | translate | TTS first audio | **speech end → first translated audio** | translated audio |
|---|---|---|---|---|---|---|
| ta-IN → hi-IN | 1079 ms | 144 ms | 1388 ms | 749 ms | **2.28 s** | 2.73 s |
| hi-IN → ta-IN | 1226 ms | 252 ms | 1345 ms | 1799 ms | **3.40 s** | 4.86 s |

- Transcripts matched the source sentences exactly in both directions.
- Translations were correct and natural:
  வணக்கம், இன்று மாலை நான்கு மணிக்கு கூட்டம் இருக்கிறது. → नमस्ते, आज शाम 4 बजे एक बैठक है।
  नमस्ते, मैं कल सुबह आपको रिपोर्ट भेज दूँगा। → வணக்கம், நான் உங்களுக்கு அறிக்கையை நாளை காலை அனுப்புகிறேன்.
- Usage for both directions: 7.1 s STT, 97 chars translated, 188 chars synthesised (includes the synthetic source
  audio), 8 requests, 0 errors.
- Not included: the ~0.5 s silence the server VAD waits before `speech_end`, and WebRTC delivery to the listener.
  Expect roughly **2.8–4 s from when the speaker stops talking to when the listener starts hearing the translation**
  for sentences of this length.
- Biggest contributors: translation (~1.35 s) and TTS for longer Tamil output (~1.8 s, REST synthesises the whole
  sentence before returning). Candidates: `SARVAM_TTS_MODE=stream`, `sarvam-translate:v1`, lower `SARVAM_STT_SILENCE_MS`.

## Still to fill in from a two-person call (call summary page)

| Direction | speech end → translated audio p50 / p95 | notes (accuracy, echo, overlap) |
|---|---|---|
| ta-IN → hi-IN | | |
| hi-IN → ta-IN | | |


## Meeting Assistant (26 Oct 2026)

| Suite | Result |
|---|---|
| Backend `pytest` (incl. 26 meetings tests: upload validation, offsets, translation persistence, failed/retried jobs, budget, grounding, Claude request shape, search/filters/pagination, owner isolation, edits, exports, live + call transcript consent) | **74 passed** |
| Worker `pytest` (incl. meeting routes, transcribe-only, subtitles-only, segment reporter) | **59 passed** |
| Frontend vitest (incl. meeting helpers) + typecheck + build | **17 passed**, clean, OK |
| `scripts/integration_meeting_test.py` — real Sarvam | **PASS**: 7.5 s Tamil + Hindi upload → 2 segments `[0–3210 ms] (ta)` and `[4830–7470 ms] (hi)`, correct English translations, 5.8 s billed, TXT export OK; live meeting → Tamil segment at 3998–7285 ms with live English translation |
| Existing `integration_call_test.py`, `integration_routing_test.py` | **PASS** (no regression) |
| Browser: meetings list, detail (player, side-by-side transcript, click-to-seek → 4.83 s), new-meeting tabs | **PASS** |

Not verified: Claude notes against the real API (no key yet), faster-whisper engine (not installed), browser
recording/live session from a real microphone (in-app browser blocks mic), DOCX opened in Word (structure verified),
long (1–2 h) recordings, PostgreSQL (tests ran on SQLite).
