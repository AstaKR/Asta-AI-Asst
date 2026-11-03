from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.HealthView.as_view()),
    path("rooms/", views.RoomListCreateView.as_view()),
    path("rooms/<str:code>/", views.RoomDetailView.as_view()),
    path("rooms/<str:code>/join/", views.RoomJoinView.as_view()),
    path("rooms/<str:code>/token/", views.RoomTokenView.as_view()),
    path("rooms/<str:code>/languages/", views.RoomLanguagesView.as_view()),
    path("rooms/<str:code>/leave/", views.RoomLeaveView.as_view()),
    path("rooms/<str:code>/end/", views.RoomEndView.as_view()),
    path("usage/", views.UsageSummaryView.as_view()),
    path("internal/usage/", views.WorkerUsageReportView.as_view()),
]
