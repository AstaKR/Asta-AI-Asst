# AI Call Translator — mobile app (Expo / React Native)

Android first; the code also targets iPhone (needs an Apple developer account and a Mac or EAS to build).

## Status

| | |
|---|---|
| TypeScript typecheck, `expo-doctor` (20/20), Android JS bundle export | Passing |
| Running on a real phone | **Not yet tested** — this PC has no Android SDK; build with EAS (below) |
| Phone login by SMS | Works with `SMS_BACKEND=console` in development (the code appears in the backend log). Real SMS needs a DLT-registered provider |
| Translating normal phone calls (call forwarding) | Screen and forwarding codes are ready; works once the telephony line is connected (`PHONE_FORWARDING_NUMBER`) |
| Background calls / ringing incoming calls | Not yet (needs a foreground service + push notifications — later step) |

## Screens

Sign in with mobile number + OTP → Home (choose language, start call, join by code, recent calls) → Call
(subtitles, mute, speaker/earpiece, end) → Summary. Also *Translate my phone calls* (call-forwarding guide) and
*Settings* (name, language, original-voice level, subtitles, usage, sign out).

**Phone calls** (Home → *Call a phone number*): dial pad for Indian numbers; the call goes out through the
server's SIP line and both sides hear the translation. Forwarded or dialled-in calls appear on Home as an
*Incoming call* card with Answer / Decline while the app is open (ringing with the app closed needs push
notifications — later). Works once the server's phone line is set up (`docs/TELEPHONY.md`).

**Video calls** (Home → *Video call*): same translation as voice calls, plus camera (360p to save data), self
view, the latest translated line as a caption over the video, camera on/off and flip, loudspeaker by default.
Needs the camera permission — included from the build after `blockedPermissions: CAMERA` was removed.

**Face to face** (Home): one phone on the table between two people. Each half has its own language and a
*Hold to speak* button; the top half is upside down for the person opposite. The translation appears on the
other half and is spoken aloud (switch in the middle). **Instant translate**: type (choose the From language) or
hold to speak (language detected automatically), then play or copy the result. Up to 30 s per phrase; nothing
is stored on the server except usage numbers. Uses the same native modules as Meetings — no new build needed.

**AI assistant** (Home): chat with Claude about words, phrases, polite replies and how to use the app; choose
the answer language, hold the mic to dictate, tap *Listen* to hear an answer (Sarvam voice) or *Copy*. The
conversation stays on the phone. **Photo translate**: take a photo or choose an image (signs, menus, letters,
screenshots), crop it, and get the text line by line with its translation. Both need `ANTHROPIC_API_KEY` on
the server; photos use `expo-image-picker` / `expo-image-manipulator` (native — included in the next build).

**Meetings** (Home → *Meetings & recordings*):
- History: search titles/transcripts/notes, filter by language or status, pull to refresh.
- New meeting: *Live translate* (live transcript + translation through the translation worker; the phone saves the
  transcript, not the audio), *Record* (phone microphone, pause/resume, mono 64 kbps .m4a, uploaded for
  transcription), *Upload* (pick an audio file). Recording requires the consent switch.
- Detail: audio player with ±10 s, transcript (tap a line to play from there, long-press to correct it),
  translate into another language, AI notes with action items (when `ANTHROPIC_API_KEY` is set on the server),
  TXT / Word export via the share sheet, delete. PDF stays in the web app's print view.

Meetings use `expo-audio`, `expo-document-picker`, `expo-file-system` and `expo-sharing` — native modules, so a
development build made **before** these were added will not run the meetings screens; build a new one.

## Run a development build

LiveKit needs native code, so the app cannot run in Expo Go. Two options:

**A. Cloud build with EAS (no Android Studio needed)**

```bash
cd mobile
npx eas-cli@latest login            # free Expo account
npx eas-cli@latest build --profile development --platform android
```

Install the APK from the link on your Android phone. Then on the PC:

```bash
npx expo start --dev-client
```

Open the app on the phone and connect to the dev server (same Wi-Fi).

**B. Local build** — install Android Studio (SDK + emulator), then `npx expo run:android`.

## Pointing the app at your backend

Create `mobile/.env`:

```ini
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000     # your PC's Wi-Fi IP while testing
```

For testing on a real phone against your PC, the phone must reach both servers:

- run Django on all interfaces: `.\.venv\Scripts\python backend\manage.py runserver 0.0.0.0:8000`, and add the PC's IP to `DJANGO_ALLOWED_HOSTS`;
- LiveKit: either use **LiveKit Cloud** (simplest — set `LIVEKIT_URL/KEY/SECRET` in the root `.env`), or run
  `tools\livekit\livekit-server.exe --dev --bind 0.0.0.0 --node-ip <PC IP>` and set `LIVEKIT_URL=ws://<PC IP>:7880`;
- allow those ports through Windows Firewall.

For release builds (`--profile preview` APK or `production` AAB), set the HTTPS backend URL in `eas.json`.

## Checks

```bash
npm run typecheck
npx expo-doctor
```

Shared logic (`src/lib/audioPolicy.ts`, `translatorEvents.ts`, `languages.ts`, `meetings.ts`) is a copy of
`frontend/src/lib/` — keep both copies identical (the web copy has the unit tests).
