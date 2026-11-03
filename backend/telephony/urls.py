from django.urls import path

from . import views

urlpatterns = [
    path("phone/config/", views.PhoneConfigView.as_view(), name="phone-config"),
    path("phone/dial/", views.DialView.as_view(), name="phone-dial"),
    path("phone/calls/", views.PhoneCallListView.as_view(), name="phone-calls"),
    path("phone/incoming/", views.IncomingView.as_view(), name="phone-incoming"),
    path("phone/calls/<uuid:pk>/answer/", views.AnswerView.as_view(), name="phone-answer"),
    path("phone/calls/<uuid:pk>/decline/", views.DeclineView.as_view(), name="phone-decline"),
    path("phone/calls/<uuid:pk>/connected/", views.ConnectedView.as_view(), name="phone-connected"),
    path("phone/livekit-webhook/", views.LiveKitWebhookView.as_view(), name="livekit-webhook"),
]
