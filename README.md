# AI Call Translator

Two-person internet voice calls with live, two-way AI speech translation. First target: **Tamil ↔ Hindi** (English supported by the same pipeline).

```
Person A speaks Tamil ─► STT (ta) ─► translate ta→hi ─► TTS (hi) ─► "translation-for-B" track ─► Person B
Person B speaks Hindi ─► STT (hi) ─► translate hi→ta ─► TTS (ta) ─► "translation-for-A" track ─► Person A
                                    + live subtitles to both participants
```

> **Scope:** calls happen *inside this app* (browser, WebRTC via LiveKit). It does **not** translate ordinary
> SIM/cellular calls or WhatsApp calls — those need separate telephony integration and feasibility work.

## Status at a glance

| Area | State |
|---|---|
| Django API (auth, OTP, rooms, tokens, limits, usage, meetings) | Implemented, 74 automated tests passing |
| **Meeting Assistant** (record / upload / live translate, timestamped transcripts, translation, AI notes, search, exports) | **Verified with real Sarvam** for upload and live paths (`scripts/integration_meeting_test.py`); AI notes mock-tested only — needs `ANTHROPIC_API_KEY`. See [docs/MEETINGS.md](docs/MEETINGS.md) |
| Two-person WebRTC call through LiveKit | **Verified** on a real local LiveKit server (`scripts/integration_call_test.py`) |
| Translation worker routing / per-listener track isolation | **Verified** on a real LiveKit server with a test-only tone provider (`scripts/integration_routing_test.py`) |
| Worker pipeline logic (direction, echo guard, limits, timeouts, reconnects, live meetings) | 59 automated tests passing (mocked provider) |
| Sarvam AI integration (STT, translate, TTS) | **Verified with real credentials** in both directions (`scripts/sarvam_smoke_test.py`, synthetic speech input) |
| Real Tamil↔Hindi voice call between two people | **Not yet verified** — needs a Sarvam key and the manual two-browser test below |
| Measured latency with real AI | Provider pipeline: speech end → first translated audio **2.3 s (ta→hi) / 3.4 s (hi→ta)**; in-call numbers pending ([docs/TEST_REPORT.md](docs/TEST_REPORT.md)) |

Full checklist: [docs/CHECKLIST.md](docs/CHECKLIST.md).

## Repository layout

```
backend/              Django + DRF API (accounts, calls, meetings), SQLite for dev / PostgreSQL for prod
frontend/             React + TypeScript + Vite + Tailwind + LiveKit components
translation_worker/   LiveKit Agents worker: routing, pipeline, providers/ (sarvam.py), tests/
scripts/              setup.ps1, integration tests, Sarvam smoke test
docs/                 API, provider evaluation, test report, production readiness, checklist
tools/livekit/        local LiveKit server binary (git-ignored, downloaded separately)
```

## Prerequisites

- Windows 10/11 (PowerShell) — Linux/macOS work the same with POSIX paths
- Python 3.11+ (tested on 3.14.7), Node.js 20+ (tested on 24.21), Git
- LiveKit server: either the local binary (`livekit_<ver>_windows_amd64.zip` from
  <https://github.com/livekit/livekit/releases>, extract `livekit-server.exe` to `tools\livekit\`; tested with v1.13.10)
  or a free LiveKit Cloud project
- For translation: a Sarvam AI API key (<https://dashboard.sarvam.ai>; new accounts get a small free credit)

## Setup (Windows PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

This creates `.venv`, installs Python and npm dependencies, creates `.env` from `.env.example` with generated
secrets, and runs database migrations. Then edit `.env`:

```ini
SARVAM_API_KEY=your-key-here        # leave empty to run calls without AI (original voices only)
BACKEND_INTERNAL_URL=http://127.0.0.1:8000   # change the port if 8000 is taken (e.g. 8010)
```

Manual equivalent:

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
npm --prefix frontend install
Copy-Item .env.example .env      # then fill in the values
.\.venv\Scripts\python backend\manage.py migrate
```

## Run (five terminals, from the repo root)

```powershell
# 1. LiveKit server (local dev mode; API key "devkey", secret "secret")
tools\livekit\livekit-server.exe --dev --bind 127.0.0.1

# 2. Django API
.\.venv\Scripts\python backend\manage.py runserver 127.0.0.1:8000

# 3. Translation worker
.\.venv\Scripts\python -m translation_worker.main start

# 4. Frontend
npm --prefix frontend run dev

# 5. Meeting job runner (transcription, translation, AI notes for recordings/uploads)
.\.venv\Scripts\python backend\manage.py process_meetings
```

Optional free local transcription (slow on small laptops, weaker Tamil):
`.\.venv\Scripts\pip install -r backend\requirements-local-stt.txt`, then pick *Local Whisper* when uploading
or set `MEETING_STT_ENGINE=local`. AI meeting notes need `ANTHROPIC_API_KEY` in `.env`.

Open <http://localhost:5173>. The port in terminal 2 must match `BACKEND_INTERNAL_URL` in `.env`
(the Vite dev server proxies `/api` there, and the worker reports usage there).

`translation_worker.main dev` also works (readable debug logs; the LiveKit Agents CLI marks it deprecated in favour of
`lk agent dev`). Note: `start` is production mode and declines new calls while machine CPU load is above 70 %;
on a busy development machine use `dev`.

### Linux / macOS

Same commands with `.venv/bin/python`, `./livekit-server --dev` (or `brew install livekit`), and
`cp .env.example .env`. With Docker you can run the server as
`docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0`.

## Using it

1. Person A registers, clicks **Start a call**, picks *Tamil*, and gets an 8-character invite code / link.
2. Person B registers, opens the link (or enters the code), picks *Hindi*, and joins.
3. Each person hears the other's translated voice; the original voice plays quietly underneath (adjustable, 0–100 %).
   Subtitles show each sentence with its translation. Use headphones for best results.
4. **End call** ends it for both and shows a summary with usage and measured latency.

**Meetings** (top menu): *New meeting* → **Live translate** (speak; see the live transcript and translation, optional
spoken translation), **Record** (microphone, pause/resume) or **Upload file**. Open a meeting to play it, click any line
to jump there, correct text, translate, generate AI notes, and export TXT / Word / PDF. During a call, **Save transcript**
(pressed by both people) saves the call's transcript to Meetings.

Calls between two people on different machines need the LiveKit server reachable by both (LiveKit Cloud, or a
self-hosted server with a public IP/TLS). The local `--dev` server is for same-machine/LAN testing.

## Tests

```powershell
# Backend (from backend/)
cd backend; ..\.venv\Scripts\python -m pytest -q; cd ..
# Worker (repo root)
.\.venv\Scripts\python -m pytest -q
# Frontend
npm --prefix frontend run typecheck; npm --prefix frontend test; npm --prefix frontend run build
```

All automated tests mock third-party APIs and spend no credits.

### Integration tests (real servers)

| Script | Needs | Verifies |
|---|---|---|
| `scripts\integration_call_test.py --backend http://127.0.0.1:8000` | LiveKit + backend | Register → create/join → tokens → two WebRTC clients hear each other; token refuses non-mic publishing; end call disconnects both |
| `scripts\integration_routing_test.py` | LiveKit | Worker session routing; each listener gets only its own translated track; cross-subscription refused; subtitles delivered |
| `scripts\sarvam_smoke_test.py [--save out]` | `SARVAM_API_KEY` | Real Sarvam STT → translate → TTS in both directions, with per-stage timings (spends < ₹1) |
| `scripts\integration_meeting_test.py --backend http://127.0.0.1:8000` | all services + job runner + `SARVAM_API_KEY` | Upload of a Tamil + Hindi recording → timestamped, translated transcript + TXT export; live meeting through LiveKit → segments saved with offsets (spends < ₹2) |

### Manual two-browser test (real translation — required before claiming it works)

1. Start all four processes with `SARVAM_API_KEY` set; run `scripts\sarvam_smoke_test.py` first.
2. Browser 1 (e.g. Chrome): register user A, start a call in Tamil. Browser 2 (Edge or a Chrome incognito window):
   register user B, join with the code in Hindi. Use **headphones** on at least one side, or two devices.
3. A says a Tamil sentence and stops. Check: B hears Hindi speech; B's subtitles show Tamil original + Hindi; A's
   subtitles show what B heard. Repeat B → A in Hindi.
4. Check *Settings → Original voice volume*, mute/unmute, changing language mid-call, and End call → summary
   (the summary table shows measured latency per stage).
5. Record results in [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## Configuration

All settings are environment variables — see [.env.example](.env.example) for the full list with comments. Key ones:

| Variable | Purpose |
|---|---|
| `TRANSLATION_ENABLED` | `false` disables **all** paid AI calls; calls still work with original voices |
| `SARVAM_API_KEY` | Sarvam credential (server-side only, never sent to browsers) |
| `SARVAM_STT_API` | `realtime` (default, partial transcripts) or `legacy` (older WebSocket) |
| `SARVAM_TTS_MODE` | `rest` (default, one request per sentence, pipelined) or `stream` (WebSocket, MP3 decoded locally) |
| `MAX_CALL_DURATION_SECONDS` | Hard per-call limit (worker ends the room, backend refuses new tokens) |
| `DAILY_*_LIMIT`, `PER_CALL_*_LIMIT` | Usage caps; when hit, translation stops and calls fall back to original voices |
| `LOCAL_SPEECH_GATE` | Don't stream silence to the (per-second billed) STT API |
| `MEETING_STT_ENGINE` | `sarvam` (default, paid per audio second) or `local` (faster-whisper, free) |
| `ANTHROPIC_API_KEY`, `SUMMARY_MODEL` | AI meeting notes (Claude); empty key = notes off, no charges |
| `MEETING_MAX_UPLOAD_MB`, `MEETING_MAX_DURATION_SECONDS` | Upload limits (default 200 MB, 2 h) |
| `INTERRUPT_ON_LISTENER_SPEECH` | Stop playing a translation to someone when they start speaking (default off: no content loss) |

## Documentation

- [docs/API.md](docs/API.md) — REST API reference
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, audio routing, feedback-loop prevention, latency design
- [docs/PROVIDER_EVALUATION.md](docs/PROVIDER_EVALUATION.md) — Sarvam API research, trade-offs, alternatives
- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) — known limitations, security/privacy, costs, production checklist
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md) — what was tested, measured results, what remains unverified
- [docs/MEETINGS.md](docs/MEETINGS.md) — Meeting Assistant: features, audio sources, architecture, AI-notes safety, costs, API
