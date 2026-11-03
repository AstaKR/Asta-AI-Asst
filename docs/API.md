# REST API

Base path `/api/`. JSON in and out. Authentication is a Django **session cookie**; every unsafe request
(POST/PUT/PATCH/DELETE) must send `X-CSRFToken` with the value of the `csrftoken` cookie
(obtain it with `GET /api/auth/csrf/`). The SPA calls the API through the Vite proxy, so it is same-origin.

Errors: `{"detail": "...", "code": "..."}` or DRF field errors `{"field": ["message"]}`.
Unauthenticated requests get `403`. Throttled requests get `429`.

## Public

| Method | Path | Description |
|---|---|---|
| GET | `/health/` | `{"status":"ok","database":true,"livekit_configured":true,"translation_enabled":true}`; `503` if the DB is down |
| GET | `/languages/` | Supported languages (`ta-IN`, `hi-IN`, `en-IN`), voices, `translation_enabled` |
| GET | `/auth/csrf/` | Sets the `csrftoken` cookie |
| POST | `/auth/register/` | `{username, password, display_name?}` → user; logs in. Throttle: `auth` 20/hour. Django password validators apply |
| POST | `/auth/login/` | `{username, password}` → user. Throttle: `auth` |

## Authenticated

| Method | Path | Description |
|---|---|---|
| POST | `/auth/logout/` | `204` |
| GET | `/auth/me/` | `{id, username, preferences}` |
| GET / PUT | `/preferences/` | `{display_name, spoken_language, listen_language, voice, show_subtitles, original_voice_volume (0-100)}`; PUT is partial; languages/voices validated |
| GET | `/rooms/` | Your 20 most recent calls (member view) |
| POST | `/rooms/` | `{spoken_language, listen_language, voice?}` → creates a call, you are host. `429 daily_call_limit` if today's call-time budget is used. `translation_enabled` is false if AI is disabled or today's AI budget is used. Throttle: `room_create` (default 10/hour) |
| GET | `/rooms/{code}/` | Members: full room. Non-members: preview `{code, status, translation_enabled, host_name, participant_count, invite_expires_at}` |
| POST | `/rooms/{code}/join/` | `{spoken_language, listen_language, voice?}`. `409 room_full` (2 participants), `410 room_ended` / `invite_expired`. Re-joining updates your languages |
| POST | `/rooms/{code}/token/` | Members only. Returns `{token, url, identity, expires_in, room}`. Starts the call clock on first use. `410` if ended or over the duration limit; `503` if LiveKit is not configured. Throttle: `token` (30/hour) |
| PATCH | `/rooms/{code}/languages/` | Change your languages mid-call; pushed to LiveKit participant attributes so the worker re-routes. Returns room + `live_update_applied` |
| POST | `/rooms/{code}/leave/` | Marks you as left (`204`) |
| POST | `/rooms/{code}/end/` | Ends the call for everyone (deletes the LiveKit room) |
| GET | `/usage/` | `{today, daily_limits, per_call_limits, max_call_duration_seconds, translation_enabled, mine}` |

### Room object

```json
{
  "code": "K7P2QX9M", "status": "waiting|active|ended", "translation_enabled": true,
  "max_duration_seconds": 600, "invite_expires_at": "…", "created_at": "…", "started_at": "…|null",
  "ended_at": "…|null", "end_reason": "ended_by_participant|max_call_duration|",
  "duration_seconds": 93,
  "participants": [{"identity": "user-1", "display_name": "Anand", "role": "host",
                    "spoken_language": "ta-IN", "listen_language": "ta-IN", "voice": "shubh",
                    "is_you": true, "left_at": null}],
  "usage": {"stt_seconds": 41.2, "translate_chars": 380, "tts_chars": 402, "provider_requests": 31,
            "provider_errors": 0, "utterances": 12, "dropped_utterances": 0, "reconnects": 0,
            "latency": {"end_to_audio_ms": {"count": 12, "avg": 0, "p50": 0, "p95": 0, "max": 0}},
            "finalized": true, "updated_at": "…"}
}
```

### LiveKit token contents

Short-lived JWT (`LIVEKIT_TOKEN_TTL_SECONDS`, default 600 s — only needs to be valid at connect time):

- `roomJoin` for exactly one room, `canPublishSources: ["microphone"]`, `canPublishData: false`,
  `canUpdateOwnMetadata: false` (participants cannot alter their language attributes)
- attributes `{role, display_name, spoken_language, listen_language, voice}` — signed, used by the worker for routing
- `roomConfig`: `max_participants = MAX_PARTICIPANTS + 1`, and (if translation is enabled) an explicit dispatch of
  agent `AGENT_NAME` with metadata `{room_code, max_duration_seconds, per_call_limits, started_at}`

## Internal (worker → backend)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/internal/usage/` | header `X-Worker-Secret: $WORKER_SHARED_SECRET` (disabled if unset) | Body: cumulative `{room_name, stt_seconds, translate_chars, tts_chars, provider_requests, provider_errors, utterances, dropped_utterances, reconnects, latency, final}`. Totals never decrease. Response `{"allowed": bool, "reason": "…"}`; when `allowed` is false the worker stops all paid processing for that call. Reasons: `per_call_*_limit`, `daily_*_limit`, `max_call_duration`, `room_ended` |

## Data channel (worker → participants)

Topic `translator`, reliable, addressed only to the call's participants. JSON messages:

- `{"type":"status","state":"ready|disabled|listening|transcribing|translating|speaking|idle|interrupted|reconnecting|error|limit|warning","speaker?","listener?","message?"}`
- `{"type":"subtitle","stage":"partial|final|translation|skipped","utterance_id","speaker","listener","language","text","original?"}`
- `{"type":"metrics","utterance_id","speaker","end_to_audio_ms","first_transcript_ms","translation_ms","tts_first_chunk_ms","utterance_total_ms"}`

The client ignores `translator` messages not sent by an agent participant.
