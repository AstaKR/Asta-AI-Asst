# Dialer, call recording and hands-free face-to-face

## App-to-app dialer (free)

Call anyone who uses this app by **username** or **mobile number**: web *Dial* page, mobile *Dial → App users*.
Their app rings (web: a box on every page with a short ring; mobile: a card on Home and Dial, with
vibration). When they answer they join the normal translated call room. No phone line and no extra cost:
it uses the same LiveKit call as invite codes.

* A mobile number finds a person only if it is on their account (signed in by SMS, or an admin added a
  *Phone number* for them in Django admin).
* Unanswered calls become *Missed* after `DIRECT_CALL_RING_SECONDS` (45). Limits: `DIRECT_CALL_DAILY_LIMIT_PER_USER`
  (50 per day) and `DIRECT_CALL_RATE` (30 per hour), plus the existing plan and daily call limits.
* API: `POST /api/direct/calls/ {to, spoken_language, listen_language, video}`, `GET /api/direct/incoming/`,
  `POST /api/direct/calls/<id>/answer/` and `/decline/` (the caller uses decline to cancel), `GET /api/direct/calls/`.

**Limit:** the app must be open to ring (it checks every 3 s). Ringing with the app closed needs push
notifications (Firebase), which are not built yet.

Calling normal phone numbers stays under *Dial → Phone number* and still needs a paid SIP line (docs/TELEPHONY.md).

## Call recording (voices + transcript)

Either person presses **Record call**. The other person sees "*Name* wants to record this call" and
can **Agree** or say **No**. Recording starts only when **everyone** agreed; both screens then show
**● REC**. Pressing the button again stops it for everyone.

* The translation worker records what was said and the translated voices as one audio file, and uploads
  it when the call ends. It is saved with the call transcript in **Meetings** for each participant, with
  a player, timed transcript and downloads (TXT, Word, PDF, CSV, JSON, subtitles).
* Only the parts while everyone agreed are in the file; the rest is silence.
* Files are stored on your server (`media` volume), private to each participant, until they delete them.
* `CALL_RECORDING_ENABLED=false` keeps transcript saving but records no audio.
* Translation must be running in the call (the worker records the audio it receives). Phone (SIP) calls
  are not recorded.

**Legal:** recording people needs their consent. The app asks everyone, but you are responsible for
how recordings are used.

## Face-to-face (like an interpreter)

Web *Face to face* page and mobile *Tools → Face to face*. One device between two people.

* **Hold to talk:** each person holds their own button while speaking.
* **Hands-free:** press *Start listening*. The device notices when someone starts and stops speaking,
  works out from the language whether it was person A or B, and speaks the translation to the other.
  It does not listen while the translation plays. Best in a quiet place, one person at a time.
* Nothing said is stored. The two languages must be different (hands-free tells speakers apart by language).
