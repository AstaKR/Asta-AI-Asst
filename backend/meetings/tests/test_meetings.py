import io
import json
import zipfile
from datetime import timedelta

import httpx
import numpy as np
import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from calls.models import CallRoom
from meetings import audio as A
from meetings import services
from meetings.errors import ProviderQuotaError, ProviderUnavailable
from meetings.models import Meeting, MeetingJob, TranscriptSegment
from meetings.sarvam_client import SarvamClient
from meetings.summary.schema import Action, MeetingNotes, Point, ground
from meetings.transcription.base import Segment, Transcriber
from meetings.transcription.sarvam import SarvamTranscriber

User = get_user_model()
PASSWORD = "c0rrect-Horse-battery"
WORKER_SECRET = "worker-secret-for-tests"
RATE = 16000


@pytest.fixture(autouse=True)
def _settings(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.SARVAM_API_KEY = "test-key"
    settings.SARVAM_MIN_REQUEST_INTERVAL = 0
    settings.WORKER_SHARED_SECRET = WORKER_SECRET
    settings.SUMMARY_PROVIDER = "anthropic"
    settings.ANTHROPIC_API_KEY = "test-anthropic"
    settings.MEETING_AUTO_SUMMARY = False
    settings.MEETING_STT_ENGINE = "sarvam"
    settings.LIVEKIT_API_KEY = "testkey"
    settings.LIVEKIT_API_SECRET = "testsecret-testsecret-testsecret-0123"
    settings.LIVEKIT_URL = "ws://localhost:7880"
    settings.DAILY_LIMITS = {"call_seconds": 36000, "stt_seconds": 3600, "tts_chars": 100000, "translate_chars": 100000}
    cache.clear()


@pytest.fixture(autouse=True)
def _no_livekit(monkeypatch):
    monkeypatch.setattr("calls.livekit_service.delete_room", lambda room: True)
    monkeypatch.setattr("calls.livekit_service.update_room_metadata", lambda room: True)


def client_for(username: str) -> APIClient:
    User.objects.create_user(username=username, password=PASSWORD)
    c = APIClient()
    assert c.login(username=username, password=PASSWORD)
    return c


def tone(seconds: float, freq: float = 300) -> np.ndarray:
    t = np.arange(int(RATE * seconds)) / RATE
    return (8000 * np.sin(2 * np.pi * freq * t)).astype(np.int16)


def speech_like_wav() -> bytes:
    """2 s 'speech', 1 s pause, 3 s 'speech' -> two segments at 0 s and ~2.8 s."""
    pcm = np.concatenate([tone(2), np.zeros(RATE, np.int16), tone(3)]).tobytes()
    return A.wav_bytes(pcm)


def upload(c: APIClient, data: bytes | None = None, name: str = "meeting.wav", **extra):
    body = {
        "file": SimpleUploadedFile(name, data if data is not None else speech_like_wav(), content_type="audio/wav"),
        "title": "Weekly sync",
        "spoken_language": "ta",
        "translation_language": "hi",
        "consent": "true",
        **extra,
    }
    return c.post("/api/meetings/", body, format="multipart")


def sarvam_mock(seen: list, transcripts=("வணக்கம் ரவி", "நாளை அறிக்கை அனுப்புவேன்")):
    texts = iter(transcripts)

    def handler(request: httpx.Request):
        seen.append(request)
        if request.url.path == "/speech-to-text":
            return httpx.Response(200, json={"transcript": next(texts, ""), "language_code": "ta-IN"})
        body = json.loads(request.content)
        return httpx.Response(200, json={"translated_text": f"[{body['target_language_code']}] {body['input']}"})

    return SarvamClient(api_key="k", http=httpx.Client(base_url="https://api.sarvam.ai", transport=httpx.MockTransport(handler)), min_interval=0)


def run_all(**kwargs):
    while (job := services.claim_next()) is not None:
        services.run_job(job, **kwargs)


# ---------- uploads ----------


@pytest.mark.django_db
def test_upload_queues_transcription():
    c = client_for("anand")
    res = upload(c)
    assert res.status_code == 201, res.content
    body = res.json()
    assert body["status"] == "queued" and body["duration_seconds"] == pytest.approx(6.0, abs=0.05)
    assert MeetingJob.objects.filter(kind="transcribe", status="queued").count() == 1


@pytest.mark.django_db
@pytest.mark.parametrize(
    "data,name,expected",
    [
        (b"not audio" * 100, "fake.mp3", "could not be read as audio"),
        (speech_like_wav(), "notes.exe", "Unsupported file type"),
        (b"", "empty.wav", "empty"),
    ],
    ids=["corrupt", "bad-extension", "empty"],
)
def test_upload_validation(data, name, expected):
    c = client_for("anand")
    res = upload(c, data=data, name=name)
    assert res.status_code == 400
    assert expected.lower() in json.dumps(res.json()).lower()
    assert Meeting.objects.count() == 0


@pytest.mark.django_db
def test_upload_size_and_duration_limits(settings):
    c = client_for("anand")
    settings.MEETING_MAX_UPLOAD_MB = 0
    assert upload(c).status_code == 400
    settings.MEETING_MAX_UPLOAD_MB = 200
    settings.MEETING_MAX_DURATION_SECONDS = 3
    res = upload(c)
    assert res.status_code == 400 and "longer than" in json.dumps(res.json())


@pytest.mark.django_db
def test_upload_requires_consent_and_valid_languages():
    c = client_for("anand")
    assert upload(c, consent="false").status_code == 400
    assert upload(c, spoken_language="fr").status_code == 400
    assert upload(c, translation_language="xx").status_code == 400


@pytest.mark.django_db
def test_unavailable_local_engine_is_refused():
    c = client_for("anand")
    res = upload(c, engine="local")
    assert res.status_code == 503 and res.json()["code"] == "engine_unavailable"


@pytest.mark.django_db
def test_requires_authentication():
    assert APIClient().get("/api/meetings/").status_code == 403


# ---------- transcription workflow ----------


@pytest.mark.django_db
def test_transcription_preserves_chunk_offsets_and_translation_separately():
    c = client_for("anand")
    meeting_id = upload(c).json()["id"]
    seen: list = []
    client = sarvam_mock(seen)
    run_all(transcriber=SarvamTranscriber(client=client), client=client)
    meeting = Meeting.objects.get(pk=meeting_id)
    assert meeting.status == "completed", meeting.error_message
    segs = list(meeting.segments.all())
    assert len(segs) == 2
    # Offsets come from the pause-based split of the ORIGINAL timeline.
    assert segs[0].start_ms == 0 and 2000 <= segs[0].end_ms <= 2400
    assert 2600 <= segs[1].start_ms <= 3000 and segs[1].end_ms == pytest.approx(6000, abs=40)
    assert segs[0].original_text == "வணக்கம் ரவி"
    assert segs[0].translated_text == "[hi-IN] வணக்கம் ரவி" and segs[0].translation_language == "hi"
    assert segs[0].language == "ta"
    stt_calls = [r for r in seen if r.url.path == "/speech-to-text"]
    assert len(stt_calls) == 2 and b'name="language_code"' in stt_calls[0].content
    assert meeting.stt_seconds == pytest.approx(5.8, abs=0.6)
    assert meeting.translate_chars == sum(len(s.original_text) for s in segs)
    assert meeting.audio_playback  # seekable MP3 created


@pytest.mark.django_db
def test_audio_streaming_supports_range_and_is_private():
    c = client_for("anand")
    meeting_id = upload(c).json()["id"]
    client = sarvam_mock([])
    run_all(transcriber=SarvamTranscriber(client=client), client=client)
    full = c.get(f"/api/meetings/{meeting_id}/audio/")
    assert full.status_code == 200 and full["Accept-Ranges"] == "bytes"
    part = c.get(f"/api/meetings/{meeting_id}/audio/", HTTP_RANGE="bytes=100-199")
    assert part.status_code == 206 and part["Content-Range"].startswith("bytes 100-199/")
    assert len(b"".join(part.streaming_content)) == 100
    other = client_for("intruder")
    assert other.get(f"/api/meetings/{meeting_id}/audio/").status_code == 404


class FailingTranscriber(Transcriber):
    name = "sarvam"

    def __init__(self, exc):
        super().__init__()
        self.exc = exc

    def transcribe(self, pcm, rate, language, on_progress=None):
        raise self.exc


@pytest.mark.django_db
def test_failed_job_marks_meeting_failed_without_retry_for_quota():
    c = client_for("anand")
    meeting_id = upload(c).json()["id"]
    run_all(transcriber=FailingTranscriber(ProviderQuotaError("Sarvam credits are exhausted.")))
    meeting = Meeting.objects.get(pk=meeting_id)
    job = meeting.jobs.get()
    assert meeting.status == "failed" and "credits" in meeting.error_message
    assert job.status == "failed" and job.attempts == 1


@pytest.mark.django_db
def test_retryable_failures_retry_then_fail():
    c = client_for("anand")
    meeting_id = upload(c).json()["id"]
    run_all(transcriber=FailingTranscriber(ProviderUnavailable("Sarvam timed out.")))
    job = MeetingJob.objects.get(meeting_id=meeting_id)
    assert job.status == "failed" and job.attempts == services.MAX_ATTEMPTS
    # The user can retry later.
    res = c.post(f"/api/meetings/{meeting_id}/transcribe/")
    assert res.status_code == 202 and res.json()["status"] == "queued"


@pytest.mark.django_db
def test_daily_budget_blocks_paid_transcription(settings):
    settings.DAILY_LIMITS = {**settings.DAILY_LIMITS, "stt_seconds": 1}
    c = client_for("anand")
    meeting_id = upload(c).json()["id"]
    client = sarvam_mock([])
    run_all(transcriber=SarvamTranscriber(client=client), client=client)
    meeting = Meeting.objects.get(pk=meeting_id)
    assert meeting.status == "failed" and "limit" in meeting.error_message


@pytest.mark.django_db
def test_meeting_usage_counts_toward_daily_totals():
    from calls.usage import daily_totals

    c = client_for("anand")
    upload(c)
    client = sarvam_mock([])
    run_all(transcriber=SarvamTranscriber(client=client), client=client)
    assert daily_totals()["stt_seconds"] > 5


@pytest.mark.django_db
def test_stale_running_job_is_recovered():
    c = client_for("anand")
    meeting_id = upload(c).json()["id"]
    job = services.claim_next()
    MeetingJob.objects.filter(pk=job.pk).update(started_at=timezone.now() - timedelta(hours=2))
    assert services.recover_stale(minutes=60) == 1
    assert MeetingJob.objects.get(pk=job.pk).status == "queued"
    assert Meeting.objects.get(pk=meeting_id)


# ---------- summaries ----------


class FakeSummarizer:
    name, model = "fake", "fake-1"

    def __init__(self, notes: MeetingNotes):
        self.notes = notes
        self.calls = []

    def summarize(self, title, lines, language):
        self.calls.append((title, lines, language))
        return self.notes


def make_transcribed_meeting(owner_client) -> Meeting:
    meeting_id = upload(owner_client).json()["id"]
    client = sarvam_mock([], transcripts=("Ravi will send the report by Friday", "We decided to hire two engineers"))
    run_all(transcriber=SarvamTranscriber(client=client), client=client)
    return Meeting.objects.get(pk=meeting_id)


def test_grounding_never_invents_owners_deadlines_or_decisions():
    segments = {0: ("Ravi will send the report by Friday", ""), 1: ("We decided to hire two engineers", "")}
    notes = MeetingNotes(
        summary="Hiring and reporting.",
        key_points=[Point(text="Report", segments=[0]), Point(text="No evidence", segments=[]), Point(text="Bad ref", segments=[7])],
        decisions=[Point(text="Hire two engineers", segments=[1]), Point(text="Invented decision", segments=[])],
        action_items=[
            Action(text="Send report", owner="Ravi", owner_quote="Ravi", deadline="Friday", deadline_quote="by Friday", segments=[0]),
            Action(text="Book venue", owner="Priya", owner_quote="Priya", deadline="Monday", deadline_quote="Monday", segments=[1]),
            Action(text="Unsupported", owner=None, owner_quote=None, deadline=None, deadline_quote=None, segments=[]),
        ],
        open_questions=[],
    )
    out = ground(notes, segments)
    assert [p["text"] for p in out["key_points"]] == ["Report"]
    assert [d["text"] for d in out["decisions"]] == ["Hire two engineers"]
    assert out["action_items"][0] == {"text": "Send report", "owner": "Ravi", "deadline": "Friday", "segments": [0]}
    # Owner/deadline not stated in the cited transcript text are blanked, never kept.
    assert out["action_items"][1]["owner"] is None and out["action_items"][1]["deadline"] is None
    assert len(out["action_items"]) == 2


@pytest.mark.django_db
def test_summary_job_saves_grounded_notes_and_action_items():
    c = client_for("anand")
    meeting = make_transcribed_meeting(c)
    notes = MeetingNotes(
        summary="The team discussed hiring.",
        key_points=[Point(text="Report due", segments=[0])],
        decisions=[Point(text="Hire two engineers", segments=[1])],
        action_items=[Action(text="Send report", owner="Ravi", owner_quote="Ravi", deadline="Friday", deadline_quote="by Friday", segments=[0])],
        open_questions=[],
    )
    res = c.post(f"/api/meetings/{meeting.pk}/summarize/", {"language": "en"}, format="json")
    assert res.status_code == 202
    fake = FakeSummarizer(notes)
    run_all(summarizer=fake)
    detail = c.get(f"/api/meetings/{meeting.pk}/").json()
    assert detail["summary"]["decisions"][0]["text"] == "Hire two engineers"
    assert detail["action_items"][0]["owner_name"] == "Ravi" and detail["action_items"][0]["deadline"] == "Friday"
    assert detail["summary_model"] == "fake:fake-1" and detail["status"] == "completed"
    assert fake.calls[0][2] == "en" and len(fake.calls[0][1]) == 2
    # Action items can be ticked off.
    item_id = detail["action_items"][0]["id"]
    assert c.patch(f"/api/meetings/{meeting.pk}/action-items/{item_id}/", {"done": True}, format="json").json()["done"] is True


@pytest.mark.django_db
def test_summary_disabled_returns_503(settings):
    settings.ANTHROPIC_API_KEY = ""
    c = client_for("anand")
    meeting = make_transcribed_meeting(c)
    res = c.post(f"/api/meetings/{meeting.pk}/summarize/", {}, format="json")
    assert res.status_code == 503 and res.json()["code"] == "summaries_disabled"


@pytest.mark.django_db
def test_anthropic_provider_request_shape_and_validation(settings):
    from meetings.summary.anthropic_provider import AnthropicSummaryProvider
    from meetings.summary.base import TranscriptLine

    captured = {}

    class Msgs:
        def create(self, **kwargs):
            captured.update(kwargs)

            class Block:
                type = "text"
                text = json.dumps({"summary": "ok", "key_points": [], "decisions": [], "action_items": [], "open_questions": []})

            class Resp:
                stop_reason = "end_turn"
                content = [Block()]

            return Resp()

    class Beta:
        messages = Msgs()

    class FakeClient:
        beta = Beta()

    provider = AnthropicSummaryProvider(client=FakeClient())
    notes = provider.summarize("T", [TranscriptLine(0, 0, "", "hello", "")], "ta")
    assert notes.summary == "ok"
    assert captured["model"] == settings.SUMMARY_MODEL
    assert captured["output_config"]["format"]["type"] == "json_schema"
    assert captured["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in captured["betas"]
    assert "Tamil" in captured["system"]


# ---------- history, search, authorization, edits, exports ----------


@pytest.mark.django_db
def test_search_filters_pagination_and_isolation(settings):
    a = client_for("anand")
    m1 = make_transcribed_meeting(a)
    Meeting.objects.filter(pk=m1.pk).update(title="Budget review", summary_text="quarterly numbers")
    m2 = make_transcribed_meeting(a)
    Meeting.objects.filter(pk=m2.pk).update(title="Hiring plan", recorded_at=timezone.now() - timedelta(days=10), spoken_language="en")
    b = client_for("bharat")
    make_transcribed_meeting(b)

    def titles(client, **params):
        return [r["title"] for r in client.get("/api/meetings/", params).json()["results"]]

    assert set(titles(a)) == {"Budget review", "Hiring plan"}  # never another user's meetings
    assert titles(a, q="budget") == ["Budget review"]  # title
    assert titles(a, q="quarterly") == ["Budget review"]  # summary
    assert set(titles(a, q="Ravi will send")) == {"Budget review", "Hiring plan"}  # transcript text
    assert set(titles(a, q="[hi-IN]")) == {"Budget review", "Hiring plan"}  # translation
    since = (timezone.localdate() - timedelta(days=2)).isoformat()
    assert titles(a, date_from=since) == ["Budget review"]
    assert titles(a, language="en") != [] and "Budget review" in titles(a, language="hi")
    assert titles(a, status="failed") == []
    page = a.get("/api/meetings/", {"page_size": 1}).json()
    assert page["count"] == 2 and len(page["results"]) == 1 and page["next"]
    # Other users get 404 for every per-meeting endpoint.
    for path in ("", "audio/", "export/?kind=txt"):
        assert b.get(f"/api/meetings/{m1.pk}/{path}").status_code == 404
    assert b.patch(f"/api/meetings/{m1.pk}/segments/0/", {"original_text": "x"}, format="json").status_code == 404
    assert b.delete(f"/api/meetings/{m1.pk}/").status_code == 404


@pytest.mark.django_db
def test_segment_correction():
    c = client_for("anand")
    meeting = make_transcribed_meeting(c)
    res = c.patch(f"/api/meetings/{meeting.pk}/segments/1/", {"original_text": "We decided to hire three engineers"}, format="json")
    assert res.status_code == 200 and res.json()["edited_at"]
    assert TranscriptSegment.objects.get(meeting=meeting, index=1).original_text.endswith("three engineers")


@pytest.mark.django_db
def test_exports_txt_and_docx():
    c = client_for("anand")
    meeting = make_transcribed_meeting(c)
    txt = c.get(f"/api/meetings/{meeting.pk}/export/", {"kind": "txt"})
    body = txt.content.decode("utf-8")
    assert txt.status_code == 200 and "Weekly sync" in body
    assert "[00:00 - 00:02] Ravi will send the report by Friday" in body
    assert "(Hindi) [hi-IN] Ravi will send" in body
    docx = c.get(f"/api/meetings/{meeting.pk}/export/", {"kind": "docx"})
    assert docx.status_code == 200 and "attachment" in docx["Content-Disposition"]
    xml = zipfile.ZipFile(io.BytesIO(docx.content)).read("word/document.xml").decode("utf-8")
    assert "Weekly sync" in xml and "We decided to hire two engineers" in xml and "[hi-IN]" in xml
    assert c.get(f"/api/meetings/{meeting.pk}/export/", {"kind": "pdf"}).status_code == 400


@pytest.mark.django_db
def test_delete_removes_files():
    c = client_for("anand")
    meeting = make_transcribed_meeting(c)
    path = meeting.audio.path
    assert c.delete(f"/api/meetings/{meeting.pk}/").status_code == 204
    import os

    assert not os.path.exists(path) and not Meeting.objects.filter(pk=meeting.pk).exists()


# ---------- LiveKit: live meetings and call transcripts ----------


def post_segment(room: CallRoom, utt: str, text: str, start_ms: int, end_ms: int, **extra):
    body = {
        "room_name": room.livekit_room_name,
        "utterance_id": utt,
        "speaker_name": "Anand",
        "language": "ta-IN",
        "text": text,
        "start_epoch_ms": start_ms,
        "end_epoch_ms": end_ms,
        **extra,
    }
    return APIClient().post("/api/internal/meeting-segments/", body, format="json", HTTP_X_WORKER_SECRET=WORKER_SECRET)


@pytest.mark.django_db
def test_live_meeting_flow():
    from livekit import api as lkapi

    c = client_for("anand")
    res = c.post(
        "/api/meetings/live/",
        {"title": "Site visit", "spoken_language": "ta", "translation_language": "en", "voice_playback": True, "consent": True},
        format="json",
    )
    assert res.status_code == 201, res.content
    meeting_id, code = res.json()["meeting"]["id"], res.json()["room_code"]
    room = CallRoom.objects.get(code=code)
    assert room.mode == "meeting" and room.save_transcript
    token = c.post(f"/api/rooms/{code}/token/").json()["token"]
    claims = lkapi.TokenVerifier("testkey", "testsecret-testsecret-testsecret-0123").verify(token)
    assert json.loads(claims.room_config.metadata)["mode"] == "meeting"
    assert claims.attributes["listen_language"] == "en-IN" and claims.attributes["voice_playback"] == "on"

    started = int(timezone.now().timestamp() * 1000)
    assert c.post(f"/api/meetings/{meeting_id}/live-started/", {"recording_started_at_ms": started}, format="json").status_code == 204
    assert post_segment(room, "u1", "வணக்கம்", started + 1500, started + 3000).json()["stored"] == 1
    # The translation arrives later for the same utterance: updated in place, not duplicated.
    post_segment(room, "u1", "வணக்கம்", started + 1500, started + 3200, translation="Hello", translation_language="en-IN")
    seg = TranscriptSegment.objects.get(meeting_id=meeting_id)
    assert (seg.start_ms, seg.end_ms, seg.translated_text, seg.origin) == (1500, 3200, "Hello", "live")

    c.post(f"/api/rooms/{code}/end/")
    assert Meeting.objects.get(pk=meeting_id).status == "completed"


@pytest.mark.django_db
def test_worker_segment_endpoint_requires_secret_and_consent():
    a, b = client_for("anand"), client_for("bharat")
    code = a.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json").json()["code"]
    b.post(f"/api/rooms/{code}/join/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"}, format="json")
    room = CallRoom.objects.get(code=code)
    now = int(timezone.now().timestamp() * 1000)
    body = {"room_name": room.livekit_room_name, "utterance_id": "x", "text": "hi", "start_epoch_ms": now, "end_epoch_ms": now}
    assert APIClient().post("/api/internal/meeting-segments/", body, format="json").status_code == 403
    assert post_segment(room, "u1", "hello", now, now + 500).json() == {"stored": 0, "save_transcript": False}

    first = a.post(f"/api/rooms/{code}/transcript/", {"save": True}, format="json").json()
    assert first["save_transcript"] is False and first["waiting_for"] == ["bharat"]
    second = b.post(f"/api/rooms/{code}/transcript/", {"save": True}, format="json").json()
    assert second["save_transcript"] is True
    assert post_segment(room, "u2", "hello", now, now + 500).json()["stored"] == 2  # one copy per participant
    assert {m.owner.username for m in Meeting.objects.filter(call_room=room)} == {"anand", "bharat"}
    # Consent withdrawn: nothing more is stored.
    a.post(f"/api/rooms/{code}/transcript/", {"save": False}, format="json")
    assert post_segment(room, "u3", "more", now, now + 500).json()["stored"] == 0
    outsider = client_for("outsider")
    assert outsider.post(f"/api/rooms/{code}/transcript/", {"save": True}, format="json").status_code == 403


# ---------- existing translator unaffected ----------


@pytest.mark.django_db
def test_existing_call_flow_still_works():
    a = client_for("anand")
    code = a.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json").json()["code"]
    tok = a.post(f"/api/rooms/{code}/token/")
    assert tok.status_code == 200 and CallRoom.objects.get(code=code).mode == "call"


@pytest.mark.django_db
def test_exports_csv_json_and_subtitles():
    c = client_for("anand")
    meeting = make_transcribed_meeting(c)
    url = f"/api/meetings/{meeting.pk}/export/"
    csv_body = c.get(url, {"kind": "csv"}).content.decode("utf-8")
    assert csv_body.startswith("﻿index,start,end") and "Ravi will send the report by Friday" in csv_body
    data = c.get(url, {"kind": "json"}).json()
    assert data["title"] == "Weekly sync" and data["segments"][0]["start_ms"] == 0 and "action_items" in data
    srt = c.get(url, {"kind": "srt"}).content.decode("utf-8")
    assert srt.startswith("1\n00:00:00,000 --> 00:00:02,") and "Ravi will send" in srt
    vtt = c.get(url, {"kind": "vtt", "text": "translation"})
    assert vtt.content.decode("utf-8").startswith("WEBVTT\n\n00:00:00.000 --> ") and "-translated.vtt" in vtt["Content-Disposition"]
    # another user's meeting stays private
    assert client_for("other").get(url, {"kind": "json"}).status_code == 404


# ---------- call recording ----------


def wav_file(seconds: float) -> bytes:
    buf = io.BytesIO()
    import wave

    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((tone(seconds) * 8000).astype("<i2").tobytes())
    return buf.getvalue()


def post_recording(room: CallRoom, started_ms: int, data: bytes, secret: str = WORKER_SECRET):
    f = SimpleUploadedFile("call.wav", data, content_type="audio/wav")
    return APIClient().post(
        "/api/internal/call-recording/",
        {"room_name": room.livekit_room_name, "started_epoch_ms": started_ms, "file": f},
        format="multipart",
        HTTP_X_WORKER_SECRET=secret,
    )


def consented_call():
    a, b = client_for("anand"), client_for("bharat")
    code = a.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json").json()["code"]
    b.post(f"/api/rooms/{code}/join/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"}, format="json")
    a.post(f"/api/rooms/{code}/transcript/", {"save": True}, format="json")
    res = b.post(f"/api/rooms/{code}/transcript/", {"save": True}, format="json").json()
    assert res["save_transcript"] and res["records_audio"]
    return a, CallRoom.objects.get(code=code)


@pytest.mark.django_db
def test_room_metadata_asks_worker_to_record_calls_only(settings):
    from calls import livekit_service

    a = client_for("anand")
    code = a.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json").json()["code"]
    assert json.loads(livekit_service.room_metadata(CallRoom.objects.get(code=code)))["record_audio"] is True
    settings.CALL_RECORDING_ENABLED = False
    assert json.loads(livekit_service.room_metadata(CallRoom.objects.get(code=code)))["record_audio"] is False


@pytest.mark.django_db
def test_call_recording_is_attached_to_every_saved_transcript_and_retimed():
    a, room = consented_call()
    meetings = list(Meeting.objects.filter(call_room=room))
    consent_ms = int(meetings[0].live_started_at.timestamp() * 1000)
    post_segment(room, "u1", "வணக்கம்", consent_ms + 2000, consent_ms + 3000)
    # The worker started recording 500 ms after consent: segment times move 500 ms earlier.
    res = post_recording(room, consent_ms + 500, wav_file(4))
    assert res.status_code == 201 and res.json()["stored"] == 2
    for m in Meeting.objects.filter(call_room=room):
        assert m.audio.name.endswith("original.wav") and m.audio_size > 0
        assert m.duration_seconds == pytest.approx(4, abs=0.1)
        seg = m.segments.get()
        assert seg.start_ms == pytest.approx(1500, abs=1) and seg.end_ms == pytest.approx(2500, abs=1)
        assert m.jobs.get().kind == "prepare"
    run_all()
    m = Meeting.objects.get(call_room=room, owner__username="anand")
    assert m.audio_playback and m.status == "live"  # playback ready; the transcript status is untouched
    assert a.get(f"/api/meetings/{m.id}/audio/").status_code in (200, 206)
    # A second upload for the same call does not replace the stored audio.
    assert post_recording(room, consent_ms, wav_file(1)).json()["stored"] == 0


@pytest.mark.django_db
def test_call_recording_needs_secret_consent_and_setting(settings):
    a = client_for("carol")
    code = a.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json").json()["code"]
    room = CallRoom.objects.get(code=code)
    now = int(timezone.now().timestamp() * 1000)
    assert post_recording(room, now, wav_file(1), secret="wrong").status_code == 403
    assert post_recording(room, now, wav_file(1)).json() == {"stored": 0}  # nobody agreed: nothing kept
    _, room = consented_call()
    settings.CALL_RECORDING_ENABLED = False
    assert post_recording(room, now, wav_file(1)).json() == {"stored": 0}
    settings.CALL_RECORDING_ENABLED = True
    assert post_recording(room, now, b"not audio" * 100).status_code == 400
