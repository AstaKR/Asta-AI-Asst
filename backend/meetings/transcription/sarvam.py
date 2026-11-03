from __future__ import annotations

from ..audio import split_on_pauses, wav_bytes
from ..languages import from_bcp47, to_bcp47
from ..sarvam_client import SarvamClient
from .base import ProgressCallback, Segment, Transcriber


class SarvamTranscriber(Transcriber):
    """Cloud engine: audio is split at pauses (<= 25 s each) and every piece is sent to Sarvam REST STT.

    Each segment's timestamps come from its sample offsets in the original audio, so they stay exact
    however the audio is chunked.
    """

    name = "sarvam"
    billed = True

    def __init__(self, client: SarvamClient | None = None):
        super().__init__()
        self.client = client or SarvamClient()

    def transcribe(self, pcm: bytes, rate: int, language: str | None, on_progress: ProgressCallback | None = None) -> list[Segment]:
        regions = split_on_pauses(pcm, rate)
        bcp47 = to_bcp47(language) if language else None
        out: list[Segment] = []
        for i, (start, end) in enumerate(regions):
            chunk = pcm[start * 2 : end * 2]
            text, detected = self.client.speech_to_text(wav_bytes(chunk, rate), bcp47)
            self.billed_seconds += (end - start) / rate
            if text:
                out.append(
                    Segment(
                        start_ms=round(start * 1000 / rate),
                        end_ms=round(end * 1000 / rate),
                        text=text,
                        language=from_bcp47(detected) or language,
                    )
                )
            if on_progress:
                on_progress((i + 1) / len(regions))
        return out
