from django.contrib import admin

from .models import CallParticipant, CallRoom, CallUsage


class ParticipantInline(admin.TabularInline):
    model = CallParticipant
    extra = 0


@admin.register(CallRoom)
class CallRoomAdmin(admin.ModelAdmin):
    list_display = ["code", "status", "created_by", "created_at", "started_at", "ended_at", "end_reason"]
    list_filter = ["status"]
    inlines = [ParticipantInline]


admin.site.register(CallUsage)
