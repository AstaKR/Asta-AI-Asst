from django.conf import settings
from rest_framework import serializers


def validate_language(value: str) -> str:
    if value not in settings.SUPPORTED_LANGUAGES:
        raise serializers.ValidationError(
            f"Unsupported language '{value}'. Supported: {', '.join(settings.SUPPORTED_LANGUAGES)}"
        )
    return value


def validate_voice(value: str) -> str:
    if value and value not in settings.SUPPORTED_VOICES:
        raise serializers.ValidationError(f"Unsupported voice '{value}'")
    return value
