# Speech provider evaluation

Research date: 2026-10-21, from Sarvam's official documentation (docs.sarvam.ai). Nothing below has yet been
confirmed against the live API with real credentials — see [TEST_REPORT.md](TEST_REPORT.md).

## Sarvam AI (selected)

| Need | Sarvam API used | Notes |
|---|---|---|
| Streaming STT | `wss://api.sarvam.ai/speech-to-text-realtime/ws`, model `saaras:v3-realtime` | linear16 PCM, 8/16 kHz mono, base64 in JSON `{"event":"audio_input","audio":…}`. Server VAD (`endpointing=vad`, `silence_duration_ms` default 500), partial + final transcripts, `vad.speech_start/end` events, `session.end` reports billed audio seconds. Ta + Hi + 21 others. Close 1003 = rate/quota/key, 1008 = inactivity, 4000 = rejected config (may include "beta access denied") |
| Fallback STT | `wss://api.sarvam.ai/speech-to-text/ws` (legacy), `saaras:v3` | `SARVAM_STT_API=legacy`. Final transcripts only (no partials), START/END_SPEECH signals. The schema lists `encoding: "audio/wav"` while `input_audio_codec=pcm_s16le` declares raw PCM — **least certain part of the integration** |
| Speech-to-English translate | same STT with `mode=translate` | English output only — not usable for Tamil↔Hindi directly |
| Text translation | `POST /translate`, `mayura:v1` (1000 chars) or `sarvam-translate:v1` (2000 chars) | Indic↔Indic supported; Ta↔Hi not shown in an explicit example. Optional `mode` (e.g. `modern-colloquial`, mayura only) via `SARVAM_TRANSLATE_MODE` |
| TTS | `POST /text-to-speech`, `bulbul:v3`, field `language_code`, `speaker`, `speech_sample_rate` | Returns base64 WAV in `audios[]`. 30 req/min for bulbul:v3 on the starter plan |
| Streaming TTS | `wss://api.sarvam.ai/text-to-speech/ws` | config/text/flush messages; docs say **only MP3 is currently supported for streaming**, so the worker decodes MP3 → PCM (`SARVAM_TTS_MODE=stream`). No server-side cancel: barge-in closes the socket |
| Auth | `api-subscription-key` header | 403 `invalid_api_key_error` |
| Credits | 429 `insufficient_quota_error` (never retried) vs 429/503 `rate_limit_exceeded_error` (retried once) | |

### Pricing (published, may change — do not assume free credit persists)

- STT ₹30 / hour of audio (billed per second) · Translation ₹20 / 10K chars · TTS bulbul:v3 ₹30 / 10K chars
- New accounts: ₹100 credit
- **Rough estimate** for a 10-minute call where each person speaks ~40 % of the time: ~8 min of STT audio
  (≈ ₹4), ~6K chars translated (≈ ₹12), ~6K chars synthesised (≈ ₹18) → **≈ ₹30–35 per 10-minute call**.
  Real figures are recorded per call in the usage summary; replace this estimate after integration testing.

### Rate limits (starter plan)

STT WebSocket: 20 concurrent connections (each active direction uses one) · Translate 60/min · TTS bulbul:v3 30/min.
Two directions per call → ~10 concurrent calls max on STT; TTS per-minute limit is the tighter bound under load.

### Why Sarvam

Tamil and Hindi are first-class (Indian-built models, Indian accents, code-mixed speech), all three stages are
available from one vendor with one key, there is a documented realtime STT socket with VAD and partials, and
pricing is low in INR. Data processing happens with an Indian provider (relevant for Indian users' expectations).

### Risks / open questions

- `saaras:v3-realtime` may be gated ("beta access denied" is a documented 4000 close reason) → fall back to `legacy`.
- Quality of colloquial Tamil→Hindi translation via `mayura:v1` is unmeasured; `sarvam-translate:v1` is an option.
- STT finalisation delay is governed by `silence_duration_ms` (500 ms default): lower = faster but splits sentences.

## Alternatives considered (not implemented)

| Option | Pros | Cons |
|---|---|---|
| Google Cloud STT v2 + Translation + TTS | Mature streaming, both languages, global infra | Card required, higher cost, three products to configure |
| Azure Speech Translation (speech-to-speech) | Single streaming speech-translation API | Tamil voice/translation coverage and quality must be checked; card required |
| OpenAI realtime / Whisper + LLM + TTS | Strong ASR; flexible translation | Tamil TTS voices and Indic latency/cost are weaker fits; turn-based for Whisper |
| AI4Bharat IndicConformer / IndicTrans2 / Indic-Parler-TTS (self-hosted) | Free/open, Indic-focused | Needs GPU hosting and ops; latency engineering on us |

The provider interface (`translation_worker/providers/base.py`) lets any of these be added as a new module without
changing routing, pipeline, UI or backend.
