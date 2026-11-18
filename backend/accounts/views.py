import hmac
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import phone as phone_utils
from .models import OTPChallenge, PhoneNumber, get_preference
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    PasswordResetSerializer,
    PreferenceSerializer,
    RegisterSerializer,
    check_new_password,
    user_payload,
)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the csrftoken cookie so the SPA can send X-CSRFToken on unsafe requests."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "ok"})


def _with_token(request, user, payload: dict) -> dict:
    """Mobile clients send {"want_token": true} and get an API token back; web keeps the session cookie only."""
    if request.data.get("want_token") is True:
        token, _ = Token.objects.get_or_create(user=user)
        return {**payload, "token": token.key}
    return payload


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        return Response(_with_token(request, user, user_payload(user)), status=status.HTTP_201_CREATED)


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
        return Response(_with_token(request, user, user_payload(user)))


class LogoutView(APIView):
    def post(self, request):
        if isinstance(request.auth, Token):
            request.auth.delete()  # mobile: revoke this device's token
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class OTPRequestView(APIView):
    """Send a login code to an Indian mobile number."""

    def check_phone(self, request, phone):
        """Hook: return a Response to refuse sending a code to this number."""
        return None

    def deliver(self, phone, code):
        phone_utils.send_sms(phone, f"{code} is your Asta Talk login code. It expires in {settings.OTP_TTL_SECONDS // 60} minutes.")

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
        refusal = self.check_phone(request, phone)
        if refusal is not None:
            return refusal
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
        self.deliver(phone, code)
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


class PhoneLinkRequestView(OTPRequestView):
    """Signed-in user adds a mobile number: sends a code to it."""

    permission_classes = [IsAuthenticated]

    def check_phone(self, request, phone):
        taken = PhoneNumber.objects.filter(number=phone).exclude(user=request.user).exists()
        if taken:
            return Response({"detail": "That number is already linked to another account.", "code": "phone_taken"}, status=409)
        return None


class PhoneLinkVerifyView(APIView):
    """Verify the code and attach the number to the signed-in account (replaces any previous number)."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = OTPVerifySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            phone = phone_utils.normalize_phone(data.validated_data["phone"])
        except phone_utils.InvalidPhone as exc:
            return Response({"phone": [str(exc)]}, status=400)
        with transaction.atomic():
            challenge = (
                OTPChallenge.objects.select_for_update()
                .filter(phone=phone, consumed=False, expires_at__gt=timezone.now())
                .first()
            )
            if challenge is None:
                return Response({"detail": "Incorrect or expired code.", "code": "otp_invalid"}, status=400)
            if challenge.attempts >= settings.OTP_MAX_ATTEMPTS:
                challenge.consumed = True
                challenge.save(update_fields=["consumed"])
                return Response({"detail": "Too many wrong attempts. Request a new code.", "code": "otp_locked"}, status=400)
            if not hmac.compare_digest(phone_utils.hash_code(phone, data.validated_data["code"]), challenge.code_hash):
                challenge.attempts += 1
                challenge.save(update_fields=["attempts"])
                return Response({"detail": "Incorrect or expired code.", "code": "otp_invalid"}, status=400)
            challenge.consumed = True
            challenge.save(update_fields=["consumed"])
            if PhoneNumber.objects.filter(number=phone).exclude(user=request.user).exists():
                return Response({"detail": "That number is already linked to another account.", "code": "phone_taken"}, status=409)
            PhoneNumber.objects.update_or_create(user=request.user, defaults={"number": phone, "verified_at": timezone.now()})
        request.user.refresh_from_db()
        return Response(user_payload(request.user))

    def delete(self, request):
        PhoneNumber.objects.filter(user=request.user).delete()
        return Response(user_payload(request.user))


def _consume_code(phone: str, code: str):
    """Checks and burns a code. Returns an error Response, or None when the code was right.
    Call inside transaction.atomic() so the row lock holds."""
    challenge = (
        OTPChallenge.objects.select_for_update().filter(phone=phone, consumed=False, expires_at__gt=timezone.now()).first()
    )
    if challenge is None:
        return Response({"detail": "Incorrect or expired code.", "code": "otp_invalid"}, status=400)
    if challenge.attempts >= settings.OTP_MAX_ATTEMPTS:
        challenge.consumed = True
        challenge.save(update_fields=["consumed"])
        return Response({"detail": "Too many wrong attempts. Request a new code.", "code": "otp_locked"}, status=400)
    if not hmac.compare_digest(phone_utils.hash_code(phone, code), challenge.code_hash):
        challenge.attempts += 1
        challenge.save(update_fields=["attempts"])
        return Response({"detail": "Incorrect or expired code.", "code": "otp_invalid"}, status=400)
    challenge.consumed = True
    challenge.save(update_fields=["consumed"])
    return None


class ChangePasswordView(APIView):
    """Signed-in user changes their password. This device stays signed in; other web sessions are signed out by Django."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = ChangePasswordSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(data.validated_data["old_password"]):
            return Response({"old_password": ["Current password is incorrect."]}, status=400)
        try:
            check_new_password(data.validated_data["new_password"], user)
        except Exception as exc:
            return Response({"new_password": exc.detail}, status=400)
        user.set_password(data.validated_data["new_password"])
        user.save(update_fields=["password"])
        update_session_auth_hash(request, user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetRequestView(OTPRequestView):
    """Forgot password: sends a code to the verified number of an account.
    The reply is identical whether or not the number belongs to an account."""

    def deliver(self, phone, code):
        if PhoneNumber.objects.filter(number=phone).exists():
            phone_utils.send_sms(
                phone, f"{code} is your Asta Talk password reset code. It expires in {settings.OTP_TTL_SECONDS // 60} minutes."
            )


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = PasswordResetSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            phone = phone_utils.normalize_phone(data.validated_data["phone"])
        except phone_utils.InvalidPhone as exc:
            return Response({"phone": [str(exc)]}, status=400)
        record = PhoneNumber.objects.select_related("user").filter(number=phone).first()
        if record is not None:
            try:
                check_new_password(data.validated_data["new_password"], record.user)
            except Exception as exc:
                return Response({"new_password": exc.detail}, status=400)
        with transaction.atomic():
            error = _consume_code(phone, data.validated_data["code"])
            if error is not None:
                return error
            if record is None:  # a code can exist for a number with no account; never reveal that
                return Response({"detail": "Incorrect or expired code.", "code": "otp_invalid"}, status=400)
            user = record.user
            user.set_password(data.validated_data["new_password"])
            user.save(update_fields=["password"])
            Token.objects.filter(user=user).delete()  # sign out every device
        return Response(status=status.HTTP_204_NO_CONTENT)


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
