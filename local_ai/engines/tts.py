"""AI4Bharat Indic Parler-TTS (Apache-2.0). Usage follows the official model card.

The voice is steered by a text description; the model card names recommended speakers per language.
"""

from __future__ import annotations

import threading

import numpy as np

from ..config import LocalAIConfig
from ..registry import ModelRegistry, ModelUnavailable
from ..text import split_sentences
from . import has_module, is_downloaded

# Recommended speakers from the model card (first = default).
SPEAKERS = {"ta": ["Jaya"], "hi": ["Divya", "Rohit"], "en": ["Mary", "Thoma"]}
DESCRIPTION = (
    "{name} speaks at a moderate pace with a clear, natural and pleasant tone. "
    "The recording is of very high quality, with the speaker's voice sounding clear and very close up."
)
GAP_SECONDS = 0.15


class TextToSpeech:
    def __init__(self, cfg: LocalAIConfig, registry: ModelRegistry):
        self.cfg = cfg
        self.registry = registry
        self._lock = threading.Lock()

    def status(self) -> dict:
        return {
            "engine": "indic-parler-tts",
            "installed": has_module("parler_tts"),
            "models": {self.cfg.tts_model: is_downloaded(self.cfg.tts_model)},
            "languages": sorted(self.cfg.tts_languages),
            "speakers": {k: v for k, v in SPEAKERS.items() if k in self.cfg.tts_languages},
        }

    def _load(self):
        try:
            import torch
            from parler_tts import ParlerTTSForConditionalGeneration
            from transformers import AutoTokenizer
        except ImportError as exc:
            raise ModelUnavailable("Local text-to-speech is not installed (parler-tts).") from exc
        dtype = torch.bfloat16 if self.cfg.tts_dtype == "bfloat16" else torch.float32
        try:
            model = ParlerTTSForConditionalGeneration.from_pretrained(self.cfg.tts_model, torch_dtype=dtype)
            tokenizer = AutoTokenizer.from_pretrained(self.cfg.tts_model)
            description_tokenizer = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)
        except OSError as exc:
            raise ModelUnavailable(
                f"{self.cfg.tts_model} is not available. Accept its licence on huggingface.co and run `hf auth login`, then retry."
            ) from exc
        model.eval()
        return model, tokenizer, description_tokenizer

    def speaker(self, language: str, requested: str | None) -> str:
        names = SPEAKERS.get(language, [])
        for name in names:
            if requested and name.lower() == requested.lower():
                return name
        return names[0]

    def synthesize(self, text: str, language: str, speaker: str | None = None) -> tuple[bytes, int]:
        """Returns (mono PCM16, sample rate). Generated sentence by sentence to bound memory and length."""
        import torch

        size = 2.2 if self.cfg.tts_dtype == "bfloat16" else 4.0
        model, tokenizer, description_tokenizer = self.registry.get(f"tts:{self.cfg.tts_model}", size, self._load)
        rate = model.config.sampling_rate
        description = DESCRIPTION.format(name=self.speaker(language, speaker))
        parts: list[np.ndarray] = []
        with self._lock:
            desc = description_tokenizer(description, return_tensors="pt")
            for sentence in split_sentences(text, max_chars=250):
                prompt = tokenizer(sentence, return_tensors="pt")
                with torch.no_grad():
                    generation = model.generate(
                        input_ids=desc.input_ids,
                        attention_mask=desc.attention_mask,
                        prompt_input_ids=prompt.input_ids,
                        prompt_attention_mask=prompt.attention_mask,
                    )
                parts.append(generation.to(torch.float32).cpu().numpy().squeeze())
                parts.append(np.zeros(int(rate * GAP_SECONDS), dtype=np.float32))
        audio = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
        pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
        return pcm, rate
