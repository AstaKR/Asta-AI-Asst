from django.urls import path

from . import views

urlpatterns = [
    path("auth/csrf/", views.CsrfView.as_view()),
    path("auth/register/", views.RegisterView.as_view()),
    path("auth/login/", views.LoginView.as_view()),
    path("auth/logout/", views.LogoutView.as_view()),
    path("auth/otp/request/", views.OTPRequestView.as_view()),
    path("auth/otp/verify/", views.OTPVerifyView.as_view()),
    path("auth/me/", views.MeView.as_view()),
    path("preferences/", views.PreferenceView.as_view()),
    path("languages/", views.LanguagesView.as_view()),
]
