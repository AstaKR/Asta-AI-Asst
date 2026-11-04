from django.contrib import admin

from .models import CallParticipant, CallRoom, CallUsage, DirectCall


class ParticipantInline(admin.TabularInline):
    model = CallParticipant
    extra = 0


@admin.register(CallRoom)
class CallRoomAdmin(admin.ModelAdmin):
    list_display = ["code", "status", "created_by", "created_at", "started_at", "ended_at", "end_reason"]
    list_filter = ["status"]
    inlines = [ParticipantInline]


admin.site.register(CallUsage)


@admin.register(DirectCall)
class DirectCallAdmin(admin.ModelAdmin):
    list_display = ["caller", "callee", "status", "created_at", "answered_at", "ended_at"]
    list_filter = ["status"]
