from django.urls import path

from . import views

urlpatterns = [path("me/plan/", views.MyPlanView.as_view(), name="my-plan")]
