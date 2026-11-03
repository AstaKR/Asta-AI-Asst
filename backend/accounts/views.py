import hmac
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import phone as phone_utils
from .models import OTPChallenge, PhoneNumber, get_preference
from .serializers import (
    LoginSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    PreferenceSerializer,
    RegisterSerializer,
    user_payload,
)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the csrftoken cookie so the SPA can send X-CSRFToken on unsafe requests."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "ok"})


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        return Response(user_payload(user), status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(request, **serializer.validated_data)
        if user is None:
            return Response({"detail": "Invalid username or password."}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        return Response(user_payload(user))


class LogoutView(APIView):
    def post(self, request):
        if isinstance(request.auth, Token):
            request.auth.delete()  # mobile: revoke this device's token
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class OTPRequestView(APIView):
    """Send a login code to an Indian mobile number."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp"

    def post(self, request):
        data = OTPRequestSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            phone = phone_utils.normalize_phone(data.validated_data["phone"])
        except phone_utils.InvalidPhone as exc:
            return Response({"phone": [str(exc)]}, status=400)
        now = timezone.now()
        recent = OTPChallenge.objects.filter(phone=phone, created_at__gte=now - timedelta(hours=1))
        if recent.count() >= settings.OTP_MAX_PER_PHONE_PER_HOUR:
            return Response({"detail": "Too many codes requested. Try again later.", "code": "otp_limit"}, status=429)
        last = recent.first()
        if last and (now - last.created_at).total_seconds() < settings.OTP_RESEND_SECONDS:
            wait = settings.OTP_RESEND_SECONDS - int((now - last.created_at).total_seconds())
            return Response({"detail": f"Please wait {wait} s before requesting another code.", "code": "otp_wait"}, status=429)
        code = phone_utils.generate_code()
        with transaction.atomic():
            OTPChallenge.objects.filter(phone=phone, consumed=False).update(consumed=True)
            OTPChallenge.objects.create(
                phone=phone, code_hash=phone_utils.hash_code(phone, code), expires_at=phone_utils.otp_expiry()
            )
        phone_utils.send_sms(phone, f"{code} is your AI Call Translator login code. It expires in {settings.OTP_TTL_SECONDS // 60} minutes.")
        return Response(
            {"sent_to": phone_utils.mask_phone(phone), "expires_in": settings.OTP_TTL_SECONDS, "resend_in": settings.OTP_RESEND_SECONDS}
        )


class OTPVerifyView(APIView):
    """Verify the code; creates the account on first login. Returns an API token for the mobile app."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = OTPVerifySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            phone = phone_utils.normalize_phone(data.validated_data["phone"])
        except phone_utils.InvalidPhone as exc:
            return Response({"phone": [str(exc)]}, status=400)
        invalid = Response({"detail": "Incorrect or expired code.", "code": "otp_invalid"}, status=400)
        with transaction.atomic():
            challenge = (
                OTPChallenge.objects.select_for_update()
                .filter(phone=phone, consumed=False, expires_at__gt=timezone.now())
                .first()
            )
            if challenge is None:
                return invalid
            if challenge.attempts >= settings.OTP_MAX_ATTEMPTS:
                challenge.consumed = True
                challenge.save(update_fields=["consumed"])
                return Response({"detail": "Too many wrong attempts. Request a new code.", "code": "otp_locked"}, status=400)
            expected = phone_utils.hash_code(phone, data.validated_data["code"])
            if not hmac.compare_digest(expected, challenge.code_hash):
                challenge.attempts += 1
                challenge.save(update_fields=["attempts"])
                return invalid
            challenge.consumed = True
            challenge.save(update_fields=["consumed"])

            record = PhoneNumber.objects.select_related("user").filter(number=phone).first()
            is_new = record is None
            if is_new:
                User = get_user_model()
                user = User.objects.create_user(username=f"m{phone.lstrip('+')}")
                user.set_unusable_password()
                user.save()
                PhoneNumber.objects.create(user=user, number=phone, verified_at=timezone.now())
                pref = get_preference(user)
                pref.display_name = data.validated_data.get("display_name") or f"User {phone[-4:]}"
                pref.save()
            else:
                user = record.user
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "is_new": is_new, "user": user_payload(user)})


class MeView(APIView):
    def get(self, request):
        return Response(user_payload(request.user))


class PreferenceView(APIView):
    def get(self, request):
        return Response(PreferenceSerializer(get_preference(request.user)).data)

    def put(self, request):
        serializer = PreferenceSerializer(get_preference(request.user), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class LanguagesView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {
                "languages": [{"code": c, "name": n} for c, n in settings.SUPPORTED_LANGUAGES.items()],
                "voices": settings.SUPPORTED_VOICES,
                "default_voice": settings.DEFAULT_VOICE,
                "translation_enabled": settings.TRANSLATION_ENABLED,
                "phone_forwarding_number": settings.PHONE_FORWARDING_NUMBER or None,
            }
        )
