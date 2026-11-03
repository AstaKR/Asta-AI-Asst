# Known limitations, privacy, costs and production checklist

**This build is a working prototype, not production-ready.** Real AI translation has not yet been verified
end to end with credentials and real users (see [TEST_REPORT.md](TEST_REPORT.md)).

## Known limitations

- Only calls made inside this app (WebRTC). No PSTN/SIM or WhatsApp calls.
- Two participants per call; languages ta-IN, hi-IN, en-IN (the pipeline supports any Sarvam language; the UI and
  backend whitelist three).
- Translation is per completed utterance, not simultaneous: expect a delay of roughly "end of sentence +
  STT finalisation + translation + first TTS audio". Not yet measured with the real provider.
- Long monologues are translated only after the speaker pauses (server VAD). Overlapping speech from both people is
  translated, but the listener may hear translation while talking (barge-in is off by default).
- Echo guard is heuristic; speakers without headphones and without good AEC can still cause occasional echo.
- `SARVAM_STT_API=legacy` and `SARVAM_TTS_MODE=stream` are implemented from docs but have lower confidence.
- Local `livekit-server --dev` is not reachable from other devices without network configuration; use LiveKit Cloud
  or a properly deployed server for real two-device calls.
- Accounts are username/password only; no email verification, password reset, or social login.
- Usage limits are global per deployment (budget protection), not per user.
- Browser support: tested build targets evergreen browsers; output-device selection works only where
  `setSinkId` exists (Chrome/Edge). Mobile Safari autoplay requires the "Tap to enable call audio" button.

## Security & privacy defaults

- Secrets only in `.env` (git-ignored); `.env.example` contains placeholders. Browser never sees LiveKit or Sarvam keys.
- LiveKit tokens: 10-minute TTL, one room, microphone-only publishing, no data publishing, no self-metadata changes.
  Membership is checked server-side before issuing tokens; rooms are capped at 2 humans + 1 agent.
- Agent dispatch is explicit (by agent name, via token room config) — the worker joins only backend-created rooms.
- Translated tracks are permissioned per listener at the SFU.
- Session cookies are HttpOnly + SameSite=Lax; CSRF enforced; production enables Secure cookies, HSTS, SSL redirect.
- Rate limits: register/login 20/h, room creation 10/h, tokens 30/h, general 300/min per user.
- Internal usage endpoint requires `X-Worker-Secret` (constant-time compare) and is disabled if unset.
- **No recording. No audio or transcript storage.** Only counters and latency statistics are stored. Logs never
  contain transcript text or audio; the worker logs latency numbers and error classes only.
- Subtitles travel over LiveKit data packets addressed only to the two participants and are not persisted.

### External AI processing (disclose to users)

While translation is active, each participant's speech audio is streamed to Sarvam AI (India) for recognition,
and the recognised text is sent for translation and speech synthesis. Sarvam's own retention and processing terms
apply — review them (and your organisation's policy, and India's DPDP Act obligations) before real use. The UI shows
an AI-translation notice on the language-selection screens and the call screen shows when translation is active.

### Before enabling recording or transcript retention (not implemented)

Require explicit opt-in consent from **both** participants before the call starts, show a persistent recording
indicator, store consent records (who, when, what), define retention/deletion periods, encrypt at rest, and restrict
access. Do not add this without legal review.

## Cost control (implemented)

Per-call duration limit · max participants · local silence gate before STT · no TTS/translation for empty, duplicate
or same-language text · per-call STT/translate/TTS caps · global daily caps · backend-confirmed usage every 15 s ·
credit exhaustion stops processing without retries · `TRANSLATION_ENABLED=false` kill switch · usage dashboard
(*Settings → Usage*) and per-call summary. To stop all paid usage immediately: set `TRANSLATION_ENABLED=false`
(or remove `SARVAM_API_KEY`) and restart the worker.

## Production checklist

- [ ] Real-credential smoke test and two-device call test pass; latency recorded in TEST_REPORT.md
- [ ] PostgreSQL (`DATABASE_URL=postgres://…`, `pip install "psycopg[binary]"`), migrations in CI/CD
- [ ] `DJANGO_DEBUG=false`, strong `DJANGO_SECRET_KEY`, correct `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`
- [ ] Serve Django with gunicorn/uvicorn behind HTTPS (reverse proxy sets `X-Forwarded-Proto`); `collectstatic`
- [ ] Build the SPA (`npm run build`) and serve it from the same origin as `/api` (or configure CORS + cookies accordingly)
- [ ] Shared cache (Redis) for DRF throttling across processes (LocMem is per-process)
- [ ] LiveKit Cloud or self-hosted LiveKit with TLS (`wss://`), TURN enabled, real API key/secret
- [ ] Run the worker with `python -m translation_worker.main start` under a process manager; scale horizontally
- [ ] Secret management (not plain `.env` on servers); rotate keys; separate dev/prod Sarvam keys with spending limits
- [ ] Monitoring: worker errors, provider error rates, latency p95, usage vs budget alerts
- [ ] Account hardening: email verification, password reset, lockout, optional SSO
- [ ] Privacy review: user-facing privacy notice, provider DPA/terms, DPDP compliance
- [ ] Load test concurrency against provider rate limits (STT 20 concurrent sockets, TTS 30/min on starter plan)
- [ ] Accessibility review of the call screen (keyboard, screen reader live regions) and mobile device testing
