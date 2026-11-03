import base64
import hashlib
import json
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from livekit import api as lkapi
from rest_framework.test import APIClient

from accounts.models import PhoneNumber
from billing.models import Plan, Subscription
from calls.models import CallRoom
from telephony import numbers, services, sip
from telephony.models import PhoneCall, PhoneLine

User = get_user_model()
KEY, SECRET = "testkey", "testsecret-testsecret-testsecret-0123"


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.TELEPHONY_ENABLED = True
    settings.LIVEKIT_SIP_OUTBOUND_TRUNK_ID = "ST_out"
    settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET = KEY, SECRET
    settings.LIVEKIT_URL = "ws://localhost:7880"
    settings.PHONE_DIAL_ALLOWED_PREFIXES = ["+91"]
    settings.PHONE_DIAL_DAILY_LIMIT_PER_USER = 20
    settings.PHONE_RING_SECONDS = 30
    settings.DAILY_LIMITS = {"call_seconds": 36000, "stt_seconds": 3600, "tts_chars": 100000, "translate_chars": 100000}


@pytest.fixture
def lk(monkeypatch):
    """Records LiveKit calls instead of making them."""
    calls = []
    monkeypatch.setattr(sip, "create_room_with_translator", lambda room: calls.append(("create_room", room.livekit_room_name)))
    monkeypatch.setattr(sip, "dial", lambda room, **kw: calls.append(("dial", kw)))
    monkeypatch.setattr(sip, "dispatch_translator", lambda room: calls.append(("dispatch", room.livekit_room_name)))
    monkeypatch.setattr(sip, "set_participant_attributes", lambda room, identity, attrs: calls.append(("attrs", identity, attrs)))
    monkeypatch.setattr(sip, "participant_attributes", lambda room_name, identity, **kw: {})
    monkeypatch.setattr(sip, "hang_up", lambda room_name: calls.append(("hang_up", room_name)))
    monkeypatch.setattr("calls.livekit_service.delete_room", lambda room: calls.append(("delete", room.livekit_room_name)) or True)
    monkeypatch.setattr("calls.livekit_service.update_room_metadata", lambda room: True)
    return calls


def login(username: str, phone: str | None = None):
    user = User.objects.create_user(username=username, password="pw-123456-xyz")
    if phone:
        PhoneNumber.objects.create(user=user, number=phone, verified_at=timezone.now())
    Subscription.objects.create(user=user, plan=Plan.objects.get(code="pro"))  # phone calls need a paid plan
    c = APIClient()
    assert c.login(username=username, password="pw-123456-xyz")
    return user, c


DIAL = {"number": "098765 43210", "spoken_language": "ta-IN", "listen_language": "ta-IN", "caller_language": "hi-IN"}


# ---------- numbers ----------


@pytest.mark.parametrize(
    "raw,expected",
    [("9876543210", "+919876543210"), ("098765 43210", "+919876543210"), ("+91 98765-43210", "+919876543210"), ("0044 20 7946 0958", "+442079460958")],
)
def test_normalize(raw, expected):
    assert numbers.normalize(raw) == expected


@pytest.mark.parametrize("raw", ["", "12345", "abc", "+0123456789"])
def test_normalize_rejects(raw):
    with pytest.raises(numbers.InvalidNumber):
        numbers.normalize(raw)


def test_extract_number_from_header_value():
    assert numbers.extract_number("<sip:+919876543210@sip.example.com>;reason=unconditional") == "+919876543210"
    assert numbers.extract_number("anonymous") is None


# ---------- outgoing ----------


@pytest.mark.django_db
def test_dial_creates_room_and_rings_number(lk):
    user, c = login("asha")
    res = c.post("/api/phone/dial/", DIAL, format="json")
    assert res.status_code == 201, res.content
    call = PhoneCall.objects.get()
    assert call.direction == "outbound" and call.status == "ringing" and call.remote_number == "+919876543210"
    assert res.json()["room_code"] == call.room.code
    assert [x[0] for x in lk] == ["create_room", "dial"]  # room (with translator) exists before the phone rings
    dial = lk[1][1]
    assert dial["number"] == "+919876543210" and dial["caller_language"] == "hi-IN" and dial["identity"] == call.sip_identity
    host = call.room.participants.get()
    assert host.user == user and host.spoken_language == "ta-IN"
    # The owner can get a normal call token for the room.
    assert c.post(f"/api/rooms/{call.room.code}/token/").status_code == 200


@pytest.mark.django_db
def test_dial_blocks_international_and_limits(lk, settings):
    _, c = login("asha")
    res = c.post("/api/phone/dial/", {**DIAL, "number": "+442079460958"}, format="json")
    assert res.status_code == 400 and res.json()["code"] == "prefix_not_allowed"
    settings.PHONE_DIAL_DAILY_LIMIT_PER_USER = 1
    assert c.post("/api/phone/dial/", DIAL, format="json").status_code == 201
    res = c.post("/api/phone/dial/", DIAL, format="json")
    assert res.status_code == 429 and res.json()["code"] == "daily_dial_limit"
    assert len([x for x in lk if x[0] == "dial"]) == 1


@pytest.mark.django_db
def test_dial_not_configured(lk, settings):
    settings.LIVEKIT_SIP_OUTBOUND_TRUNK_ID = ""
    _, c = login("asha")
    res = c.post("/api/phone/dial/", DIAL, format="json")
    assert res.status_code == 503 and res.json()["code"] == "not_configured"
    assert c.get("/api/phone/config/").json()["dial_enabled"] is False


@pytest.mark.django_db
def test_dial_failure_marks_failed_and_ends_room(lk, monkeypatch):
    def boom(room, **kw):
        raise sip.SipError("LiveKit SIP request failed (TwirpError).")

    monkeypatch.setattr(sip, "dial", boom)
    _, c = login("asha")
    res = c.post("/api/phone/dial/", DIAL, format="json")
    assert res.status_code == 502
    call = PhoneCall.objects.get()
    assert call.status == "failed" and call.room.status == "ended"


@pytest.mark.django_db
def test_phone_rooms_cannot_be_joined_by_code(lk):
    _, c = login("asha")
    code = c.post("/api/phone/dial/", DIAL, format="json").json()["room_code"]
    _, other = login("ravi")
    res = other.post(f"/api/rooms/{code}/join/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json")
    assert res.status_code >= 400


# ---------- incoming ----------


def sip_attrs(**extra):
    return {"sip.phoneNumber": "+919000011111", "sip.trunkPhoneNumber": "+918045671234", "sip.callStatus": "ringing", **extra}


@pytest.mark.django_db
def test_incoming_on_dedicated_line_rings_owner(lk):
    owner, c = login("asha")
    PhoneLine.objects.create(number="+918045671234", user=owner)
    call = services.handle_inbound_join("phone-_+919000011111_abc", "sip_+919000011111", sip_attrs())
    assert call and call.owner == owner and call.direction == "inbound" and call.remote_number == "+919000011111"
    assert ("dispatch", "phone-_+919000011111_abc") in lk
    assert any(x[0] == "attrs" and x[2]["spoken_language"] == "auto" for x in lk)
    ringing = c.get("/api/phone/incoming/").json()
    assert [r["id"] for r in ringing] == [str(call.id)]
    # Answer, then join with a normal call token.
    assert c.post(f"/api/phone/calls/{call.id}/answer/").json()["status"] == "answered"
    assert c.post(f"/api/rooms/{call.room.code}/token/").status_code == 200
    assert c.get("/api/phone/incoming/").json() == []


@pytest.mark.django_db
def test_incoming_forwarded_from_users_mobile(lk):
    owner, _ = login("asha", phone="+919876543210")
    attrs = sip_attrs(**{"sip.trunkPhoneNumber": "+918000000000", "forwarded_from": "<sip:+919876543210@pstn>"})
    call = services.handle_inbound_join("phone-_x_1", "sip_x", attrs)
    assert call and call.owner == owner


@pytest.mark.django_db
def test_incoming_unknown_line_is_hung_up(lk):
    assert services.handle_inbound_join("phone-_x_2", "sip_x", sip_attrs()) is None
    assert ("hang_up", "phone-_x_2") in lk and not CallRoom.objects.exists()


@pytest.mark.django_db
def test_incoming_other_users_cannot_see_or_answer(lk):
    owner, _ = login("asha")
    PhoneLine.objects.create(number="+918045671234", user=owner)
    call = services.handle_inbound_join("phone-_y", "sip_y", sip_attrs())
    _, other = login("ravi")
    assert other.get("/api/phone/incoming/").json() == []
    assert other.post(f"/api/phone/calls/{call.id}/answer/").status_code == 404


@pytest.mark.django_db
def test_decline_and_ring_timeout(lk):
    owner, c = login("asha")
    PhoneLine.objects.create(number="+918045671234", user=owner)
    first = services.handle_inbound_join("phone-_a", "sip_a", sip_attrs())
    assert c.post(f"/api/phone/calls/{first.id}/decline/").json()["status"] == "declined"
    assert ("delete", "phone-_a") in lk
    second = services.handle_inbound_join("phone-_b", "sip_b", sip_attrs())
    PhoneCall.objects.filter(pk=second.pk).update(created_at=timezone.now() - timedelta(seconds=31))
    assert c.get("/api/phone/incoming/").json() == []
    second.refresh_from_db()
    assert second.status == "missed" and second.room.status == "ended"


@pytest.mark.django_db
def test_telephony_disabled_ignores_calls(lk, settings):
    settings.TELEPHONY_ENABLED = False
    owner, _ = login("asha")
    PhoneLine.objects.create(number="+918045671234", user=owner)
    assert services.handle_inbound_join("phone-_z", "sip_z", sip_attrs()) is None


# ---------- webhooks ----------


def signed(body: dict):
    raw = json.dumps(body)
    digest = base64.b64encode(hashlib.sha256(raw.encode()).digest()).decode()
    token = lkapi.AccessToken(KEY, SECRET).with_sha256(digest).to_jwt()
    return raw, token


def post_webhook(body: dict, token: str | None = None):
    raw, good = signed(body)
    return APIClient().generic("POST", "/api/phone/livekit-webhook/", raw, content_type="application/webhook+json", HTTP_AUTHORIZATION=token or good)


def joined(room: str, identity: str, attrs: dict, event="participant_joined"):
    return {"event": event, "room": {"name": room}, "participant": {"identity": identity, "kind": "SIP", "attributes": attrs}}


@pytest.mark.django_db
def test_webhook_rejects_bad_signature(lk):
    res = post_webhook(joined("phone-_q", "sip_q", sip_attrs()), token="not-a-token")
    assert res.status_code == 401


@pytest.mark.django_db
def test_webhook_incoming_then_caller_hangs_up(lk):
    owner, _ = login("asha")
    PhoneLine.objects.create(number="+918045671234", user=owner)
    assert post_webhook(joined("phone-_w", "sip_w", sip_attrs())).status_code == 200
    call = PhoneCall.objects.get()
    assert call.status == "ringing"
    assert post_webhook(joined("phone-_w", "sip_w", sip_attrs()), ).status_code == 200  # retried webhook: no duplicate
    assert PhoneCall.objects.count() == 1
    post_webhook(joined("phone-_w", "sip_w", {}, event="participant_left"))
    call.refresh_from_db()
    assert call.status == "missed" and call.room.status == "ended"


@pytest.mark.django_db
def test_webhook_outbound_answer_and_hangup(lk):
    _, c = login("asha")
    c.post("/api/phone/dial/", DIAL, format="json")
    call = PhoneCall.objects.get()
    room = call.room.livekit_room_name
    post_webhook(joined(room, call.sip_identity, {"sip.callStatus": "dialing"}))
    call.refresh_from_db()
    assert call.status == "ringing"  # joined while still ringing the callee
    post_webhook(joined(room, call.sip_identity, {"sip.callStatus": "active"}))
    call.refresh_from_db()
    assert call.status == "answered" and call.answered_at
    post_webhook(joined(room, call.sip_identity, {}, event="participant_left"))
    call.refresh_from_db()
    assert call.status == "ended" and call.room.status == "ended"


@pytest.mark.django_db
def test_connected_report_and_history(lk):
    _, c = login("asha")
    c.post("/api/phone/dial/", DIAL, format="json")
    call = PhoneCall.objects.get()
    assert c.post(f"/api/phone/calls/{call.id}/connected/").json()["status"] == "answered"
    c.post(f"/api/rooms/{call.room.code}/end/")
    history = c.get("/api/phone/calls/").json()
    assert history[0]["status"] == "ended"  # reconciled after the normal End button
