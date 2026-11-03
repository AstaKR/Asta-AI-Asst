"""IndicTrans2 translation (AI4Bharat, MIT licence). Usage follows the official model cards:
IndicProcessor.preprocess_batch -> tokenizer -> model.generate -> batch_decode -> postprocess_batch.
"""

from __future__ import annotations

import threading

from ..config import LocalAIConfig
from ..registry import ModelRegistry, ModelUnavailable
from ..text import FLORES, paragraphs, split_sentences
from . import has_module, is_downloaded

# Approximate resident size (float32 weights + runtime), used for the RAM budget.
_SIZES_GB = {"200M": 1.0, "320M": 1.5, "1B": 4.5}
BATCH = 8


def _size(model_name: str) -> float:
    return next((gb for tag, gb in _SIZES_GB.items() if tag in model_name), 1.5)


class Translator:
    def __init__(self, cfg: LocalAIConfig, registry: ModelRegistry):
        self.cfg = cfg
        self.registry = registry
        self._lock = threading.Lock()  # one translation at a time: CPU-bound
        self._processor = None

    # ---------- capabilities ----------

    def models_for(self, source: str, target: str) -> list[tuple[str, str, str]]:
        """Hops (model, src, tgt) for a pair; Indic<->Indic may pivot through English."""
        if source == target:
            return []
        if source == "en":
            return [(self.cfg.mt_en_indic, source, target)]
        if target == "en":
            return [(self.cfg.mt_indic_en, source, target)]
        if self.cfg.mt_indic_indic_mode == "pivot":
            return [(self.cfg.mt_indic_en, source, "en"), (self.cfg.mt_en_indic, "en", target)]
        return [(self.cfg.mt_indic_indic, source, target)]

    def status(self) -> dict:
        libs = has_module("torch") and has_module("transformers") and has_module("IndicTransToolkit")
        names = {self.cfg.mt_en_indic, self.cfg.mt_indic_en}
        if self.cfg.mt_indic_indic_mode != "pivot":
            names.add(self.cfg.mt_indic_indic)
        return {
            "engine": "indictrans2",
            "installed": libs,
            "models": {n: is_downloaded(n) for n in sorted(names)},
            "languages": sorted(FLORES),
            "indic_indic": self.cfg.mt_indic_indic_mode,
        }

    # ---------- inference ----------

    def _load(self, model_name: str):
        try:
            import torch
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        except ImportError as exc:
            raise ModelUnavailable("Local translation is not installed (torch/transformers).") from exc
        if self.cfg.torch_threads:
            torch.set_num_threads(self.cfg.torch_threads)
        try:
            tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
            model = AutoModelForSeq2SeqLM.from_pretrained(model_name, trust_remote_code=True, torch_dtype=torch.float32)
        except OSError as exc:  # missing files, or the gated licence not accepted / not logged in
            raise ModelUnavailable(
                f"{model_name} is not available. Accept its licence on huggingface.co and run `hf auth login`, then retry."
            ) from exc
        model.eval()
        return tokenizer, model

    def _ip(self):
        if self._processor is None:
            try:
                from IndicTransToolkit.processor import IndicProcessor
            except ImportError as exc:
                raise ModelUnavailable("IndicTransToolkit is not installed.") from exc
            self._processor = IndicProcessor(inference=True)
        return self._processor

    def _run(self, model_name: str, sentences: list[str], src: str, tgt: str) -> list[str]:
        import torch

        tokenizer, model = self.registry.get(model_name, _size(model_name), lambda: self._load(model_name))
        ip = self._ip()
        out: list[str] = []
        for i in range(0, len(sentences), BATCH):
            chunk = sentences[i : i + BATCH]
            batch = ip.preprocess_batch(chunk, src_lang=FLORES[src], tgt_lang=FLORES[tgt])
            inputs = tokenizer(batch, truncation=True, padding="longest", return_tensors="pt", return_attention_mask=True)
            with torch.no_grad():
                tokens = model.generate(
                    **inputs, use_cache=True, min_length=0, max_length=256, num_beams=self.cfg.mt_beams, num_return_sequences=1
                )
            decoded = tokenizer.batch_decode(tokens, skip_special_tokens=True, clean_up_tokenization_spaces=True)
            out.extend(ip.postprocess_batch(decoded, lang=FLORES[tgt]))
        return out

    def translate(self, text: str, source: str, target: str) -> str:
        """Translates line by line so paragraphs and blank lines keep their layout."""
        hops = self.models_for(source, target)
        if not hops or not text.strip():
            return text
        with self._lock:
            result_lines = []
            for line in paragraphs(text):
                if not line:
                    result_lines.append("")
                    continue
                sentences = split_sentences(line)
                for model_name, src, tgt in hops:
                    sentences = self._run(model_name, sentences, src, tgt)
                result_lines.append(" ".join(s.strip() for s in sentences if s.strip()))
        return "\n".join(result_lines).strip("\n")
