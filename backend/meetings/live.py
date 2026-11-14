"""In-person live meetings, with no video-call service: the phone or laptop records the room and sends short
audio chunks (about 30-60 s) while the meeting runs. Each chunk is transcribed with speaker labels and appended
to the transcript, so the notes can be refreshed during the meeting. When the meeting ends the chunks are joined
into one audio file for playback.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction

from . import audio as audio_lib
from .models import Meeting, MeetingJob, TranscriptSegment
from .transcription import Transcriber, get_transcriber

log = logging.getLogger(__name__)
RATE = audio_lib.STT_RATE


def _chunk_dir(meeting: Meeting) -> Path:
    return Path(settings.MEDIA_ROOT) / "meetings" / str(meeting.owner_id) / str(meeting.id) / "chunks"


def add_chunk(meeting: Meeting, pcm: bytes, *, transcriber: Transcriber | None = None) -> list[TranscriptSegment]:
    """Transcribes one chunk (mono 16 kHz PCM, as recorded) and appends its segments after the earlier ones."""
    if not pcm:
        return []
    transcriber = transcriber or get_transcriber(meeting.transcription_engine or None)
    with transaction.atomic():
        meeting = Meeting.objects.select_for_update().get(pk=meeting.pk)
        previous = list(meeting.segments.order_by("-index")[:3])[::-1]
        if hasattr(transcriber, "prior"):
            transcriber.prior = [f"{s.speaker}: {s.original_text}" if s.speaker else s.original_text for s in previous]
        language = None if meeting.spoken_language == "auto" else meeting.spoken_language
        # Cleaned copy for recognition only: the stored audio and the timeline stay exactly as recorded.
        heard = transcriber.transcribe(audio_lib.enhance_speech(pcm, RATE, trim=False), RATE, language)
        offset = round(meeting.duration_seconds * 1000)
        last = meeting.segments.order_by("-index").first()
        next_index = (last.index + 1) if last else 0
        created = [
            TranscriptSegment(
                meeting=meeting,
                index=next_index + i,
                start_ms=offset + s.start_ms,
                end_ms=offset + max(s.end_ms, s.start_ms),
                speaker=s.speaker,
                language=s.language or (language or ""),
                original_text=s.text,
                origin=TranscriptSegment.Origin.ASR,
            )
            for i, s in enumerate(heard)
        ]
        TranscriptSegment.objects.bulk_create(created)
        directory = _chunk_dir(meeting)
        directory.mkdir(parents=True, exist_ok=True)
        number = len(list(directory.glob("*.pcm")))
        (directory / f"{number:05d}.pcm").write_bytes(pcm)
        Meeting.objects.filter(pk=meeting.pk).update(duration_seconds=meeting.duration_seconds + len(pcm) / 2 / RATE)
    return created


def finish(meeting: Meeting, *, summarize: bool = True) -> None:
    """Ends the session: joins the chunks into one MP3, marks the meeting completed, queues playback + notes."""
    from .transcription.gemini import pcm_to_mp3

    directory = _chunk_dir(meeting)
    files = sorted(directory.glob("*.pcm")) if directory.exists() else []
    if files:
        pcm = b"".join(f.read_bytes() for f in files)
        mp3 = pcm_to_mp3(pcm, RATE)
        meeting.audio.save("original.mp3", ContentFile(mp3), save=False)
        meeting.audio_original_name = "meeting.mp3"
        meeting.audio_size = len(mp3)
        meeting.duration_seconds = len(pcm) / 2 / RATE
        shutil.rmtree(directory, ignore_errors=True)
    meeting.status = Meeting.Status.COMPLETED
    meeting.progress = 100
    meeting.save(update_fields=["status", "progress", "audio", "audio_original_name", "audio_size", "duration_seconds", "updated_at"])
    if files:
        MeetingJob.objects.create(meeting=meeting, kind=MeetingJob.Kind.PREPARE)
    if summarize and meeting.segments.exists():
        from .summary import summaries_enabled

        if summaries_enabled():
            from . import services

            services.enqueue(meeting, MeetingJob.Kind.SUMMARIZE)
