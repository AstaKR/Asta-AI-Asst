from datetime import timedelta
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import PhoneNumber
from calls.models import CallRoom, DirectCall

User = get_user_model()
PASSWORD = "c0rrect-Horse-battery"
LANGS = {"spoken_language": "ta-IN", "listen_language": "ta-IN"}


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.LIVEKIT_URL = "ws://localhost:7880"
    settings.LIVEKIT_API_KEY = "testkey"
    settings.LIVEKIT_API_SECRET = "testsecret-testsecret-testsecret-0123"
    settings.TRANSLATION_ENABLED = True
    settings.MAX_PARTICIPANTS = 2
    settings.DAILY_LIMITS = {"call_seconds": 3600, "stt_seconds": 100, "tts_chars": 1000, "translate_chars": 2000}
    settings.DIRECT_CALL_RING_SECONDS = 45
    settings.DIRECT_CALL_DAILY_LIMIT_PER_USER = 50
    cache.clear()


@pytest.fixture(autouse=True)
def _no_livekit_network():
    with mock.patch("calls.livekit_service.delete_room", return_value=True) as delete_room:
        yield delete_room


def login(username: str) -> APIClient:
    User.objects.create_user(username=username, password=PASSWORD)
    c = APIClient()
    assert c.login(username=username, password=PASSWORD)
    return c


@pytest.fixture
def asha(db):
    return login("asha")


@pytest.fixture
def ravi(db):
    return login("ravi")


def dial(client, to="ravi", **extra):
    return client.post("/api/direct/calls/", {"to": to, **LANGS, **extra}, format="json")


def test_call_by_username_rings_the_callee(asha, ravi):
    res = dial(asha, "@Ravi")
    assert res.status_code == 201, res.content
    call = res.json()
    assert (call["direction"], call["status"], call["other_username"]) == ("outgoing", "ringing", "ravi")
    room = CallRoom.objects.get(code=call["room_code"])
    assert room.participants.count() == 1  # the callee joins only by answering

    incoming = ravi.get("/api/direct/incoming/").json()
    assert [c["id"] for c in incoming] == [call["id"]]
    assert (incoming[0]["direction"], incoming[0]["other_name"], incoming[0]["other_language"]) == ("incoming", "asha", "ta-IN")
    assert asha.get("/api/direct/incoming/").json() == []


def test_call_by_mobile_number(asha, ravi):
    PhoneNumber.objects.create(user=User.objects.get(username="ravi"), number="+919876543210", verified_at=timezone.now())
    assert dial(asha, "98765 43210").status_code == 201


def test_unknown_or_self(asha, ravi):
    assert dial(asha, "nobody").status_code == 404
    assert dial(asha, "9876543210").status_code == 404
    assert dial(asha, "asha").json()["code"] == "self"


def test_answer_joins_the_room_and_caller_sees_it(asha, ravi):
    call = dial(asha).json()
    res = ravi.post(f"/api/direct/calls/{call['id']}/answer/", {"spoken_language": "hi-IN", "listen_language": "hi-IN"}, format="json")
    assert res.status_code == 200 and res.json()["status"] == "answered"
    room = CallRoom.objects.get(code=call["room_code"])
    guest = room.participants.get(user__username="ravi")
    assert (guest.role, guest.spoken_language) == ("guest", "hi-IN")
    assert asha.get(f"/api/direct/calls/{call['id']}/").json()["status"] == "answered"
    assert asha.get(f"/api/rooms/{call['room_code']}/").json()["direct"]["status"] == "answered"
    # The callee can now get a token like any participant.
    with mock.patch("calls.livekit_service.build_token", return_value="tok"):
        assert ravi.post(f"/api/rooms/{call['room_code']}/token/").status_code == 200


def test_only_the_callee_can_answer(asha, ravi):
    call = dial(asha).json()
    assert asha.post(f"/api/direct/calls/{call['id']}/answer/", {}, format="json").json()["code"] == "not_callee"
    stranger = login("mallory")
    assert stranger.post(f"/api/direct/calls/{call['id']}/answer/", {}, format="json").status_code == 404
    assert stranger.get(f"/api/direct/calls/{call['id']}/").status_code == 404


def test_decline_and_cancel_end_the_room(asha, ravi, _no_livekit_network):
    call = dial(asha).json()
    assert ravi.post(f"/api/direct/calls/{call['id']}/decline/").json()["status"] == "declined"
    assert CallRoom.objects.get(code=call["room_code"]).is_ended
    assert ravi.post(f"/api/direct/calls/{call['id']}/answer/", {}, format="json").status_code == 409

    call = dial(asha).json()
    assert asha.post(f"/api/direct/calls/{call['id']}/decline/").json()["status"] == "cancelled"
    assert ravi.get("/api/direct/incoming/").json() == []


def test_unanswered_call_becomes_missed(asha, ravi):
    call = dial(asha).json()
    DirectCall.objects.filter(pk=call["id"]).update(created_at=timezone.now() - timedelta(seconds=60))
    assert ravi.get("/api/direct/incoming/").json() == []
    history = ravi.get("/api/direct/calls/").json()
    assert history[0]["status"] == "missed" and history[0]["direction"] == "incoming"
    assert CallRoom.objects.get(code=call["room_code"]).is_ended


def test_caller_hanging_up_cancels(asha, ravi):
    call = dial(asha).json()
    asha.post(f"/api/rooms/{call['room_code']}/end/")
    assert ravi.get("/api/direct/incoming/").json() == []
    assert asha.get(f"/api/direct/calls/{call['id']}/").json()["status"] == "cancelled"


def test_daily_limit(asha, ravi, settings):
    settings.DIRECT_CALL_DAILY_LIMIT_PER_USER = 1
    assert dial(asha).status_code == 201
    assert dial(asha).json()["code"] == "daily_direct_limit"


def test_room_cannot_be_joined_by_code(asha, ravi):
    call = dial(asha).json()
    res = login("mallory").post(f"/api/rooms/{call['room_code']}/join/", LANGS, format="json")
    assert res.status_code == 410
