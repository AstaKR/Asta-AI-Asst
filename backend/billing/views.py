from rest_framework.response import Response
from rest_framework.views import APIView

from .limits import plan_for, usage_for
from .models import Plan


def plan_dict(p: Plan) -> dict:
    return {
        "code": p.code,
        "name": p.name,
        "description": p.description,
        "price_inr_month": p.price_inr_month,
        "daily_call_minutes": p.daily_call_minutes,
        "daily_assistant_requests": p.daily_assistant_requests,
        "monthly_meeting_minutes": p.monthly_meeting_minutes,
        "video_calls": p.video_calls,
        "phone_calls": p.phone_calls,
        "daily_phone_calls": p.daily_phone_calls,
    }


class MyPlanView(APIView):
    """The signed-in user's plan, today's usage against it, and the available plans."""

    def get(self, request):
        plan = plan_for(request.user)
        return Response(
            {
                "plan": plan_dict(plan) if plan else None,
                "usage": usage_for(request.user),
                "unlimited": request.user.is_staff,
                "plans": [plan_dict(p) for p in Plan.objects.filter(active=True)],
                "payments": False,  # upgrades are done by an administrator for now
            }
        )
