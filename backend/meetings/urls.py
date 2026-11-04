from django.urls import path

from . import views

urlpatterns = [
    path("meetings/", views.MeetingListCreateView.as_view()),
    path("meetings/config/", views.MeetingConfigView.as_view()),
    path("meetings/live/", views.LiveMeetingCreateView.as_view()),
    path("meetings/<uuid:pk>/", views.MeetingDetailView.as_view()),
    path("meetings/<uuid:pk>/audio/", views.MeetingAudioView.as_view()),
    path("meetings/<uuid:pk>/live-started/", views.LiveMeetingStartedView.as_view()),
    path("meetings/<uuid:pk>/transcribe/", views.MeetingTranscribeView.as_view()),
    path("meetings/<uuid:pk>/translate/", views.MeetingTranslateView.as_view()),
    path("meetings/<uuid:pk>/summarize/", views.MeetingSummarizeView.as_view()),
    path("meetings/<uuid:pk>/segments/<int:index>/", views.SegmentUpdateView.as_view()),
    path("meetings/<uuid:pk>/action-items/<int:item_id>/", views.ActionItemUpdateView.as_view()),
    path("meetings/<uuid:pk>/export/", views.MeetingExportView.as_view()),
    path("rooms/<str:code>/transcript/", views.CallTranscriptConsentView.as_view()),
    path("internal/meeting-segments/", views.InternalMeetingSegmentView.as_view()),
    path("internal/call-recording/", views.InternalCallRecordingView.as_view()),
]
