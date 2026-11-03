import re

from django.contrib.auth import get_user_model, password_validation
from rest_framework import serializers

from .models import LanguagePreference, get_preference
from .validators import validate_language, validate_voice

User = get_user_model()
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=30)
    password = serializers.CharField(write_only=True, max_length=128)
    display_name = serializers.CharField(max_length=60, required=False, allow_blank=True)

    def validate_username(self, value):
        if not USERNAME_RE.match(value):
            raise serializers.ValidationError("Use 3-30 letters, digits, dot, underscore or hyphen.")
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is taken.")
        return value

    def validate(self, attrs):
        try:
            password_validation.validate_password(attrs["password"], User(username=attrs["username"]))
        except Exception as exc:  # django ValidationError -> DRF error on the password field
            raise serializers.ValidationError({"password": list(getattr(exc, "messages", [str(exc)]))})
        return attrs

    def create(self, validated):
        user = User.objects.create_user(username=validated["username"], password=validated["password"])
        pref = get_preference(user)
        pref.display_name = validated.get("display_name") or user.username
        pref.save()
        return user


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=30)
    password = serializers.CharField(write_only=True, max_length=128)


class PreferenceSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(max_length=60, required=False, allow_blank=True)
    spoken_language = serializers.CharField(validators=[validate_language], required=False)
    listen_language = serializers.CharField(validators=[validate_language], required=False)
    voice = serializers.CharField(validators=[validate_voice], required=False, allow_blank=True)
    original_voice_volume = serializers.IntegerField(min_value=0, max_value=100, required=False)

    class Meta:
        model = LanguagePreference
        fields = [
            "display_name",
            "spoken_language",
            "listen_language",
            "voice",
            "show_subtitles",
            "original_voice_volume",
        ]


class OTPRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)


class OTPVerifySerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    code = serializers.RegexField(r"^\d{4,8}$", error_messages={"invalid": "Enter the code from the SMS."})
    display_name = serializers.CharField(max_length=60, required=False, allow_blank=True)


def user_payload(user) -> dict:
    pref = get_preference(user)
    phone = getattr(user, "phone", None)
    return {
        "id": user.id,
        "username": user.username,
        "phone_number": phone.number if phone else None,
        "is_staff": user.is_staff,
        "preferences": PreferenceSerializer(pref).data,
    }
