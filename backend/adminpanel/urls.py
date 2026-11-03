from django.urls import path

from . import views

urlpatterns = [
    path("admin/overview/", views.OverviewView.as_view(), name="admin-overview"),
    path("admin/users/", views.UsersView.as_view(), name="admin-users"),
    path("admin/users/<int:pk>/", views.UserDetailView.as_view(), name="admin-user"),
    path("admin/plans/", views.PlansView.as_view(), name="admin-plans"),
    path("admin/plans/<slug:code>/", views.PlanDetailView.as_view(), name="admin-plan"),
]
