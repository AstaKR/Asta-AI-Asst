import logging
import os
import re
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse, HttpResponse, JsonResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import get_preference
from billing import limits as plan_limits
from calls import livekit_service
from calls.models import CallParticipant, CallRoom
from calls.views import WorkerSecretPermission

from . import audio as audio_lib
from . import exports, services
from .errors import ProviderNotConfigured
from .languages import MEETING_LANGUAGES, to_bcp47
from .models import ActionItem, Meeting, MeetingJob, TranscriptSegment
from .serializers import (
    ActionItemSerializer,
    InternalSegmentSerializer,
    LiveMeetingSerializer,
    MeetingDetailSerializer,
    MeetingListSerializer,
    MeetingUpdateSerializer,
    MeetingUploadSerializer,
    SegmentSerializer,
    SegmentUpdateSerializer,
    SummarizeSerializer,
    TranslateSerializer,
)
from .summary import summaries_enabled
from .transcription import available_engines

log = logging.getLogger(__name__)


def _own(request, pk) -> Meeting:
    # 404 (not 403) for other users' meetings: their existence is not revealed.
    return get_object_or_404(Meeting, pk=pk, owner=request.user)


def _detail(meeting: Meeting) -> dict:
    meeting = Meeting.objects.prefetch_related("segments", "action_items").select_related("call_room").get(pk=meeting.pk)
    return MeetingDetailSerializer(meeting).data


class MeetingPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class MeetingConfigView(APIView):
    def get(self, request):
        return Response(
            {
                "languages": [{"code": c, "name": n} for c, n in MEETING_LANGUAGES.items()],
                "engines": available_engines(),
                "default_engine": settings.MEETING_STT_ENGINE,
                "summaries_enabled": summaries_enabled(),
                "summary_model": (settings.OLLAMA_MODEL if settings.SUMMARY_PROVIDER == "ollama" else settings.SUMMARY_MODEL) if summaries_enabled() else None,
                "max_upload_mb": settings.MEETING_MAX_UPLOAD_MB,
                "max_duration_seconds": settings.MEETING_MAX_DURATION_SECONDS,
                "allowed_extensions": sorted(audio_lib.ALLOWED_EXTENSIONS),
                "translation_enabled": settings.TRANSLATION_ENABLED,
            }
        )


class MeetingListCreateView(APIView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        qs = Meeting.objects.filter(owner=request.user).annotate(segment_count=Count("segments"))
        p = request.query_params
        if q := p.get("q", "").strip():
            matching = TranscriptSegment.objects.filter(meeting__owner=request.user).filter(
                Q(original_text__icontains=q) | Q(translated_text__icontains=q)
            ).values("meeting_id")
            qs = qs.filter(Q(title__icontains=q) | Q(summary_text__icontains=q) | Q(pk__in=matching))
        if language := p.get("language"):
            qs = qs.filter(Q(spoken_language=language) | Q(translation_language=language) | Q(segments__language=language)).distinct()
        if st := p.get("status"):
            qs = qs.filter(status=st)
        if source := p.get("source"):
            qs = qs.filter(source=source)
        if date_from := p.get("date_from"):
            qs = qs.filter(recorded_at__date__gte=date_from)
        if date_to := p.get("date_to"):
            qs = qs.filter(recorded_at__date__lte=date_to)
        paginator = MeetingPagination()
        page = paginator.paginate_queryset(qs.order_by("-recorded_at", "-created_at"), request, view=self)
        return paginator.get_paginated_response(MeetingListSerializer(page, many=True).data)

    def post(self, request):
        data = MeetingUploadSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            plan_limits.check_meeting(request.user)
        except plan_limits.PlanLimit as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=429)
        v = data.validated_data
        engine = v.get("engine") or settings.MEETING_STT_ENGINE
        if not available_engines().get(engine):
            return Response({"detail": f"The '{engine}' transcription engine is not available on this server.", "code": "engine_unavailable"}, status=503)
        now = timezone.now()
        meeting = Meeting(
            owner=request.user,
            title=v["title"],
            source=v["source"],
            spoken_language=v["spoken_language"],
            translation_language=v["translation_language"],
            transcription_engine=engine,
            consent_confirmed_at=now,
            recorded_at=v.get("recorded_at") or now,
            audio_original_name=os.path.basename(v["file"].name)[:255],
            audio_size=v["file"].size,
        )
        meeting.audio.save(v["file"].name, v["file"], save=False)
        try:
            info = audio_lib.probe(meeting.audio.path)
        except audio_lib.InvalidAudio as exc:
            meeting.audio.delete(save=False)
            return Response({"file": [str(exc)]}, status=400)
        if info.duration_seconds > settings.MEETING_MAX_DURATION_SECONDS:
            meeting.audio.delete(save=False)
            limit = settings.MEETING_MAX_DURATION_SECONDS // 60
            return Response({"file": [f"Recordings longer than {limit} minutes are not supported."]}, status=400)
        meeting.duration_seconds = info.duration_seconds
        meeting.status = Meeting.Status.QUEUED
        meeting.save()
        services.enqueue(meeting, MeetingJob.Kind.TRANSCRIBE)
        return Response(_detail(meeting), status=201)


class MeetingDetailView(APIView):
    def get(self, request, pk):
        meeting = _own(request, pk)
        if meeting.status == Meeting.Status.LIVE and meeting.call_room and meeting.call_room.is_ended:
            services.finalize_live_meetings(meeting.call_room)
        return Response(_detail(meeting))

    def patch(self, request, pk):
        meeting = _own(request, pk)
        data = MeetingUpdateSerializer(meeting, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        data.save()
        return Response(_detail(meeting))

    def delete(self, request, pk):
        meeting = _own(request, pk)
        for f in (meeting.audio, meeting.audio_playback):
            if f:
                f.storage.delete(f.name)
        meeting.delete()
        return Response(status=204)


_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


def _ranged_file_response(request, path: Path, content_type: str):
    """Serves a file with HTTP Range support so the browser can seek to transcript timestamps."""
    size = path.stat().st_size
    header = request.headers.get("Range", "")
    match = _RANGE.fullmatch(header.strip()) if header else None
    if not match:
        resp = FileResponse(open(path, "rb"), content_type=content_type)
        resp["Accept-Ranges"] = "bytes"
        resp["Content-Length"] = str(size)
        return resp
    start_s, end_s = match.groups()
    if start_s == "":
        start, end = max(0, size - int(end_s or 0)), size - 1
    else:
        start, end = int(start_s), min(int(end_s) if end_s else size - 1, size - 1)
    if start > end or start >= size:
        resp = HttpResponse(status=416)
        resp["Content-Range"] = f"bytes */{size}"
        return resp
    length = end - start + 1

    def chunks():
        with open(path, "rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining > 0:
                data = fh.read(min(64 * 1024, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    resp = StreamingHttpResponse(chunks(), status=206, content_type=content_type)
    resp["Content-Range"] = f"bytes {start}-{end}/{size}"
    resp["Content-Length"] = str(length)
    resp["Accept-Ranges"] = "bytes"
    return resp


class MeetingAudioView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, pk):
        meeting = _own(request, pk)
        f = meeting.audio_playback or meeting.audio
        if not f:
            return Response({"detail": "This meeting has no audio."}, status=404)
        path = Path(f.path)
        if not path.exists():
            return Response({"detail": "The audio file is missing."}, status=404)
        content_type = "audio/mpeg" if path.suffix == ".mp3" else "application/octet-stream"
        resp = _ranged_file_response(request, path, content_type)
        resp["Cache-Control"] = "private, max-age=3600"
        resp["X-Content-Type-Options"] = "nosniff"
        return resp

    def post(self, request, pk):
        """Attach the browser recording of a live session (live transcript is kept)."""
        meeting = _own(request, pk)
        if meeting.audio:
            return Response({"detail": "This meeting already has audio."}, status=409)
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"file": ["No file was uploaded."]}, status=400)
        check = MeetingUploadSerializer().fields["file"]
        try:
            check.run_validators(upload)
            MeetingUploadSerializer().validate_file(upload)
        except Exception as exc:
            detail = getattr(exc, "detail", [str(exc)])
            return Response({"file": detail}, status=400)
        meeting.audio_original_name = os.path.basename(upload.name)[:255]
        meeting.audio_size = upload.size
        meeting.audio.save(upload.name, upload, save=False)
        try:
            info = audio_lib.probe(meeting.audio.path)
        except audio_lib.InvalidAudio as exc:
            meeting.audio.delete(save=False)
            return Response({"file": [str(exc)]}, status=400)
        meeting.duration_seconds = info.duration_seconds
        meeting.save(update_fields=["audio", "audio_original_name", "audio_size", "duration_seconds", "updated_at"])
        MeetingJob.objects.create(meeting=meeting, kind=MeetingJob.Kind.PREPARE)
        return Response(_detail(meeting), status=201)


class MeetingTranscribeView(APIView):
    """(Re)transcribe from the audio, e.g. after a failure or with another engine."""

    def post(self, request, pk):
        meeting = _own(request, pk)
        if not meeting.audio:
            return Response({"detail": "This meeting has no audio to transcribe."}, status=400)
        if meeting.jobs.filter(status__in=[MeetingJob.Status.QUEUED, MeetingJob.Status.RUNNING], kind=MeetingJob.Kind.TRANSCRIBE).exists():
            return Response({"detail": "Transcription is already in progress."}, status=409)
        engine = request.data.get("engine") or meeting.transcription_engine or settings.MEETING_STT_ENGINE
        if not available_engines().get(engine):
            return Response({"detail": f"The '{engine}' transcription engine is not available.", "code": "engine_unavailable"}, status=503)
        meeting.transcription_engine = engine
        meeting.save(update_fields=["transcription_engine", "updated_at"])
        services.enqueue(meeting, MeetingJob.Kind.TRANSCRIBE)
        return Response(_detail(meeting), status=202)


class MeetingTranslateView(APIView):
    def post(self, request, pk):
        meeting = _own(request, pk)
        data = TranslateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if not meeting.segments.exists():
            return Response({"detail": "There is no transcript to translate yet."}, status=400)
        try:
            services.translate_meeting(meeting, data.validated_data["language"])
        except services.BudgetExceeded as exc:
            Meeting.objects.filter(pk=meeting.pk).update(status=Meeting.Status.COMPLETED)
            return Response({"detail": str(exc), "code": "budget"}, status=429)
        except services.ProviderError as exc:
            Meeting.objects.filter(pk=meeting.pk).update(status=Meeting.Status.COMPLETED)
            return Response({"detail": str(exc), "code": "provider"}, status=502)
        Meeting.objects.filter(pk=meeting.pk).update(status=Meeting.Status.COMPLETED, progress=100)
        return Response(_detail(meeting))


class MeetingSummarizeView(APIView):
    def post(self, request, pk):
        meeting = _own(request, pk)
        if not summaries_enabled():
            return Response({"detail": "AI summaries are not configured on this server.", "code": "summaries_disabled"}, status=503)
        data = SummarizeSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if not meeting.segments.exists():
            return Response({"detail": "There is no transcript to summarize yet."}, status=400)
        if language := data.validated_data.get("language"):
            meeting.summary_language = language
            meeting.save(update_fields=["summary_language", "updated_at"])
        Meeting.objects.filter(pk=meeting.pk).update(summary_error="")
        services.enqueue(meeting, MeetingJob.Kind.SUMMARIZE)
        return Response(_detail(meeting), status=202)


class SegmentUpdateView(APIView):
    def patch(self, request, pk, index):
        meeting = _own(request, pk)
        seg = get_object_or_404(TranscriptSegment, meeting=meeting, index=index)
        data = SegmentUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        for k, v in data.validated_data.items():
            setattr(seg, k, v)
        seg.edited_at = timezone.now()
        seg.save()
        return Response(SegmentSerializer(seg).data)


class ActionItemUpdateView(APIView):
    def patch(self, request, pk, item_id):
        meeting = _own(request, pk)
        item = get_object_or_404(ActionItem, meeting=meeting, pk=item_id)
        data = ActionItemSerializer(item, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        data.save()
        return Response(data.data)


class MeetingExportView(APIView):
    def get(self, request, pk):
        meeting = Meeting.objects.prefetch_related("segments", "action_items").filter(owner=request.user, pk=pk).first()
        if meeting is None:
            return Response({"detail": "Not found."}, status=404)
        # (not "?format=": DRF reserves that query parameter for renderer selection)
        fmt = request.query_params.get("kind", "txt")
        name = slugify(meeting.title)[:60] or "meeting"
        if fmt == "txt":
            resp = HttpResponse(exports.export_txt(meeting), content_type="text/plain; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="{name}.txt"'
            return resp
        if fmt == "docx":
            resp = HttpResponse(
                exports.export_docx(meeting),
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            resp["Content-Disposition"] = f'attachment; filename="{name}.docx"'
            return resp
        if fmt == "csv":
            resp = HttpResponse(exports.export_csv(meeting), content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="{name}.csv"'
            return resp
        if fmt == "json":
            resp = JsonResponse(exports.export_json(meeting), json_dumps_params={"ensure_ascii": False, "indent": 2})
            resp["Content-Disposition"] = f'attachment; filename="{name}.json"'
            return resp
        if fmt in ("srt", "vtt"):
            if not any(s.end_ms > s.start_ms for s in meeting.segments.all()):
                return Response({"detail": "This transcript has no timestamps, so subtitles cannot be made."}, status=400)
            translated = request.query_params.get("text") == "translation"
            content_type = "application/x-subrip" if fmt == "srt" else "text/vtt"
            resp = HttpResponse(exports.export_subtitles(meeting, fmt, translated), content_type=f"{content_type}; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="{name}{"-translated" if translated else ""}.{fmt}"'
            return resp
        return Response({"detail": "kind must be txt, docx, csv, json, srt or vtt (PDF: use the print view)."}, status=400)


# ---------- live (LiveKit) ----------


class LiveMeetingCreateView(APIView):
    """One-person live session: LiveKit room in 'meeting' mode; the worker transcribes (and translates)."""

    def post(self, request):
        data = LiveMeetingSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            plan_limits.check_meeting(request.user)
        except plan_limits.PlanLimit as exc:
            return Response({"detail": str(exc), "code": exc.code}, status=429)
        v = data.validated_data
        pref = get_preference(request.user)
        now = timezone.now()
        listen = v["translation_language"] or v["spoken_language"]
        with transaction.atomic():
            room = CallRoom.objects.create(
                created_by=request.user,
                mode=CallRoom.Mode.MEETING,
                save_transcript=True,
                translation_enabled=settings.TRANSLATION_ENABLED,
                max_duration_seconds=settings.MAX_CALL_DURATION_SECONDS,
                invite_expires_at=now + timedelta(hours=1),
            )
            CallParticipant.objects.create(
                room=room,
                user=request.user,
                identity=f"user-{request.user.id}",
                display_name=pref.display_name or request.user.username,
                role=CallParticipant.Role.HOST,
                spoken_language=to_bcp47(v["spoken_language"]),
                listen_language=to_bcp47(listen),
                voice=pref.voice or settings.DEFAULT_VOICE,
                voice_playback=v["voice_playback"],
                transcript_consent=True,
            )
            meeting = Meeting.objects.create(
                owner=request.user,
                title=v["title"],
                source=Meeting.Source.LIVE,
                call_room=room,
                spoken_language=v["spoken_language"],
                translation_language=v["translation_language"],
                status=Meeting.Status.LIVE,
                consent_confirmed_at=now,
                recorded_at=now,
                transcription_engine="live",
            )
        return Response({"meeting": _detail(meeting), "room_code": room.code}, status=201)


class LiveMeetingStartedView(APIView):
    """The browser reports when its recording started, so live segment timestamps match the audio."""

    def post(self, request, pk):
        meeting = _own(request, pk)
        try:
            epoch_ms = int(request.data.get("recording_started_at_ms"))
        except (TypeError, ValueError):
            return Response({"recording_started_at_ms": ["Required: milliseconds since epoch."]}, status=400)
        started = services.epoch_ms_to_datetime(epoch_ms)
        if abs((started - timezone.now()).total_seconds()) > 3600:
            return Response({"recording_started_at_ms": ["Timestamp is not plausible."]}, status=400)
        meeting.live_started_at = started
        meeting.save(update_fields=["live_started_at", "updated_at"])
        return Response(status=204)


class CallTranscriptConsentView(APIView):
    """Translated calls: the transcript is saved only after EVERY participant agrees."""

    def post(self, request, code):
        room = get_object_or_404(CallRoom, code=code.strip().upper())
        me = room.participants.filter(user=request.user).first()
        if me is None:
            return Response({"detail": "You are not a participant in this call."}, status=403)
        if room.is_ended:
            return Response({"detail": "This call has ended."}, status=410)
        save = bool(request.data.get("save", True))
        me.transcript_consent = save
        me.save(update_fields=["transcript_consent"])
        participants = list(room.participants.all())
        everyone = len(participants) >= 2 and all(p.transcript_consent for p in participants)
        changed = everyone != room.save_transcript
        room.save_transcript = everyone
        room.save(update_fields=["save_transcript"])
        if everyone:
            now = timezone.now()
            for p in participants:
                Meeting.objects.get_or_create(
                    owner=p.user,
                    call_room=room,
                    source=Meeting.Source.CALL,
                    defaults={
                        "title": f"Call {room.code} · " + ", ".join(x.display_name for x in participants),
                        "status": Meeting.Status.LIVE,
                        "consent_confirmed_at": now,
                        "recorded_at": room.started_at or now,
                        "transcription_engine": "live",
                    },
                )
        else:
            # Consent withdrawn: stop collecting; already-saved text stays until the owner deletes it.
            Meeting.objects.filter(call_room=room, status=Meeting.Status.LIVE).update(status=Meeting.Status.COMPLETED)
        pushed = livekit_service.update_room_metadata(room) if changed else True
        return Response(
            {
                "save_transcript": room.save_transcript,
                "my_consent": me.transcript_consent,
                "waiting_for": [p.display_name for p in participants if not p.transcript_consent],
                "live_update_applied": bool(pushed),
            }
        )


class InternalMeetingSegmentView(APIView):
    """Worker -> backend: one finalized live utterance (stored only for rooms with save_transcript)."""

    authentication_classes = []
    permission_classes = [WorkerSecretPermission]
    throttle_classes = []

    def post(self, request):
        data = InternalSegmentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        room = get_object_or_404(CallRoom, livekit_room_name=data.validated_data["room_name"])
        if not room.save_transcript:
            return Response({"stored": 0, "save_transcript": False})
        stored = services.ingest_live_segment(room, data.validated_data)
        return Response({"stored": stored, "save_transcript": True}, status=status.HTTP_200_OK)
