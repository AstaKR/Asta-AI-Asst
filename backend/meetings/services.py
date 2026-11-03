"""Meeting workflows: background jobs, transcription, translation, summaries and live-segment ingestion."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from . import audio as audio_lib
from .errors import BudgetExceeded, ProviderError
from .languages import from_bcp47, to_bcp47
from .models import ActionItem, Meeting, MeetingJob, TranscriptSegment
from .sarvam_client import SarvamClient
from integrations.engines import Engines
from .summary import TranscriptLine, get_summarizer
from .summary.schema import ground
from .transcription import Transcriber, get_transcriber

log = logging.getLogger(__name__)
MAX_ATTEMPTS = 3


# ---------- budget ----------


def check_budget(*, stt_seconds: float = 0, translate_chars: int = 0) -> None:
    from calls.usage import daily_totals

    totals = daily_totals()
    limits = settings.DAILY_LIMITS
    if stt_seconds and totals["stt_seconds"] + stt_seconds > limits["stt_seconds"]:
        raise BudgetExceeded("Today's speech-recognition limit would be exceeded. Try again tomorrow or raise DAILY_STT_SECONDS_LIMIT.")
    if translate_chars and totals["translate_chars"] + translate_chars > limits["translate_chars"]:
        raise BudgetExceeded("Today's translation limit would be exceeded. Try again tomorrow or raise DAILY_TRANSLATE_CHARS_LIMIT.")


# ---------- jobs ----------


def enqueue(meeting: Meeting, kind: str) -> MeetingJob:
    job = MeetingJob.objects.create(meeting=meeting, kind=kind)
    status = Meeting.Status.QUEUED if kind != MeetingJob.Kind.SUMMARIZE else meeting.status
    Meeting.objects.filter(pk=meeting.pk).update(status=status, progress=0, error_message="")
    return job


def claim_next() -> MeetingJob | None:
    """Atomically claims the oldest queued job (safe with several runner processes)."""
    for job in MeetingJob.objects.filter(status=MeetingJob.Status.QUEUED).order_by("created_at")[:5]:
        claimed = MeetingJob.objects.filter(pk=job.pk, status=MeetingJob.Status.QUEUED).update(
            status=MeetingJob.Status.RUNNING, started_at=timezone.now(), attempts=F("attempts") + 1
        )
        if claimed:
            return MeetingJob.objects.select_related("meeting").get(pk=job.pk)
    return None


def recover_stale(minutes: int = 60) -> int:
    """Jobs left 'running' by a crashed runner are re-queued (or failed after MAX_ATTEMPTS)."""
    cutoff = timezone.now() - timedelta(minutes=minutes)
    stale = MeetingJob.objects.filter(status=MeetingJob.Status.RUNNING, started_at__lt=cutoff)
    n = 0
    for job in stale:
        if job.attempts >= MAX_ATTEMPTS:
            _fail(job, "The job stopped unexpectedly several times.")
        else:
            MeetingJob.objects.filter(pk=job.pk).update(status=MeetingJob.Status.QUEUED)
        n += 1
    return n


def _fail(job: MeetingJob, message: str) -> None:
    now = timezone.now()
    MeetingJob.objects.filter(pk=job.pk).update(status=MeetingJob.Status.FAILED, error=message[:500], finished_at=now)
    if job.kind == MeetingJob.Kind.SUMMARIZE:
        Meeting.objects.filter(pk=job.meeting_id).update(summary_error=message[:500])
    else:
        Meeting.objects.filter(pk=job.meeting_id).update(status=Meeting.Status.FAILED, error_message=message[:500])


def run_job(job: MeetingJob, *, transcriber: Transcriber | None = None, client: SarvamClient | None = None, summarizer=None) -> None:
    meeting = job.meeting
    try:
        if job.kind == MeetingJob.Kind.PREPARE:
            prepare_playback(meeting)
        elif job.kind == MeetingJob.Kind.TRANSCRIBE:
            prepare_playback(meeting)
            transcribe_meeting(meeting, transcriber=transcriber, client=client)
        elif job.kind == MeetingJob.Kind.SUMMARIZE:
            summarize_meeting(meeting, summarizer=summarizer)
    except (ProviderError, BudgetExceeded, audio_lib.InvalidAudio) as exc:
        log.warning("meeting job %s failed: %s", job.pk, exc.__class__.__name__)
        retryable = getattr(exc, "retryable", False)
        if retryable and job.attempts < MAX_ATTEMPTS:
            MeetingJob.objects.filter(pk=job.pk).update(status=MeetingJob.Status.QUEUED, error=str(exc)[:500])
        else:
            _fail(job, str(exc))
        return
    except Exception:
        log.exception("meeting job %s crashed", job.pk)
        _fail(job, "An unexpected error occurred while processing this meeting.")
        return
    MeetingJob.objects.filter(pk=job.pk).update(status=MeetingJob.Status.DONE, finished_at=timezone.now(), error="")
    if job.kind == MeetingJob.Kind.TRANSCRIBE and settings.MEETING_AUTO_SUMMARY:
        from .summary import summaries_enabled

        if summaries_enabled():
            enqueue(meeting, MeetingJob.Kind.SUMMARIZE)


# ---------- transcription + translation ----------


def _set(meeting: Meeting, **fields) -> None:
    Meeting.objects.filter(pk=meeting.pk).update(**fields)
    for k, v in fields.items():
        setattr(meeting, k, v)


def prepare_playback(meeting: Meeting) -> None:
    """Creates the seekable MP3 used by the player (skipped if it already exists)."""
    if not meeting.audio or meeting.audio_playback:
        return
    from pathlib import Path

    src = Path(meeting.audio.path)
    dst = src.with_name("playback.mp3")
    audio_lib.write_playback_mp3(src, dst)
    rel = str(Path(meeting.audio.name).with_name("playback.mp3")).replace("\\", "/")
    _set(meeting, audio_playback=rel)


def transcribe_meeting(meeting: Meeting, *, transcriber: Transcriber | None = None, client: SarvamClient | None = None) -> None:
    if not meeting.audio:
        raise audio_lib.InvalidAudio("This meeting has no audio to transcribe.")
    transcriber = transcriber or get_transcriber(meeting.transcription_engine or None)
    if transcriber.billed:
        check_budget(stt_seconds=meeting.duration_seconds)
    _set(meeting, status=Meeting.Status.TRANSCRIBING, progress=0, error_message="", transcription_engine=transcriber.name)
    pcm = audio_lib.decode_pcm16(meeting.audio.path)
    language = None if meeting.spoken_language == "auto" else meeting.spoken_language

    def progress(fraction: float) -> None:
        Meeting.objects.filter(pk=meeting.pk).update(progress=int(fraction * 100))

    segments = transcriber.transcribe(pcm, audio_lib.STT_RATE, language, progress)
    with transaction.atomic():
        meeting.segments.all().delete()  # re-transcription replaces the previous transcript
        TranscriptSegment.objects.bulk_create(
            TranscriptSegment(
                meeting=meeting,
                index=i,
                start_ms=s.start_ms,
                end_ms=max(s.end_ms, s.start_ms),
                speaker=s.speaker,
                language=s.language or (language or ""),
                original_text=s.text,
                origin=TranscriptSegment.Origin.ASR,
            )
            for i, s in enumerate(segments)
        )
        Meeting.objects.filter(pk=meeting.pk).update(stt_seconds=F("stt_seconds") + transcriber.billed_seconds)
    if meeting.translation_language:
        translate_meeting(meeting, meeting.translation_language, client=client)
    _set(meeting, status=Meeting.Status.COMPLETED, progress=100)


def translate_meeting(meeting: Meeting, target: str, *, client: SarvamClient | None = None) -> int:
    """Translates every segment not already in `target`. Original text is never modified."""
    segments = list(meeting.segments.all())
    todo = [s for s in segments if s.original_text and s.language != target]
    client = client or (Engines() if todo else None)
    # Only Sarvam work is billed; a plain SarvamClient (no `billed`) always is.
    billed = bool(client) and getattr(client, "billed", lambda kind: True)("translate")
    if billed:
        check_budget(translate_chars=sum(len(s.original_text) for s in todo))
    _set(meeting, status=Meeting.Status.TRANSLATING, progress=0, translation_language=target)
    chars = 0
    for n, seg in enumerate(segments):
        if seg in todo:
            source = to_bcp47(seg.language) if seg.language in ("ta", "en", "hi") else "auto"
            seg.translated_text = client.translate(seg.original_text, source, to_bcp47(target))
            chars += len(seg.original_text)
        else:
            seg.translated_text = seg.original_text if seg.language == target else ""
        seg.translation_language = target
        if n % 10 == 0:
            Meeting.objects.filter(pk=meeting.pk).update(progress=int(100 * (n + 1) / max(1, len(segments))))
    TranscriptSegment.objects.bulk_update(segments, ["translated_text", "translation_language"])
    if billed:
        Meeting.objects.filter(pk=meeting.pk).update(translate_chars=F("translate_chars") + chars)
    return chars if billed else 0


# ---------- summaries ----------


def summarize_meeting(meeting: Meeting, *, summarizer=None) -> dict:
    segments = list(meeting.segments.all())
    if not segments:
        raise ProviderError("There is no transcript to summarize yet.")
    summarizer = summarizer or get_summarizer()
    previous = meeting.status
    _set(meeting, status=Meeting.Status.SUMMARIZING, summary_error="")
    try:
        lines = [TranscriptLine(s.index, s.start_ms, s.speaker, s.original_text, s.translated_text) for s in segments]
        notes = summarizer.summarize(meeting.title, lines, meeting.summary_language)
        grounded = ground(notes, {s.index: (s.original_text, s.translated_text) for s in segments})
        summary_text = "\n".join(
            [grounded["summary"]]
            + [p["text"] for k in ("key_points", "decisions", "open_questions") for p in grounded[k]]
            + [a["text"] for a in grounded["action_items"]]
        )
        with transaction.atomic():
            meeting.action_items.all().delete()
            ActionItem.objects.bulk_create(
                ActionItem(
                    meeting=meeting,
                    order=i,
                    text=a["text"][:500],
                    owner_name=(a["owner"] or "")[:120],
                    deadline=(a["deadline"] or "")[:120],
                    segment_indexes=a["segments"],
                )
                for i, a in enumerate(grounded["action_items"])
            )
            _set(
                meeting,
                summary={k: v for k, v in grounded.items() if k != "action_items"},
                summary_text=summary_text,
                summary_model=f"{summarizer.name}:{summarizer.model}",
                summary_generated_at=timezone.now(),
            )
    finally:
        _set(meeting, status=previous if previous != Meeting.Status.SUMMARIZING else Meeting.Status.COMPLETED)
    return grounded


# ---------- live transcripts (LiveKit worker -> backend) ----------


def _offset_ms(meeting: Meeting, epoch_ms: int) -> int:
    anchor = meeting.live_started_at or (meeting.call_room.started_at if meeting.call_room else None) or meeting.created_at
    return max(0, epoch_ms - int(anchor.timestamp() * 1000))


def ingest_live_segment(room, data: dict) -> int:
    """Upserts one finalized utterance into every live/call meeting linked to `room`. Returns count."""
    meetings = Meeting.objects.filter(call_room=room, status=Meeting.Status.LIVE)
    language = from_bcp47(data.get("language")) or ""
    translation_language = from_bcp47(data.get("translation_language")) or ""
    n = 0
    for meeting in meetings:
        with transaction.atomic():
            seg = meeting.segments.select_for_update().filter(external_id=data["utterance_id"]).first()
            if seg is None:
                last = meeting.segments.order_by("-index").first()
                seg = TranscriptSegment(
                    meeting=meeting,
                    index=(last.index + 1) if last else 0,
                    external_id=data["utterance_id"],
                    origin=TranscriptSegment.Origin.LIVE,
                )
            seg.start_ms = _offset_ms(meeting, data["start_epoch_ms"])
            seg.end_ms = max(seg.start_ms, _offset_ms(meeting, data["end_epoch_ms"]))
            seg.speaker = data.get("speaker_name", "")[:80]
            seg.language = language
            if data.get("text"):
                seg.original_text = data["text"]
            if data.get("translation"):
                seg.translated_text = data["translation"]
                seg.translation_language = translation_language
            if seg.original_text:
                seg.save()
                n += 1
    return n


def finalize_live_meetings(room) -> None:
    """Called when a call/live session ends: its live meetings become completed transcripts."""
    for meeting in Meeting.objects.filter(call_room=room, status=Meeting.Status.LIVE):
        fields = {"status": Meeting.Status.COMPLETED, "progress": 100}
        if room.started_at and not meeting.duration_seconds:
            end = room.ended_at or timezone.now()
            fields["duration_seconds"] = max(0.0, (end - room.started_at).total_seconds())
        Meeting.objects.filter(pk=meeting.pk).update(**fields)


def epoch_ms_to_datetime(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=dt_timezone.utc)
