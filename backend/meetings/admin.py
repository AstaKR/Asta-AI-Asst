from django.contrib import admin

from .models import ActionItem, Meeting, MeetingJob, TranscriptSegment


@admin.register(Meeting)
class MeetingAdmin(admin.ModelAdmin):
    list_display = ["title", "owner", "source", "status", "recorded_at", "duration_seconds"]
    list_filter = ["status", "source"]
    search_fields = ["title"]


admin.site.register(MeetingJob)
admin.site.register(TranscriptSegment)
admin.site.register(ActionItem)
