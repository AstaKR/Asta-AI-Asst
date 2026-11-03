"""Usage aggregation and cost-limit enforcement."""

from dataclasses import dataclass
from datetime import datetime, time

from django.conf import settings
from django.db.models import Sum
from django.utils import timezone

from .models import CallRoom, CallUsage


def _today_start() -> datetime:
    now = timezone.localtime()
    return timezone.make_aware(datetime.combine(now.date(), time.min), now.tzinfo)


def daily_totals(exclude_room: CallRoom | None = None) -> dict:
    """Deployment-wide usage for today (local time). Limits are global to protect the API budget."""
    start = _today_start()
    usage_qs = CallUsage.objects.filter(room__created_at__gte=start)
    rooms_qs = CallRoom.objects.filter(created_at__gte=start, started_at__isnull=False)
    if exclude_room is not None:
        usage_qs = usage_qs.exclude(room=exclude_room)
        rooms_qs = rooms_qs.exclude(pk=exclude_room.pk)
    agg = usage_qs.aggregate(stt=Sum("stt_seconds"), tts=Sum("tts_chars"), tr=Sum("translate_chars"))
    # Meeting transcription/translation shares the same daily AI budget as calls.
    from meetings.models import Meeting

    from quick.models import QuickUsage

    m = Meeting.objects.filter(created_at__gte=start).aggregate(stt=Sum("stt_seconds"), tr=Sum("translate_chars"))
    q = QuickUsage.objects.filter(created_at__gte=start).aggregate(stt=Sum("stt_seconds"), tts=Sum("tts_chars"), tr=Sum("translate_chars"))
    return {
        "call_seconds": sum(min(r.duration_seconds, r.max_duration_seconds) for r in rooms_qs),
        "stt_seconds": round((agg["stt"] or 0) + (m["stt"] or 0) + (q["stt"] or 0), 1),
        "tts_chars": (agg["tts"] or 0) + (q["tts"] or 0),
        "translate_chars": (agg["tr"] or 0) + (m["tr"] or 0) + (q["tr"] or 0),
    }


@dataclass
class LimitCheck:
    allowed: bool
    reason: str = ""


def check_daily_call_budget() -> LimitCheck:
    totals = daily_totals()
    if totals["call_seconds"] >= settings.DAILY_LIMITS["call_seconds"]:
        return LimitCheck(False, "daily_call_limit")
    return LimitCheck(True)


def ai_budget_available() -> bool:
    totals = daily_totals()
    limits = settings.DAILY_LIMITS
    return all(totals[k] < limits[k] for k in ("stt_seconds", "tts_chars", "translate_chars"))


def check_usage_report(room: CallRoom, report: dict) -> LimitCheck:
    """Given the worker's cumulative totals for `room`, decide whether AI processing may continue."""
    per_call = settings.PER_CALL_LIMITS
    for key in ("stt_seconds", "tts_chars", "translate_chars"):
        if report.get(key, 0) >= per_call[key]:
            return LimitCheck(False, f"per_call_{key}_limit")
    others = daily_totals(exclude_room=room)
    for key in ("stt_seconds", "tts_chars", "translate_chars"):
        if others[key] + report.get(key, 0) >= settings.DAILY_LIMITS[key]:
            return LimitCheck(False, f"daily_{key}_limit")
    if room.duration_seconds >= room.max_duration_seconds:
        return LimitCheck(False, "max_call_duration")
    return LimitCheck(True)
