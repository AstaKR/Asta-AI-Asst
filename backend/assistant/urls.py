from django.urls import path

from . import views

urlpatterns = [
    path("assistant/config/", views.AssistantConfigView.as_view(), name="assistant-config"),
    path("assistant/chat/", views.AssistantChatView.as_view(), name="assistant-chat"),
    path("assistant/image/", views.AssistantImageView.as_view(), name="assistant-image"),
]
