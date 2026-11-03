import json
from datetime import timedelta
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from livekit import api as lkapi
from rest_framework.test import APIClient

from calls.models import CallRoom, CallUsage

User = get_user_model()
PASSWORD = "c0rrect-Horse-battery"
WORKER_SECRET = "test-worker-secret"


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.LIVEKIT_URL = "ws://localhost:7880"
    settings.LIVEKIT_API_KEY = "testkey"
    settings.LIVEKIT_API_SECRET = "testsecret-testsecret-testsecret-0123"
    settings.WORKER_SHARED_SECRET = WORKER_SECRET
    settings.TRANSLATION_ENABLED = True
    settings.MAX_PARTICIPANTS = 2
    settings.MAX_CALL_DURATION_SECONDS = 600
    settings.DAILY_LIMITS = {"call_seconds": 3600, "stt_seconds": 100, "tts_chars": 1000, "translate_chars": 2000}
    settings.PER_CALL_LIMITS = {"stt_seconds": 60, "tts_chars": 500, "translate_chars": 1000}
    cache.clear()


@pytest.fixture(autouse=True)
def _no_livekit_network():
    with (
        mock.patch("calls.livekit_service.delete_room", return_value=True) as delete_room,
        mock.patch("calls.livekit_service.update_participant_attributes", return_value=True),
    ):
        yield delete_room


def make_client(username: str) -> APIClient:
    User.objects.create_user(username=username, password=PASSWORD)
    client = APIClient()
    assert client.login(username=username, password=PASSWORD)
    return client


@pytest.fixture
def host():
    return make_client("host_user")


@pytest.fixture
def guest():
    return make_client("guest_user")


def create_room(client, spoken="ta-IN", listen="ta-IN"):
    res = client.post("/api/rooms/", {"spoken_language": spoken, "listen_language": listen}, format="json")
    assert res.status_code == 201, res.content
    return res.json()


def decode(token: str):
    return lkapi.TokenVerifier("testkey", "testsecret-testsecret-testsecret-0123").verify(token)


# ---------- health & auth ----------


@pytest.mark.django_db
def test_health_is_public():
    res = APIClient().get("/api/health/")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["database"] is True


@pytest.mark.django_db
def test_register_login_me_flow():
    client = APIClient()
    res = client.post(
        "/api/auth/register/", {"username": "executive1", "password": PASSWORD, "display_name": "Anand"}, format="json"
    )
    assert res.status_code == 201, res.content
    assert res.json()["preferences"]["display_name"] == "Anand"
    assert client.get("/api/auth/me/").json()["username"] == "executive1"
    client.post("/api/auth/logout/")
    assert client.get("/api/auth/me/").status_code == 403
    res = client.post("/api/auth/login/", {"username": "executive1", "password": "wrong"}, format="json")
    assert res.status_code == 400


@pytest.mark.django_db
def test_register_rejects_weak_password():
    res = APIClient().post("/api/auth/register/", {"username": "weakling", "password": "12345678"}, format="json")
    assert res.status_code == 400
    assert "password" in res.json()


@pytest.mark.django_db
def test_rooms_require_authentication():
    assert APIClient().post("/api/rooms/", {}, format="json").status_code == 403


# ---------- languages ----------


@pytest.mark.django_db
def test_language_preference_validation(host):
    ok = host.put("/api/preferences/", {"spoken_language": "hi-IN", "listen_language": "ta-IN"}, format="json")
    assert ok.status_code == 200
    bad = host.put("/api/preferences/", {"spoken_language": "fr-FR"}, format="json")
    assert bad.status_code == 400
    assert host.put("/api/preferences/", {"voice": "not-a-voice"}, format="json").status_code == 400
    assert host.put("/api/preferences/", {"original_voice_volume": 101}, format="json").status_code == 400


@pytest.mark.django_db
def test_room_rejects_unsupported_language(host):
    res = host.post("/api/rooms/", {"spoken_language": "xx", "listen_language": "ta-IN"}, format="json")
    assert res.status_code == 400


# ---------- rooms & authorization ----------


@pytest.mark.django_db
def test_create_and_join_room(host, guest):
    room = create_room(host)
    code = room["code"]
    assert room["status"] == "waiting"
    assert len(room["participants"]) == 1
    preview = guest.get(f"/api/rooms/{code}/").json()
    assert "participants" not in preview and preview["host_name"] == "host_user"
    res = guest.post(f"/api/rooms/{code}/join/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"}, format="json")
    assert res.status_code == 200
    assert {p["role"] for p in res.json()["participants"]} == {"host", "guest"}


@pytest.mark.django_db
def test_room_full(host, guest):
    code = create_room(host)["code"]
    guest.post(f"/api/rooms/{code}/join/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"}, format="json")
    third = make_client("third_user")
    res = third.post(f"/api/rooms/{code}/join/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"}, format="json")
    assert res.status_code == 409
    assert res.json()["code"] == "room_full"


@pytest.mark.django_db
def test_expired_invite(host, guest):
    code = create_room(host)["code"]
    CallRoom.objects.filter(code=code).update(invite_expires_at=timezone.now() - timedelta(seconds=1))
    res = guest.post(f"/api/rooms/{code}/join/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"}, format="json")
    assert res.status_code == 410


@pytest.mark.django_db
def test_non_member_cannot_get_token_or_end(host, guest):
    code = create_room(host)["code"]
    assert guest.post(f"/api/rooms/{code}/token/").status_code == 403
    assert guest.post(f"/api/rooms/{code}/end/").status_code == 403
    assert guest.patch(
        f"/api/rooms/{code}/languages/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"}, format="json"
    ).status_code == 403


# ---------- tokens ----------


@pytest.mark.django_db
def test_token_grants_are_scoped(host):
    room = create_room(host, spoken="ta-IN", listen="ta-IN")
    res = host.post(f"/api/rooms/{room['code']}/token/")
    assert res.status_code == 200, res.content
    body = res.json()
    assert body["url"] == "ws://localhost:7880"
    claims = decode(body["token"])
    db_room = CallRoom.objects.get(code=room["code"])
    assert claims.identity == "user-%d" % User.objects.get(username="host_user").id
    assert claims.video.room == db_room.livekit_room_name
    assert claims.video.room_join is True
    assert claims.video.can_publish_sources == ["microphone"]
    assert claims.video.can_publish_data is False
    assert not claims.video.room_admin and not claims.video.room_create
    assert claims.attributes["spoken_language"] == "ta-IN"
    assert claims.attributes["listen_language"] == "ta-IN"
    # Agent is explicitly dispatched with limits in metadata.
    agents = list(claims.room_config.agents)
    assert agents and agents[0].agent_name == "call-translator"
    assert json.loads(agents[0].metadata)["max_duration_seconds"] == 600
    assert claims.room_config.max_participants == 3
    db_room.refresh_from_db()
    assert db_room.status == "active" and db_room.started_at is not None


@pytest.mark.django_db
def test_video_call_allows_camera(host, guest):
    res = host.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN", "video": True}, format="json")
    assert res.status_code == 201 and res.json()["video_enabled"] is True
    code = res.json()["code"]
    claims = decode(host.post(f"/api/rooms/{code}/token/").json()["token"])
    assert claims.video.can_publish_sources == ["microphone", "camera"]
    assert claims.video.can_publish_data is False
    # The invitee sees that it is a video call before joining.
    assert guest.get(f"/api/rooms/{code}/").json()["video_enabled"] is True


@pytest.mark.django_db
def test_video_calls_can_be_disabled(host, settings):
    settings.VIDEO_CALLS_ENABLED = False
    res = host.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN", "video": True}, format="json")
    assert res.status_code == 400 and res.json()["code"] == "video_disabled"
    assert create_room(host)["video_enabled"] is False


@pytest.mark.django_db
def test_token_ttl_is_short(host, settings):
    settings.LIVEKIT_TOKEN_TTL_SECONDS = 300
    room = create_room(host)
    token = host.post(f"/api/rooms/{room['code']}/token/").json()["token"]
    import jwt  # PyJWT, installed with livekit-api

    payload = jwt.decode(token, options={"verify_signature": False})
    assert payload["exp"] - payload["nbf"] <= 300


@pytest.mark.django_db
def test_no_agent_dispatch_when_translation_disabled(host, settings):
    settings.TRANSLATION_ENABLED = False
    room = create_room(host)
    assert room["translation_enabled"] is False
    claims = decode(host.post(f"/api/rooms/{room['code']}/token/").json()["token"])
    assert len(claims.room_config.agents) == 0


@pytest.mark.django_db
def test_token_refused_when_livekit_not_configured(host, settings):
    settings.LIVEKIT_API_SECRET = ""
    room = create_room(host)
    assert host.post(f"/api/rooms/{room['code']}/token/").status_code == 503


@pytest.mark.django_db
def test_ended_room_refuses_token_and_join(host, guest, _no_livekit_network):
    code = create_room(host)["code"]
    host.post(f"/api/rooms/{code}/token/")
    res = host.post(f"/api/rooms/{code}/end/")
    assert res.status_code == 200 and res.json()["status"] == "ended"
    _no_livekit_network.assert_called_once()
    assert host.post(f"/api/rooms/{code}/token/").status_code == 410
    res = guest.post(f"/api/rooms/{code}/join/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"}, format="json")
    assert res.status_code == 410


@pytest.mark.django_db
def test_rejoin_after_leave_gets_new_token(host):
    code = create_room(host)["code"]
    host.post(f"/api/rooms/{code}/token/")
    assert host.post(f"/api/rooms/{code}/leave/").status_code == 204
    assert host.post(f"/api/rooms/{code}/token/").status_code == 200


@pytest.mark.django_db
def test_call_expires_after_max_duration(host):
    code = create_room(host)["code"]
    host.post(f"/api/rooms/{code}/token/")
    CallRoom.objects.filter(code=code).update(started_at=timezone.now() - timedelta(seconds=601))
    assert host.post(f"/api/rooms/{code}/token/").status_code == 410
    assert CallRoom.objects.get(code=code).end_reason == "max_call_duration"


@pytest.mark.django_db
def test_change_languages_mid_call(host):
    code = create_room(host)["code"]
    host.post(f"/api/rooms/{code}/token/")
    res = host.patch(
        f"/api/rooms/{code}/languages/", {"spoken_language": "en-IN", "listen_language": "en-IN"}, format="json"
    )
    assert res.status_code == 200
    assert res.json()["live_update_applied"] is True
    me = [p for p in res.json()["participants"] if p["is_you"]][0]
    assert me["spoken_language"] == "en-IN"


# ---------- usage limits ----------


def report(client, room_name, **kw):
    body = {"room_name": room_name, "stt_seconds": 0, "translate_chars": 0, "tts_chars": 0, **kw}
    return client.post("/api/internal/usage/", body, format="json", HTTP_X_WORKER_SECRET=WORKER_SECRET)


@pytest.mark.django_db
def test_worker_endpoint_requires_secret(host):
    code = create_room(host)["code"]
    room = CallRoom.objects.get(code=code)
    body = {"room_name": room.livekit_room_name, "stt_seconds": 1, "translate_chars": 1, "tts_chars": 1}
    assert APIClient().post("/api/internal/usage/", body, format="json").status_code == 403
    res = APIClient().post("/api/internal/usage/", body, format="json", HTTP_X_WORKER_SECRET="wrong")
    assert res.status_code == 403
    # A logged-in user cannot use it either.
    assert host.post("/api/internal/usage/", body, format="json").status_code == 403


@pytest.mark.django_db
def test_worker_endpoint_disabled_without_configured_secret(host, settings):
    settings.WORKER_SHARED_SECRET = ""
    code = create_room(host)["code"]
    room = CallRoom.objects.get(code=code)
    res = APIClient().post(
        "/api/internal/usage/",
        {"room_name": room.livekit_room_name, "stt_seconds": 0, "translate_chars": 0, "tts_chars": 0},
        format="json",
        HTTP_X_WORKER_SECRET="",
    )
    assert res.status_code == 403


@pytest.mark.django_db
def test_usage_report_records_and_allows():
    client = make_client("u1")
    code = create_room(client)["code"]
    client.post(f"/api/rooms/{code}/token/")
    room = CallRoom.objects.get(code=code)
    latency = {"end_to_audio_ms": {"count": 2, "avg": 900, "p50": 850, "p95": 1000, "max": 1000}}
    res = report(APIClient(), room.livekit_room_name, stt_seconds=10, tts_chars=100, translate_chars=100, latency=latency)
    assert res.json() == {"allowed": True, "reason": ""}
    usage = CallUsage.objects.get(room=room)
    assert usage.stt_seconds == 10 and usage.latency["end_to_audio_ms"]["p95"] == 1000
    # Out-of-order (smaller) cumulative report never decreases totals.
    report(APIClient(), room.livekit_room_name, stt_seconds=5)
    usage.refresh_from_db()
    assert usage.stt_seconds == 10


@pytest.mark.django_db
def test_per_call_limit_enforced():
    client = make_client("u2")
    code = create_room(client)["code"]
    client.post(f"/api/rooms/{code}/token/")
    room = CallRoom.objects.get(code=code)
    res = report(APIClient(), room.livekit_room_name, tts_chars=500)
    assert res.json() == {"allowed": False, "reason": "per_call_tts_chars_limit"}


@pytest.mark.django_db
def test_daily_limit_spans_calls():
    client = make_client("u3")
    first = CallRoom.objects.get(code=create_room(client)["code"])
    client.post(f"/api/rooms/{first.code}/token/")
    assert report(APIClient(), first.livekit_room_name, stt_seconds=55).json()["allowed"] is True
    second = CallRoom.objects.get(code=create_room(client)["code"])
    client.post(f"/api/rooms/{second.code}/token/")
    res = report(APIClient(), second.livekit_room_name, stt_seconds=50).json()
    assert res == {"allowed": False, "reason": "daily_stt_seconds_limit"}


@pytest.mark.django_db
def test_new_rooms_disable_translation_when_ai_budget_exhausted():
    client = make_client("u4")
    first = CallRoom.objects.get(code=create_room(client)["code"])
    CallUsage.objects.create(room=first, stt_seconds=100)
    assert create_room(client)["translation_enabled"] is False


@pytest.mark.django_db
def test_daily_call_limit_blocks_room_creation(settings):
    settings.DAILY_LIMITS = {**settings.DAILY_LIMITS, "call_seconds": 60}
    client = make_client("u5")
    room = CallRoom.objects.get(code=create_room(client)["code"])
    client.post(f"/api/rooms/{room.code}/token/")
    CallRoom.objects.filter(pk=room.pk).update(started_at=timezone.now() - timedelta(seconds=61))
    res = client.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json")
    assert res.status_code == 429


@pytest.mark.django_db
def test_usage_report_for_ended_room_says_stop(host):
    code = create_room(host)["code"]
    host.post(f"/api/rooms/{code}/token/")
    host.post(f"/api/rooms/{code}/end/")
    room = CallRoom.objects.get(code=code)
    res = report(APIClient(), room.livekit_room_name, final=True)
    assert res.json() == {"allowed": False, "reason": "room_ended"}
    assert CallUsage.objects.get(room=room).finalized is True


@pytest.mark.django_db
def test_usage_summary(host):
    res = host.get("/api/usage/")
    assert res.status_code == 200
    assert set(res.json()["today"]) == {"call_seconds", "stt_seconds", "tts_chars", "translate_chars"}


@pytest.mark.django_db
def test_room_creation_is_rate_limited(settings):
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {**settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "room_create": "2/hour"},
    }
    from rest_framework.settings import api_settings
    from rest_framework.throttling import SimpleRateThrottle

    with mock.patch.object(SimpleRateThrottle, "THROTTLE_RATES", api_settings.user_settings["DEFAULT_THROTTLE_RATES"]):
        client = make_client("spammer")
        codes = [
            client.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json").status_code
            for _ in range(3)
        ]
    assert codes == [201, 201, 429]


@pytest.mark.django_db
def test_auto_livekit_url_follows_request_host(host, settings):
    settings.LIVEKIT_URL = "auto"
    settings.ALLOWED_HOSTS = ["*"]
    room = create_room(host)
    res = host.post(f"/api/rooms/{room['code']}/token/", HTTP_HOST="10.0.1.33:8010")
    assert res.status_code == 200
    assert res.json()["url"] == "ws://10.0.1.33:7880"
