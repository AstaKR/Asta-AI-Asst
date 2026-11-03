from django.urls import path

from . import views

urlpatterns = [
    path("admin/keys/", views.AdminKeysView.as_view(), name="admin-keys"),
    path("admin/keys/<str:name>/", views.AdminKeyDetailView.as_view(), name="admin-key"),
    path("admin/keys/<str:name>/test/", views.AdminKeyTestView.as_view(), name="admin-key-test"),
    path("ai/capabilities/", views.AICapabilitiesView.as_view(), name="ai-capabilities"),
    path("internal/provider-keys/", views.InternalProviderKeysView.as_view(), name="internal-provider-keys"),
]
