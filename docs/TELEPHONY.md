# Phone calls (dial out + incoming forwarded calls)

Normal phone calls are bridged into the same translated call rooms as app calls, using **LiveKit SIP**.
The translation worker already treats a phone caller as a participant of kind `sip` (language detected from
speech, `PHONE_DEFAULT_LANGUAGE` until then, AI notice played first).

```
Outgoing:  App dial pad → POST /api/phone/dial/ → backend creates room (+ translator) → LiveKit SIP rings the number
Incoming:  Caller → provider number (or forwarded mobile) → SIP trunk → LiveKit SIP → room "phone-…"
           → LiveKit webhook → backend finds the owner, creates the call, sends the translator → app shows "Incoming call"
```

Status: **code complete and unit-tested (24 tests), not yet tested with a real line.** Everything is off
until `TELEPHONY_ENABLED=true`.

## What you need

| Item | Notes |
|---|---|
| SIP trunk + Indian number | Exotel or Plivo (both on LiveKit's tested-provider list). Paid: number rent + per-minute. See `TELEPHONY_PROVIDERS.md` for questions to ask, including the regulatory one. |
| Linux server with a public IP | Runs LiveKit + LiveKit SIP + Redis (`deploy/docker-compose.livekit.yml`). LiveKit SIP is not available for Windows; for local trials use Docker/WSL on a machine reachable from the provider. |
| Open ports | 7880/tcp (behind TLS), 7881/tcp, 50000–60000/udp, 5060 udp+tcp (allow only the provider's IPs), 10000–20000/udp |

## Setup

1. **Start LiveKit + SIP** on the server (fill `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `APP_DOMAIN` in `.env`):
   ```bash
   docker compose -f deploy/docker-compose.livekit.yml --env-file .env up -d
   ```
   LiveKit sends webhooks to `https://<APP_DOMAIN>/api/phone/livekit-webhook/` (signed with your API key —
   the backend rejects unsigned requests).
2. **Point the provider's trunk** at `sip:<server public IP>:5060` (inbound) and get the outbound SIP domain,
   username and password from the provider.
3. **Create the LiveKit trunks and dispatch rule** — set the `SIP_*` values in `.env`, then:
   ```bash
   python backend/manage.py setup_sip --dry-run
   python backend/manage.py setup_sip
   ```
   Put the printed outbound trunk ID in `LIVEKIT_SIP_OUTBOUND_TRUNK_ID`, set `TELEPHONY_ENABLED=true`, restart the backend.
4. **Decide how incoming calls find their owner** (`PHONE_FORWARDED_FROM_ATTRIBUTE`):
   * **Dedicated number per user (always works):** add a *Phone line* in Django admin (number → user). Calls to that
     number ring that user. Users forward their mobile to their own line (*Translate my phone calls* screen shows it).
   * **One shared number + forwarding header:** only if the provider adds the forwarding subscriber's number in an
     `X-*` header (LiveKit maps only `X-*` headers to attributes). Set `SIP_FORWARDED_FROM_HEADER` to that header before
     `setup_sip`. The number is matched against users' verified login numbers. **Confirm with the provider first.**

## Safety and cost controls

* Outgoing calls only to `PHONE_DIAL_ALLOWED_PREFIXES` (default `+91`) — blocks international/premium toll fraud.
* `PHONE_DIAL_DAILY_LIMIT_PER_USER` (20), `DIAL_RATE` throttle, and the existing daily call/AI budgets.
* Incoming calls to unknown numbers, or when the daily budget is used up, are hung up immediately.
* Unanswered incoming calls are hung up after `PHONE_RING_SECONDS` and shown as *Missed*.
* Phone rooms cannot be joined by invite code. Call history (numbers) is visible only to the owner.
* The caller hears the AI-processing announcement before translation starts (`PHONE_ANNOUNCEMENT`).

## Limits of this version

* The app shows incoming calls only while it is open (polling every 3 s). Ringing with the app closed needs push
  notifications and Android's full-screen call notification — a later step.
* Whether forwarding a personal mobile number to an AI-bridged line is allowed for your use case is a regulatory
  question for the provider (see `TELEPHONY_PROVIDERS.md`).

## API

| Endpoint | |
|---|---|
| `GET /api/phone/config/` | enabled, dial_enabled, my_lines, allowed_prefixes |
| `POST /api/phone/dial/` | `{number, spoken_language, listen_language, caller_language}` → call with `room_code` |
| `GET /api/phone/incoming/` | ringing incoming calls for me |
| `POST /api/phone/calls/<id>/answer/` · `/decline/` · `/connected/` | |
| `GET /api/phone/calls/` | my recent phone calls |
| `POST /api/phone/livekit-webhook/` | LiveKit only (signed) |
