from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("accounts.urls")),
    path("api/", include("calls.urls")),
    path("api/", include("meetings.urls")),
    path("api/", include("quick.urls")),
    path("api/", include("assistant.urls")),
    path("api/", include("telephony.urls")),
    path("api/", include("integrations.urls")),
    path("api/", include("billing.urls")),
    path("api/", include("adminpanel.urls")),
]
