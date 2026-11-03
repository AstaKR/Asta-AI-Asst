"""Audio validation, decoding, pause-based chunking and playback transcoding (PyAV / bundled FFmpeg)."""

from __future__ import annotations

import io
import wave
from dataclasses import dataclass
from pathlib import Path

import av
import numpy as np

STT_RATE = 16000
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".mp4", ".aac", ".webm", ".ogg", ".oga", ".opus", ".flac"}


class InvalidAudio(ValueError):
    pass


@dataclass(frozen=True)
class AudioInfo:
    duration_seconds: float
    codec: str
    sample_rate: int
    channels: int


def _open(path: str | Path):
    try:
        container = av.open(str(path))
    except Exception as exc:  # av raises many subclasses; the message is not shown to users verbatim
        raise InvalidAudio("The file could not be read as audio.") from exc
    streams = [s for s in container.streams if s.type == "audio"]
    if not streams:
        container.close()
        raise InvalidAudio("The file contains no audio track.")
    return container, streams[0]


def probe(path: str | Path) -> AudioInfo:
    """Validates by actually decoding (extensions alone are not trusted). Returns duration etc."""
    container, stream = _open(path)
    try:
        codec = stream.codec_context.name
        rate = stream.codec_context.sample_rate or 0
        channels = stream.codec_context.channels or 0
        duration = None
        if container.duration:
            duration = container.duration / 1_000_000
        elif stream.duration and stream.time_base:
            duration = float(stream.duration * stream.time_base)
        if not duration:
            # Browser MediaRecorder WebM files carry no duration header: count decoded samples.
            samples = 0
            for frame in container.decode(stream):
                samples += frame.samples
                rate = frame.sample_rate
            duration = samples / rate if rate else 0
        else:
            # Prove that at least one frame decodes (catches truncated/corrupt files).
            next(container.decode(stream), None)
    except InvalidAudio:
        raise
    except Exception as exc:
        raise InvalidAudio("The audio data is corrupt or unsupported.") from exc
    finally:
        container.close()
    if duration < 0.3:
        raise InvalidAudio("The recording is too short.")
    return AudioInfo(duration_seconds=round(duration, 3), codec=codec, sample_rate=rate, channels=channels)


def decode_pcm16(path: str | Path, rate: int = STT_RATE) -> bytes:
    """Decodes any supported file to mono 16-bit PCM at `rate`."""
    container, stream = _open(path)
    resampler = av.AudioResampler(format="s16", layout="mono", rate=rate)
    out = bytearray()
    try:
        for frame in container.decode(stream):
            for rf in resampler.resample(frame):
                out.extend(rf.to_ndarray().tobytes())
        for rf in resampler.resample(None):
            out.extend(rf.to_ndarray().tobytes())
    except Exception as exc:
        raise InvalidAudio("The audio data is corrupt or unsupported.") from exc
    finally:
        container.close()
    return bytes(out)


def write_playback_mp3(src: str | Path, dst: str | Path, rate: int = 22050, bitrate: int = 64000) -> None:
    """A constant-bitrate MP3 copy: seekable in every browser (MediaRecorder WebM often is not)."""
    container, stream = _open(src)
    out = av.open(str(dst), "w", format="mp3")
    try:
        ost = out.add_stream("libmp3lame", rate=rate, layout="mono")
        ost.bit_rate = bitrate
        resampler = av.AudioResampler(format=ost.codec_context.format.name, layout="mono", rate=rate)
        for frame in container.decode(stream):
            frame.pts = None
            for rf in resampler.resample(frame):
                for packet in ost.encode(rf):
                    out.mux(packet)
        for rf in resampler.resample(None):
            for packet in ost.encode(rf):
                out.mux(packet)
        for packet in ost.encode(None):
            out.mux(packet)
    finally:
        out.close()
        container.close()


def wav_bytes(pcm: bytes, rate: int = STT_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def split_on_pauses(
    pcm: bytes,
    rate: int = STT_RATE,
    *,
    max_seconds: float = 25.0,
    min_silence_ms: int = 500,
    threshold_dbfs: float = -42.0,
    pad_ms: int = 200,
    min_speech_ms: int = 300,
) -> list[tuple[int, int]]:
    """Speech regions as (start_sample, end_sample) in the ORIGINAL timeline.

    Regions are split at pauses; anything longer than max_seconds is cut at its quietest frame, so
    every chunk fits a 30 s STT request while its offsets stay exact.
    """
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    if samples.size == 0:
        return []
    frame = int(rate * 0.03)
    n_frames = samples.size // frame
    if n_frames == 0:
        return []
    frames = samples[: n_frames * frame].reshape(n_frames, frame)
    rms = np.sqrt(np.mean(frames**2, axis=1)) / 32768.0
    db = 20 * np.log10(np.maximum(rms, 1e-9))
    voiced = db > threshold_dbfs

    regions: list[list[int]] = []
    gap_frames = max(1, min_silence_ms // 30)
    i = 0
    while i < n_frames:
        if not voiced[i]:
            i += 1
            continue
        start = i
        silent = 0
        j = i
        while j < n_frames and silent < gap_frames:
            silent = 0 if voiced[j] else silent + 1
            j += 1
        end = j - silent
        regions.append([start, end])
        i = j

    pad = pad_ms // 30
    max_frames = int(max_seconds / 0.03)
    out: list[tuple[int, int]] = []
    for start, end in regions:
        start = max(0, start - pad)
        end = min(n_frames, end + pad)
        while end - start > max_frames:
            # cut at the quietest frame in the last third of the allowed window
            window_lo = start + max_frames * 2 // 3
            window_hi = start + max_frames
            cut = window_lo + int(np.argmin(db[window_lo:window_hi]))
            out.append((start * frame, cut * frame))
            start = cut
        if (end - start) * 30 >= min_speech_ms:
            out.append((start * frame, min(end * frame, samples.size)))
    return out
