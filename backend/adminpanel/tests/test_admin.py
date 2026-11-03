from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from accounts.models import PhoneNumber
from assistant.models import AssistantUsage
from billing import limits
from billing.models import Plan, Subscription
from calls.models import CallRoom
from quick.models import QuickUsage

User = get_user_model()


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.PLANS_ENFORCED = True
    settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET = "testkey", "testsecret-testsecret-testsecret-0123"
    settings.LIVEKIT_URL = "ws://localhost:7880"
    settings.DAILY_LIMITS = {"call_seconds": 36000, "stt_seconds": 3600, "tts_chars": 100000, "translate_chars": 100000}
    cache.clear()


def login(username, staff=False):
    user = User.objects.create_user(username=username, password="pw-123456-xyz", is_staff=staff)
    c = APIClient()
    assert c.login(username=username, password="pw-123456-xyz")
    return user, c


# ---------- plans ----------


@pytest.mark.django_db
def test_default_plans_seeded():
    assert list(Plan.objects.values_list("code", flat=True)) == ["free", "pro", "business"]
    assert Plan.objects.get(is_default=True).code == "free"


@pytest.mark.django_db
def test_my_plan_defaults_to_free():
    _, c = login("asha")
    body = c.get("/api/me/plan/").json()
    assert body["plan"]["code"] == "free" and body["usage"]["assistant_requests_today"] == 0
    assert [p["code"] for p in body["plans"]] == ["free", "pro", "business"] and body["payments"] is False


@pytest.mark.django_db
def test_call_minutes_limit_blocks_new_calls():
    user, c = login("asha")
    Plan.objects.filter(code="free").update(daily_call_minutes=1)
    room = c.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json").json()
    CallRoom.objects.filter(code=room["code"]).update(started_at=timezone.now() - timedelta(minutes=2), status="ended", ended_at=timezone.now())
    res = c.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json")
    assert res.status_code == 429 and res.json()["code"] == "plan_call_minutes"


@pytest.mark.django_db
def test_video_not_in_plan():
    _, c = login("asha")
    Plan.objects.filter(code="free").update(video_calls=False)
    res = c.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN", "video": True}, format="json")
    assert res.status_code == 403 and res.json()["code"] == "plan_no_video"


@pytest.mark.django_db
def test_assistant_limit_from_plan(settings):
    user, c = login("asha")
    settings.ANTHROPIC_API_KEY = "sk-ant-test"
    Plan.objects.filter(code="free").update(daily_assistant_requests=1)
    AssistantUsage.objects.create(user=user, kind="chat", model="m", input_tokens=1, output_tokens=1)
    res = c.post("/api/assistant/chat/", {"messages": [{"role": "user", "content": "hi"}]}, format="json")
    assert res.status_code == 429 and res.json()["code"] == "plan_assistant"


@pytest.mark.django_db
def test_staff_and_disabled_enforcement_are_unlimited(settings):
    staff, _ = login("boss", staff=True)
    Plan.objects.filter(code="free").update(video_calls=False)
    limits.check_call(staff, video=True)  # no exception
    user, _ = login("asha")
    settings.PLANS_ENFORCED = False
    limits.check_call(user, video=True)


@pytest.mark.django_db
def test_expired_subscription_falls_back_to_default():
    user, _ = login("asha")
    Subscription.objects.create(user=user, plan=Plan.objects.get(code="pro"), expires_at=timezone.now() - timedelta(days=1))
    assert limits.plan_for(user).code == "free"


# ---------- admin API ----------


@pytest.mark.django_db
@pytest.mark.parametrize("url", ["/api/admin/overview/", "/api/admin/users/", "/api/admin/plans/"])
def test_admin_endpoints_need_staff(url):
    _, c = login("asha")
    assert c.get(url).status_code == 403


@pytest.mark.django_db
def test_overview_costs_and_counts():
    admin, c = login("boss", staff=True)
    QuickUsage.objects.create(user=admin, kind="speech", target_language="en", stt_seconds=3600, translate_chars=10_000, tts_chars=10_000)
    AssistantUsage.objects.create(user=admin, kind="chat", model="m", input_tokens=1_000_000, output_tokens=0)
    body = c.get("/api/admin/overview/?days=7").json()
    assert len(body["days"]) == 7
    today = body["days"][-1]
    # 1 h STT (₹30) + 10k translate (₹20) + 10k TTS (₹30) = ₹80; 1M Claude input tokens = $4 × 88 = ₹352
    assert today["cost_inr"] == {"sarvam": 80.0, "claude": 352.0, "total": 432.0}
    assert today["quick_translations"] == 1 and today["assistant_requests"] == 1 and today["stt_minutes"] == 60.0
    assert body["period_cost_inr"] == 432.0 and body["today"]["users_total"] == 1


@pytest.mark.django_db
def test_users_search_plan_change_and_deactivate():
    admin, c = login("boss", staff=True)
    user, _ = login("asha")
    PhoneNumber.objects.create(user=user, number="+919876543210", verified_at=timezone.now())
    Token.objects.create(user=user)
    found = c.get("/api/admin/users/?q=98765").json()["results"]
    assert [u["username"] for u in found] == ["asha"] and found[0]["plan"] == "free"
    res = c.patch(f"/api/admin/users/{user.id}/", {"plan": "pro", "note": "pilot"}, format="json")
    assert res.json()["plan"] == "pro" and Subscription.objects.get(user=user).assigned_by == admin
    res = c.patch(f"/api/admin/users/{user.id}/", {"is_active": False}, format="json")
    assert res.json()["is_active"] is False and not Token.objects.filter(user=user).exists()
    assert c.patch(f"/api/admin/users/{admin.id}/", {"is_active": False}, format="json").status_code == 400
    assert "is_staff" not in c.patch(f"/api/admin/users/{user.id}/", {"is_staff": True}, format="json").json() or not User.objects.get(pk=user.pk).is_staff


@pytest.mark.django_db
def test_plan_edit():
    _, c = login("boss", staff=True)
    res = c.patch("/api/admin/plans/pro/", {"price_inr_month": 599, "daily_call_minutes": 240}, format="json")
    assert res.status_code == 200 and res.json()["price_inr_month"] == 599
    assert c.patch("/api/admin/plans/free/", {"active": False}, format="json").status_code == 400


@pytest.mark.django_db
def test_grant_admin_command():
    user, _ = login("asha")
    PhoneNumber.objects.create(user=user, number="+919876543210", verified_at=timezone.now())
    call_command("grant_admin", phone="+919876543210")
    assert User.objects.get(pk=user.pk).is_staff
    call_command("grant_admin", username="asha", revoke=True)
    assert not User.objects.get(pk=user.pk).is_staff


@pytest.mark.django_db
def test_abandoned_room_counts_at_most_its_max_length():
    user, c = login("asha")
    code = c.post("/api/rooms/", {"spoken_language": "ta-IN", "listen_language": "ta-IN"}, format="json").json()["code"]
    CallRoom.objects.filter(code=code).update(started_at=timezone.now() - timedelta(hours=2), status="active", max_duration_seconds=600)
    assert limits.usage_for(user)["call_minutes_today"] == 10.0
