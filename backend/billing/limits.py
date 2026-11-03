"""Per-user plan limits. Global daily budgets (calls.usage) still apply on top of these."""

from __future__ import annotations

from datetime import datetime, time

from django.conf import settings
from django.db.models import Sum
from django.utils import timezone

from .models import Plan, Subscription


class PlanLimit(Exception):
    def __init__(self, message: str, code: str = "plan_limit"):
        super().__init__(message)
        self.code = code


def _day_start():
    now = timezone.localtime()
    return timezone.make_aware(datetime.combine(now.date(), time.min), now.tzinfo)


def _month_start():
    return _day_start().replace(day=1)


def plan_for(user) -> Plan | None:
    sub = Subscription.objects.select_related("plan").filter(user=user).first()
    if sub and sub.plan.active and (sub.expires_at is None or sub.expires_at > timezone.now()):
        return sub.plan
    return Plan.objects.filter(is_default=True, active=True).first()


def usage_for(user) -> dict:
    from assistant.models import AssistantUsage
    from calls.models import CallRoom
    from meetings.models import Meeting
    from telephony.models import PhoneCall

    day = _day_start()
    rooms = CallRoom.objects.filter(participants__user=user, started_at__gte=day).distinct()
    meeting_seconds = Meeting.objects.filter(owner=user, created_at__gte=_month_start()).aggregate(s=Sum("duration_seconds"))["s"] or 0
    return {
        # A room left open (e.g. lost connection) never counts beyond its maximum length.
        "call_minutes_today": round(sum(min(r.duration_seconds, r.max_duration_seconds) for r in rooms) / 60, 1),
        "assistant_requests_today": AssistantUsage.objects.filter(user=user, created_at__gte=day).count(),
        "meeting_minutes_this_month": round(meeting_seconds / 60, 1),
        "phone_calls_today": PhoneCall.objects.filter(owner=user, direction="outbound", created_at__gte=day).count(),
    }


def _enforced(user) -> bool:
    return settings.PLANS_ENFORCED and not user.is_staff


def _upgrade(msg: str) -> str:
    return f"{msg} Ask your administrator to upgrade your plan."


def check_call(user, *, video: bool = False) -> None:
    plan = plan_for(user)
    if not _enforced(user) or plan is None:
        return
    if video and not plan.video_calls:
        raise PlanLimit(_upgrade(f"Video calls are not included in the {plan.name} plan."), "plan_no_video")
    if usage_for(user)["call_minutes_today"] >= plan.daily_call_minutes:
        raise PlanLimit(_upgrade(f"You have used today's {plan.daily_call_minutes} call minutes."), "plan_call_minutes")


def check_assistant(user) -> None:
    plan = plan_for(user)
    if _enforced(user) and plan is not None and usage_for(user)["assistant_requests_today"] >= plan.daily_assistant_requests:
        raise PlanLimit(_upgrade(f"You have used today's {plan.daily_assistant_requests} assistant requests."), "plan_assistant")


def check_meeting(user) -> None:
    plan = plan_for(user)
    if _enforced(user) and plan is not None and usage_for(user)["meeting_minutes_this_month"] >= plan.monthly_meeting_minutes:
        raise PlanLimit(_upgrade(f"You have used this month's {plan.monthly_meeting_minutes} meeting minutes."), "plan_meeting_minutes")


def check_phone(user) -> None:
    plan = plan_for(user)
    if not _enforced(user) or plan is None:
        return
    if not plan.phone_calls:
        raise PlanLimit(_upgrade(f"Phone calls are not included in the {plan.name} plan."), "plan_no_phone")
    if usage_for(user)["phone_calls_today"] >= plan.daily_phone_calls:
        raise PlanLimit(_upgrade(f"You have used today's {plan.daily_phone_calls} phone calls."), "plan_phone_calls")


def check_phone_line(user) -> None:
    """Incoming phone calls need a plan with phone calls (no per-day count: the caller decides when)."""
    plan = plan_for(user)
    if _enforced(user) and plan is not None and not plan.phone_calls:
        raise PlanLimit(_upgrade(f"Phone calls are not included in the {plan.name} plan."), "plan_no_phone")
