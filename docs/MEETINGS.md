# Meeting Assistant (recording, transcripts, translation, AI notes)

Added on top of the existing AI Call Translator without changing its call flow. New code: `backend/meetings/`,
`frontend/src/components/meetings/`, `frontend/src/pages/Meeting*.tsx`, live-meeting mode in `translation_worker/`.

## Features

| Feature | How |
|---|---|
| Live translation (Tamil, English, Hindi — any pair) | **Live translate** tab: LiveKit room in *meeting* mode; the worker transcribes your speech live, translates it, optionally speaks it (voice playback), and shows original + translation side by side. The browser records the same microphone so the saved meeting has audio. |
| Recording | **Record** tab: browser microphone with Start / Pause / Resume / Stop, then upload (WebM/Opus; MP4/AAC on Safari). |
| Upload | **Upload file** tab: WAV, MP3, M4A/MP4, AAC, WebM, OGG/Opus, FLAC — validated by actually decoding (not by name), size limit (`MEETING_MAX_UPLOAD_MB`, default 200) and duration limit (`MEETING_MAX_DURATION_SECONDS`, default 2 h). |
| Translated calls | During a call, **Save transcript** — saved only after *both* participants press it; each gets their own copy in Meetings. |
| Timestamped transcripts | Audio is split at pauses (≤ 25 s pieces); each segment's start/end come from its sample offsets in the original file, so offsets stay exact however the audio is chunked. Live segments are timed from the moment the browser recording started. |
| Mixed-language speech | `spoken_language=auto` + Sarvam `codemix` mode: each segment gets its own detected language; English words inside Tamil/Hindi stay in English. |
| Original vs translation | Stored in separate fields (`original_text`, `translated_text`); translating again never alters the original. |
| Corrections | Edit any segment inline (marked "edited"). |
| Click-to-seek | Clicking a timestamp or a note citation seeks the player. Playback uses a server-made constant-bitrate MP3 copy (browser WebM recordings are often not seekable) served with HTTP Range support. |
| AI meeting notes | Short summary, key points, decisions, action items (owner / deadline only when explicitly stated), open questions — in English, Tamil or Hindi. |
| History | Search titles, transcripts, translations and notes; filter by date range, language, status; paginated (20 per page). Users only ever see their own meetings (other users' IDs return 404). |
| Exports | TXT and Word (DOCX) from the server; PDF via **Print / Save as PDF** (browser printing renders Tamil and Devanagari correctly; server PDF libraries generally don't shape Indic scripts). |

## Audio sources — what is and isn't possible

| Source | Supported | Notes |
|---|---|---|
| This device's microphone (browser) | Yes | Record and Live tabs |
| Audio files | Yes | Upload tab |
| Translated calls in this app (LiveKit) | Transcript yes, audio no | Both participants must consent. Call *audio* recording would need LiveKit Egress (not set up). |
| Computer system audio (Zoom/Teams playing on the PC) | No | Browsers cannot capture other apps' audio. Workaround: record with the OS/meeting app and upload the file. |
| Normal mobile phone calls | No | Android/iOS block apps from call audio. Workaround: phone's own call recorder (where legal and consented) → upload; or the telephony bridge (see TELEPHONY_PROVIDERS.md). |

## Architecture

```
Upload / Record ──► POST /api/meetings/ ──► file saved privately (MEDIA_ROOT) ──► MeetingJob(transcribe)
                                                                                    │
                   manage.py process_meetings (DB-backed job runner, no Redis) ◄────┘
                     1. playback MP3   2. decode → 16 kHz → split at pauses   3. STT per piece (Sarvam REST)
                     4. translate per segment   5. (optional) AI notes (Gemini or Claude)

Live translate ──► POST /api/meetings/live/ → CallRoom(mode=meeting) → LiveKit token → worker joins
                     worker: STT → (translate) → (TTS to you) ──► POST /api/internal/meeting-segments/
                     browser: MediaRecorder on the same mic ──► POST /api/meetings/{id}/audio/ when you stop
```

- **Why a job runner:** transcription takes minutes, so it can't run inside a web request; the existing stack has
  no queue, and a DB-backed runner (atomic claim, retries for transient errors, stale-job recovery) avoids adding
  Redis/Celery. Several runners can run in parallel safely.
- **Provider interfaces:** `meetings/transcription/` (Gemini, Sarvam) and `meetings/summary/` (Gemini, Claude;
  `SUMMARY_PROVIDER`, which recall follows too). Shared Gemini REST call: `meetings/gemini_client.py`.
  Adding another provider (e.g. OpenAI) means one new module plus one line in `get_summarizer()`.
- **Language codes:** meetings use `ta`, `en`, `hi`; providers get BCP-47 (`ta-IN`, …) via `meetings/languages.py`.

## AI notes safety ("never invent")

The model must cite segment numbers for every item and copy the exact words that name an owner or deadline.
`meetings/summary/schema.py::ground()` then removes items with no valid citation and blanks any owner/deadline whose
quote is not found in the cited segments (original or translation). Output is constrained by a JSON schema and
validated with Pydantic before saving.

## Engines, accuracy, latency, cost

| | Sarvam |
|---|---|
| Tamil / Hindi quality | Built for Indian languages; verified on test sentences (exact transcripts) |
| Mixed speech | `codemix` mode |
| Speed | Paced at ~1 request/s (60/min plan limit): ~1 min of processing per ~1 min of speech |
| Cost | ₹30 per hour of audio (silence is not billed) + ₹20 per 10K translated chars |

Notes default to Gemini (`SUMMARY_PROVIDER=gemini`, `gemini-2.5-flash`, $0.30 / $2.50 per million input/output
tokens, thinking billed as output). With live notes refreshed every ~90 s (about 40 calls an hour) an hour-long
meeting costs roughly **₹30** for notes. `SUMMARY_PROVIDER=anthropic` uses Claude (`claude-opus-5-5`, $4 / $20),
roughly ₹220 for the same hour. Disabled when the chosen provider's key is empty.

Measured (real Sarvam, 26 Oct 2026, `scripts/integration_meeting_test.py`): a 7.5 s Tamil + Hindi upload produced two
correctly transcribed and translated segments with the right offsets; 5.8 s billed. Live meeting: the Tamil sentence
was transcribed + translated live and stored at the correct offset.

## Limits and switches

`MEETING_MAX_UPLOAD_MB`, `MEETING_MAX_DURATION_SECONDS`, daily AI budget shared with calls (`DAILY_STT_SECONDS_LIMIT`,
`DAILY_TRANSLATE_CHARS_LIMIT` — meeting usage now counts toward them),
`SUMMARY_PROVIDER=none` or an empty key for the chosen provider (no summary cost), `TRANSLATION_ENABLED=false` (no live AI).

## Privacy

- Saved only after explicit consent (checkbox; both people for calls). Kept until the owner deletes the meeting
  (deleting removes the audio files too). Files live outside any static/public folder and are streamed only to their owner.
- Audio and text are sent to Sarvam AI (speech, translation); meeting audio and transcripts to Google (Gemini) for speaker labels, notes and recall (Anthropic instead when
  `SUMMARY_PROVIDER=anthropic`).
- Logs never contain transcript text.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meetings/config/` | engines available, summaries enabled, limits |
| GET / POST | `/api/meetings/` | history (`q`, `language`, `status`, `source`, `date_from`, `date_to`, `page`, `page_size`) / upload (multipart: `file`, `title`, `spoken_language` auto/ta/en/hi, `translation_language`, `engine`, `consent=true`) |
| GET / PATCH / DELETE | `/api/meetings/{id}/` | detail (segments, notes, action items) / rename, notes language / delete with files |
| GET / POST | `/api/meetings/{id}/audio/` | stream (Range) / attach the recording of a live session |
| POST | `/api/meetings/{id}/transcribe/` | re-run or retry (`engine` optional) |
| POST | `/api/meetings/{id}/translate/` | `{language}` |
| POST | `/api/meetings/{id}/summarize/` | `{language?}` → background job; `503 summaries_disabled` without a key |
| PATCH | `/api/meetings/{id}/segments/{index}/` | correct `original_text` / `translated_text` / `speaker` |
| PATCH | `/api/meetings/{id}/action-items/{item}/` | `done`, `text`, `owner_name`, `deadline` |
| GET | `/api/meetings/{id}/export/?kind=txt\|docx` | download |
| POST | `/api/meetings/live/` | start a live session → `{meeting, room_code}`; then `POST /api/rooms/{code}/token/` |
| POST | `/api/meetings/{id}/live-started/` | `{recording_started_at_ms}` |
| POST | `/api/rooms/{code}/transcript/` | call transcript consent `{save}` |
| POST | `/api/internal/meeting-segments/` | worker only (`X-Worker-Secret`) |

## In-person group meetings (Gemini speaker labels, no LiveKit)

LiveKit is used for calls only. A **Live meeting** is one phone or laptop recording the room:

- The device records in ~40-second chunks; each chunk is sent to `POST /api/meetings/{id}/chunk/` and transcribed by
  **Gemini** (`MEETING_STT_ENGINE=gemini`, key `GEMINI_API_KEY` or Admin → API keys). Lines come back labelled
  `Speaker 1`, `Speaker 2`...; the last lines of the previous chunk are passed along so labels stay steady. Rename a
  speaker by editing a segment.
- **Live notes**: `POST /api/meetings/{id}/live-notes/` refreshes the AI notes (Gemini by default) from what has been said so far
  (the apps call it about every 90 s).
- **End meeting**: `POST /api/meetings/{id}/finish/` joins the chunks into one MP3 for playback and queues the final notes.
- **Recall**: `POST /api/meetings/ask/ {"question": "..."}` answers from the user's own meetings (notes, action items and
  matching transcript lines) with the meeting and timestamp it came from.
- Gemini's speaker labels are best-effort (Google marks 3+ speakers as experimental). Test with a real Tamil/Hindi
  recording before relying on it. Set `MEETING_STT_ENGINE=sarvam` to go back to Sarvam (no speaker labels).
- Gemini speech-to-text is not counted against the Sarvam daily budget; Gemini and Claude usage is billed by those providers.
- Google's pricing page says `gemini-2.5-flash` requests are routed to Gemini 3.5 Flash-Lite from 1 Dec 2026. To
  choose the model yourself, set `MEETING_GEMINI_MODEL` and `SUMMARY_MODEL`, then re-test transcripts and notes.
