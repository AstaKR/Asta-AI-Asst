# Local AI — free open-source engines (no paid AI keys)

ASTA can run translation, speech-to-text, speech and meeting summaries on your own machine instead of Sarvam/Claude.
Sarvam and Claude stay available; each job is switched with a setting.

| Job | Open-source model | Licence | Tamil | Hindi | English |
|---|---|---|---|---|---|
| Translation | AI4Bharat **IndicTrans2** distilled (200M en↔indic, 320M indic↔indic) | MIT | ✓ | ✓ | ✓ |
| Speech-to-text | **faster-whisper** (`small` for meetings, `base` for live turns) | MIT | weak | ✓ | ✓ |
| Speech (TTS) | AI4Bharat **Indic Parler-TTS** (0.9B) | Apache-2.0 | ✓ (voice "Jaya") | ✓ ("Divya", "Rohit") | ✓ ("Mary", "Thoma") |
| Summaries | **Qwen3 4B Instruct** via Ollama | Apache-2.0 | basic | basic | ✓ |
| Assistant chat | **Qwen3 4B Instruct** via Ollama (`ASSISTANT_PROVIDER=ollama`) | Apache-2.0 | basic | basic | ✓ |
| Photo translate | **Qwen3-VL 4B Instruct** via Ollama (`ASSISTANT_VISION_MODEL`) | Apache-2.0 | to test | to test | ✓ |

Not used: **Piper** has no Tamil voice and is GPL-3.0. **MMS-TTS** is non-commercial (CC-BY-NC).

## How it fits

```
backend (Django, .venv) ──HTTP──┐
                                ├──> local_ai service (127.0.0.1:8090, .venv-localai, Python 3.12)
call worker (.venv) ─────HTTP───┘        loads each model once, unloads least-used beyond LOCAL_AI_MEMORY_BUDGET_GB
backend ──HTTP──> Ollama (127.0.0.1:11434) for summaries
```

The service has its own virtualenv because Indic Parler-TTS pins `transformers==4.46.1`, which does not install on
the main Python 3.14 environment. Nothing sent to the service is stored or sent to an outside AI provider.

## Setup (Windows)

1. Python 3.12 + virtualenv (done on the dev laptop):
   `py install 3.12`, then `py -3.12 -m venv .venv-localai` and
   `.venv-localai\Scripts\python -m pip install -r local_ai/requirements.txt`
   (IndicTransToolkit is compiled: needs **Microsoft C++ Build Tools** — installed with winget.)
2. **Hugging Face access (you must do this):** IndicTrans2 and Indic Parler-TTS are *gated*.
   - Create a free account at huggingface.co.
   - Open each model page and accept its terms:
     `ai4bharat/indictrans2-en-indic-dist-200M`, `ai4bharat/indictrans2-indic-en-dist-200M`,
     `ai4bharat/indictrans2-indic-indic-dist-320M`, `ai4bharat/indic-parler-tts`.
   - Create a *read* token (Settings → Access tokens) and run `.venv-localai\Scripts\hf auth login` and paste it.
     The token is stored in your user profile, not in this project.
3. Start the service: `.venv-localai\Scripts\python -m local_ai.server` (or "local-ai" in `.claude/launch.json`).
   Check `http://127.0.0.1:8090/health`. Models download on first use (about 1 GB each, Parler ~3.7 GB).
4. Summaries, assistant and photo translate: install Ollama (`winget install Ollama.Ollama`), then
   `ollama pull qwen3:4b-instruct` and `ollama pull qwen3-vl:4b-instruct` (on a 64 GB server: `qwen3:30b-instruct` and
   `qwen3-vl:8b-instruct`). Use the **instruct** tags: the plain `qwen3:4b` / `qwen3-vl:4b` tags are "thinking" builds
   that write long reasoning before answering, which is far too slow on a CPU.
5. `.env`:
   ```
   LOCAL_AI_URL=http://127.0.0.1:8090
   AI_ENGINE=local            # translate + speech-to-text + speech in the apps (or set each below)
   # TRANSLATE_ENGINE=local  STT_ENGINE=local  TTS_ENGINE=local
   MEETING_STT_ENGINE=local   # meeting transcription
   SUMMARY_PROVIDER=ollama    # meeting notes
   ASSISTANT_PROVIDER=ollama  # assistant chat + photo translate (JPEG/PNG)
   SPEECH_PROVIDER=local      # live calls (call worker)
   ```
   Restart the backend and worker after changing `.env`. `GET /api/ai/capabilities/` shows what each job uses and
   whether it is ready.

## Measured on the dev laptop (i3-1315U, 7.7 GB RAM, no GPU)

| Test | Result |
|---|---|
| Whisper `small`, 8.2 s English speech | 11.4 s (1.4× slower than real time), exact transcript |
| Whisper `base`, same audio | 3.6 s, exact transcript (weaker on Tamil — to be tested) |
| IndicTrans2 / Indic Parler-TTS | **not measured yet** — waiting for Hugging Face access |
| Qwen3 4B summary, 5-line Tamil/English transcript (first run, includes model load) | 100 s; correct owner, deadline, decision and open question with evidence; one garbled date in the decision text ("November 1:15") |

**Live calls:** the local models do not stream, so calls run **turn by turn**: the worker waits for ~0.7 s of
silence, then recognises → translates → speaks. On this laptop expect several seconds per turn (Parler-TTS is
the slowest part). This is not real-time; a machine with an NVIDIA GPU is needed for conversational latency.
Keep Sarvam for live calls until the local latency has been measured and accepted.

## Tuning

| Setting | Default | Effect |
|---|---|---|
| `LOCAL_AI_MEMORY_BUDGET_GB` | 5.5 | RAM for loaded models; least-recently-used are unloaded beyond it |
| `LOCAL_MT_INDIC_INDIC_MODE` | direct | `pivot` translates Hindi↔Tamil through English (saves ~1.5 GB, lower quality) |
| `LOCAL_MT_BEAMS` | 1 | 5 = model-card quality, several times slower |
| `LOCAL_WHISPER_MODEL` / `LOCAL_WHISPER_FAST_MODEL` | small / base | accuracy vs speed |
| `LOCAL_TTS_DTYPE` | float32 | `bfloat16` halves Parler's RAM; speed depends on the CPU |
| `LOCAL_TTS_LANGUAGES` | ta,hi,en | languages offered for speech; remove one if its voice fails your listening test |
| `LOCAL_AI_SECRET` | (empty) | required if the service listens on a non-local address |
| `LOCAL_END_SILENCE_MS` | 700 | live calls: silence that ends a turn |

## Limits to be aware of

* Whisper's Tamil recognition is noticeably weaker than Sarvam's. Test with real speakers before switching meetings.
* No speaker identification (diarization): transcripts show no speaker names rather than guessed ones.
* Summaries from a 4B model are simpler than Claude's; every item still needs transcript evidence or it is dropped.
* Voices have not yet been checked by native Tamil/Hindi listeners — do this before offering local speech to users.
