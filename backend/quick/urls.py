from django.urls import path

from . import views

urlpatterns = [
    path("quick/text/", views.QuickTextView.as_view(), name="quick-text"),
    path("quick/speech/", views.QuickSpeechView.as_view(), name="quick-speech"),
]
