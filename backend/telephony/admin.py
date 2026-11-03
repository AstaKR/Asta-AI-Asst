from django.contrib import admin

from .models import PhoneCall, PhoneLine


@admin.register(PhoneLine)
class PhoneLineAdmin(admin.ModelAdmin):
    list_display = ["number", "user", "label", "active", "created_at"]
    search_fields = ["number", "user__username"]


@admin.register(PhoneCall)
class PhoneCallAdmin(admin.ModelAdmin):
    list_display = ["created_at", "owner", "direction", "status", "line_number"]
    list_filter = ["direction", "status"]
    readonly_fields = [f.name for f in PhoneCall._meta.fields]
