"""Admin dashboard API (staff only): usage, estimated cost, users and plans."""

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from assistant.models import AssistantUsage
from billing.limits import plan_for, usage_for
from billing.models import Plan, Subscription
from calls.models import CallRoom, CallUsage
from calls.usage import daily_totals
from meetings.models import Meeting
from quick.models import QuickUsage
from telephony.models import PhoneCall

User = get_user_model()


def estimate_inr(stt_seconds=0.0, translate_chars=0, tts_chars=0, input_tokens=0, output_tokens=0) -> dict:
    sarvam = (
        stt_seconds / 3600 * settings.COST_SARVAM_STT_INR_PER_HOUR
        + translate_chars / 10_000 * settings.COST_SARVAM_TRANSLATE_INR_PER_10K_CHARS
        + tts_chars / 10_000 * settings.COST_SARVAM_TTS_INR_PER_10K_CHARS
    )
    claude_usd = input_tokens / 1e6 * settings.COST_CLAUDE_INPUT_USD_PER_MTOK + output_tokens / 1e6 * settings.COST_CLAUDE_OUTPUT_USD_PER_MTOK
    claude = claude_usd * settings.COST_USD_TO_INR
    return {"sarvam": round(sarvam, 2), "claude": round(claude, 2), "total": round(sarvam + claude, 2)}


def _by_day(qs, date_field: str, **aggs) -> dict:
    rows = qs.annotate(day=TruncDate(date_field)).values("day").annotate(**aggs)
    return {r["day"]: r for r in rows}


class OverviewView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        days = max(1, min(int(request.query_params.get("days", 14)), 90))
        today = timezone.localdate()
        start_day = today - timedelta(days=days - 1)
        since = timezone.make_aware(timezone.datetime.combine(start_day, timezone.datetime.min.time()))

        calls = _by_day(CallUsage.objects.filter(room__created_at__gte=since), "room__created_at", stt=Sum("stt_seconds"), tr=Sum("translate_chars"), tts=Sum("tts_chars"))
        meetings = _by_day(Meeting.objects.filter(created_at__gte=since), "created_at", stt=Sum("stt_seconds"), tr=Sum("translate_chars"), n=Count("id"))
        quick = _by_day(QuickUsage.objects.filter(created_at__gte=since), "created_at", stt=Sum("stt_seconds"), tr=Sum("translate_chars"), tts=Sum("tts_chars"), n=Count("id"))
        claude = _by_day(AssistantUsage.objects.filter(created_at__gte=since), "created_at", i=Sum("input_tokens"), o=Sum("output_tokens"), n=Count("id"))
        rooms = _by_day(CallRoom.objects.filter(created_at__gte=since, started_at__isnull=False), "created_at", n=Count("id"))
        users = _by_day(User.objects.filter(date_joined__gte=since), "date_joined", n=Count("id"))
        phones = _by_day(PhoneCall.objects.filter(created_at__gte=since), "created_at", n=Count("id"))
        # Summary notes are not token-metered per call yet; their cost is not in these estimates.

        series = []
        for i in range(days):
            d = start_day + timedelta(days=i)
            g = lambda src, k: (src.get(d) or {}).get(k) or 0  # noqa: E731
            stt = g(calls, "stt") + g(meetings, "stt") + g(quick, "stt")
            tr = g(calls, "tr") + g(meetings, "tr") + g(quick, "tr")
            tts = g(calls, "tts") + g(quick, "tts")
            series.append(
                {
                    "date": d.isoformat(),
                    "calls": g(rooms, "n"),
                    "meetings": g(meetings, "n"),
                    "quick_translations": g(quick, "n"),
                    "assistant_requests": g(claude, "n"),
                    "phone_calls": g(phones, "n"),
                    "new_users": g(users, "n"),
                    "stt_minutes": round(stt / 60, 1),
                    "translate_chars": tr,
                    "tts_chars": tts,
                    "cost_inr": estimate_inr(stt, tr, tts, g(claude, "i"), g(claude, "o")),
                }
            )

        totals = daily_totals()
        day_start = timezone.make_aware(timezone.datetime.combine(today, timezone.datetime.min.time()))
        top = (
            User.objects.annotate(
                calls_today=Count("call_participations", filter=Q(call_participations__room__created_at__gte=day_start), distinct=True),
                assistant_today=Count("assistant_usage", filter=Q(assistant_usage__created_at__gte=day_start), distinct=True),
            )
            .filter(Q(calls_today__gt=0) | Q(assistant_today__gt=0))
            .order_by("-calls_today", "-assistant_today")[:5]
        )
        return Response(
            {
                "days": series,
                "today": {
                    "usage": totals,
                    "limits": settings.DAILY_LIMITS,
                    "active_calls": CallRoom.objects.filter(status=CallRoom.Status.ACTIVE).count(),
                    "users_total": User.objects.count(),
                },
                "period_cost_inr": round(sum(d["cost_inr"]["total"] for d in series), 2),
                "top_users": [{"id": u.id, "name": _name(u), "calls": u.calls_today, "assistant": u.assistant_today} for u in top],
                "cost_rates": {
                    "sarvam_stt_inr_per_hour": settings.COST_SARVAM_STT_INR_PER_HOUR,
                    "sarvam_translate_inr_per_10k": settings.COST_SARVAM_TRANSLATE_INR_PER_10K_CHARS,
                    "sarvam_tts_inr_per_10k": settings.COST_SARVAM_TTS_INR_PER_10K_CHARS,
                    "claude_input_usd_per_mtok": settings.COST_CLAUDE_INPUT_USD_PER_MTOK,
                    "claude_output_usd_per_mtok": settings.COST_CLAUDE_OUTPUT_USD_PER_MTOK,
                    "usd_to_inr": settings.COST_USD_TO_INR,
                },
            }
        )


def _name(user) -> str:
    pref = getattr(user, "language_preference", None)
    return (pref.display_name if pref and pref.display_name else "") or user.username


def _user_row(u) -> dict:
    phone = getattr(u, "phone", None)
    plan = plan_for(u)
    return {
        "id": u.id,
        "name": _name(u),
        "username": u.username,
        "phone": phone.number if phone else None,
        "is_active": u.is_active,
        "is_staff": u.is_staff,
        "date_joined": u.date_joined.isoformat(),
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "plan": plan.code if plan else None,
    }


class UserPage(PageNumberPagination):
    page_size = 25


class UsersView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        qs = User.objects.select_related("phone").order_by("-date_joined")
        if q := request.query_params.get("q", "").strip():
            qs = qs.filter(Q(username__icontains=q) | Q(phone__number__icontains=q) | Q(language_preference__display_name__icontains=q))
        pager = UserPage()
        page = pager.paginate_queryset(qs, request, view=self)
        return pager.get_paginated_response([_user_row(u) for u in page])


class UserUpdateSerializer(serializers.Serializer):
    is_active = serializers.BooleanField(required=False)
    plan = serializers.SlugField(required=False)
    note = serializers.CharField(required=False, allow_blank=True, max_length=200)


class UserDetailView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request, pk):
        u = get_object_or_404(User.objects.select_related("phone"), pk=pk)
        return Response({**_user_row(u), "usage": usage_for(u)})

    def patch(self, request, pk):
        u = get_object_or_404(User, pk=pk)
        s = UserUpdateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if "is_active" in d:
            if u == request.user and not d["is_active"]:
                return Response({"detail": "You cannot deactivate your own account."}, status=400)
            u.is_active = d["is_active"]
            u.save(update_fields=["is_active"])
            if not u.is_active:
                from rest_framework.authtoken.models import Token

                Token.objects.filter(user=u).delete()  # signs the user out of the mobile app
        if "plan" in d:
            plan = get_object_or_404(Plan, code=d["plan"], active=True)
            Subscription.objects.update_or_create(user=u, defaults={"plan": plan, "assigned_by": request.user, "note": d.get("note", "")})
        return Response({**_user_row(u), "usage": usage_for(u)})


class PlanSerializer(serializers.ModelSerializer):
    users = serializers.SerializerMethodField()

    class Meta:
        model = Plan
        fields = [
            "code", "name", "description", "price_inr_month", "daily_call_minutes", "daily_assistant_requests",
            "monthly_meeting_minutes", "video_calls", "phone_calls", "daily_phone_calls", "is_default", "active", "users",
        ]
        read_only_fields = ["code", "is_default", "users"]

    def get_users(self, obj):
        return obj.subscriptions.count()


class PlansView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response(PlanSerializer(Plan.objects.all(), many=True).data)


class PlanDetailView(APIView):
    permission_classes = [IsAdminUser]

    def patch(self, request, code):
        plan = get_object_or_404(Plan, code=code)
        s = PlanSerializer(plan, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        if s.validated_data.get("active") is False and plan.is_default:
            return Response({"detail": "The default plan cannot be turned off."}, status=400)
        s.save()
        return Response(s.data)

