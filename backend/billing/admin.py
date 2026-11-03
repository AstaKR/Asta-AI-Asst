from django.contrib import admin

from .models import Plan, Subscription


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "price_inr_month", "daily_call_minutes", "daily_assistant_requests", "monthly_meeting_minutes", "phone_calls", "is_default", "active"]


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "plan", "started_at", "expires_at", "assigned_by"]
    autocomplete_fields = ["user"]
