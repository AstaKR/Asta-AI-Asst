# Voice clone — research and recommended design (no code yet)

Goal: a caller hears the translation **in the speaker's own voice** instead of a stock Sarvam voice.
Researched October 2026. Prices and availability change — confirm with each provider before deciding.

## Providers

| Provider | Tamil / Hindi | How a voice is made | Access | Cost (indicative) | Fit |
|---|---|---|---|---|---|
| **Sarvam AI (Bulbul)** — current provider | Yes (Indian-language specialist) | Sarvam says a branded voice needs a 30–60 s sample plus explicit consent | Enterprise / contact sales; reviewers disagree whether self-serve exists | Quote | **Best first question**: no new vendor, same latency path, Indian languages. Ask whether *per-end-user* cloning is allowed, not only brand voices. |
| **ElevenLabs** | Hindi and Tamil reported on multilingual models (secondary sources) | Instant clone from ~1–2 min audio; Professional clone needs 30+ min and a live "voice captcha" read by the owner | Self-serve API | Starter ~$6/month for instant cloning; API around $0.05–0.10 per 1K chars (cut in 2026 — check official page) | Easiest to prototype; adds a second TTS vendor, foreign data processing, extra latency on calls. |
| **Google Cloud — Chirp 3 Instant Custom Voice** | hi-IN and ta-IN listed, each with a fixed consent statement | Short reference audio + a ≤10 s recorded consent statement (fixed script) | **Allow-listed users only** (apply via sales) | See Cloud TTS pricing | Strong consent model built in; approval needed. |
| **Microsoft Azure — Personal Voice** | hi-IN and ta-IN listed as personal-voice locales | Short sample + recorded verbal consent in the same language | Limited access (application) | Azure Speech pricing | Mature responsible-AI controls; approval needed. |

## Risks to design for

* **Impersonation / fraud** — a cloned voice speaking on phone calls is exactly what scam calls need. Cloning must be
  limited to the account holder's *own* voice, proven live.
* **Law (India)** — a voiceprint is personal data under the DPDP Act 2023 (explicit consent, purpose limitation,
  deletion on request). Government rules on labelling AI-generated ("synthetic") media are evolving; take legal
  advice before launch.
* **Call recipients** must know the voice is synthetic — the phone announcement already says the call is AI-translated;
  it should also say the voice is AI-generated.

## Recommended design (when we build it)

1. **Own voice only.** In the app: *Settings → My voice → Create*. The user reads a provider's fixed consent
   statement **live in the app** (no uploads, so nobody can clone a recording of someone else), then ~60 s of
   prompted sentences in their language.
2. **Verify the speaker matches the consent** (provider-side where offered — Google/Azure/ElevenLabs PVC do this).
3. **Store only the provider's voice ID**, never the raw samples after creation; show "Delete my voice" which deletes
   it at the provider too. Log creation/deletion.
4. **Use only in the user's own calls** as *their* outgoing translated voice; never selectable by another user.
5. **Plan-gated and admin-switchable** (Pro/Business, `VOICE_CLONE_ENABLED`), with a per-user monthly character cap.
6. **Disclosure**: announcement "This call is translated by AI and uses an AI-generated voice."

## Next step

Ask **Sarvam** first (existing account): is per-user, consent-based voice cloning available on the API for
Tamil/Hindi, at what price and latency? If not, apply for **Google Instant Custom Voice** or **Azure Personal Voice**
(both have Tamil + Hindi and built-in consent checks); use **ElevenLabs** only for a quick prototype.

## Sources

* Sarvam: [Bulbul v3](https://www.sarvam.ai/blogs/bulbul-v3), [Text to speech](https://www.sarvam.ai/text-to-speech), [Invideo review](https://invideo.io/blog/sarvam-bulbul-indian-tts/), [MediaNama on privacy](https://www.medianama.com/2025/05/223-sarvam-ai-bulbul-v2-tts-launch-privacy-challenges/)
* ElevenLabs: [pricing overview](https://magichour.ai/blog/elevenlabs-pricing), [India pricing / Hindi](https://zoutons.com/news/elevenlabs-pricing-india-may-2026), [2026 review](https://www.coval.ai/blog/elevenlabs-review-2026-voice-cloning-and-synthesis-capabilities-explained/)
* Google: [Chirp 3 Instant Custom Voice](https://docs.cloud.google.com/text-to-speech/docs/chirp3-instant-custom-voice)
* Azure: [Personal voice overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-overview), [consent](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-create-consent), [language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)
* Comparison: [MarkTechPost — voice cloning APIs 2026](https://www.marktechpost.com/2026/09/21/best-voice-cloning-apis-in-2026-speaker-similarity-consent-checks-and-price-per-1m-characters/)
