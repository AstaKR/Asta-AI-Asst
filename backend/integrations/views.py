import logging
from dataclasses import asdict

from django.db import transaction
from rest_framework import serializers
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from calls.views import WorkerSecretPermission

from . import engines, secrets
from .models import ProviderSecret, SecretAuditLog

log = logging.getLogger(__name__)


class KeySerializer(serializers.Serializer):
    value = serializers.CharField(max_length=300, trim_whitespace=True, write_only=True)


def _ip(request):
    return request.META.get("REMOTE_ADDR")


def _audit(request, name, action, ok=True, detail=""):
    SecretAuditLog.objects.create(name=name, action=action, ok=ok, detail=detail[:200], user=request.user, ip=_ip(request))


def _unknown(name):
    return Response({"detail": "Unknown key."}, status=404)


def _payload():
    return {
        "keys": [asdict(secrets.status(n)) for n in secrets.PROVIDER_KEYS],
        "audit": [
            {"name": a.name, "action": a.action, "ok": a.ok, "detail": a.detail, "user": a.user.username if a.user else None, "at": a.at.isoformat()}
            for a in SecretAuditLog.objects.select_related("user")[:20]
        ],
    }


class AdminKeysView(APIView):
    """Admins only. Values are write-only: responses carry the source and last 4 characters, never the key."""

    permission_classes = [IsAdminUser]

    def get(self, request):
        return Response(_payload())


class AdminKeyDetailView(APIView):
    permission_classes = [IsAdminUser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "admin_keys"

    def put(self, request, name):
        if name not in secrets.PROVIDER_KEYS:
            return _unknown(name)
        s = KeySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        value = s.validated_data["value"]
        if problem := secrets.validate(name, value):
            return Response({"detail": problem}, status=400)
        try:
            token = secrets.encrypt(value)
        except secrets.SecretsNotConfigured as exc:
            return Response({"detail": str(exc), "code": "encryption_not_configured"}, status=503)
        with transaction.atomic():
            ProviderSecret.objects.update_or_create(name=name, defaults={"ciphertext": token, "last4": value[-4:], "updated_by": request.user})
            _audit(request, name, SecretAuditLog.Action.SET, detail=f"…{value[-4:]}")
        secrets.clear_cache()
        log.info("provider key %s updated by %s", name, request.user.username)
        return Response(_payload())

    def delete(self, request, name):
        if name not in secrets.PROVIDER_KEYS:
            return _unknown(name)
        deleted, _ = ProviderSecret.objects.filter(name=name).delete()
        if deleted:
            _audit(request, name, SecretAuditLog.Action.CLEAR)
        secrets.clear_cache()
        return Response(_payload())


class AdminKeyTestView(APIView):
    """Makes one tiny request with the current key to prove it works (a few characters of usage)."""

    permission_classes = [IsAdminUser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "admin_keys"

    def post(self, request, name):
        if name not in secrets.PROVIDER_KEYS:
            return _unknown(name)
        value = secrets.get(name)
        if not value:
            return Response({"ok": False, "detail": "No key is set."}, status=400)
        ok, detail = test_key(name, value)
        _audit(request, name, SecretAuditLog.Action.TEST, ok=ok, detail=detail)
        return Response({"ok": ok, "detail": detail})


def test_key(name: str, value: str) -> tuple[bool, str]:
    from meetings.errors import ProviderError

    try:
        if name == "anthropic_api_key":
            import anthropic

            from meetings.claude_errors import anthropic_errors

            with anthropic_errors():
                anthropic.Anthropic(api_key=value, timeout=20.0).models.list(limit=1)
            return True, "Anthropic accepted the key."
        from meetings.sarvam_client import SarvamClient

        SarvamClient(api_key=value, min_interval=0).translate("Hello", "en-IN", "hi-IN")
        return True, "Sarvam accepted the key."
    except ProviderError as exc:
        return False, str(exc)


class InternalProviderKeysView(APIView):
    """The translation worker fetches the current Sarvam key when a call starts (shared-secret auth)."""

    authentication_classes = []
    permission_classes = [WorkerSecretPermission]
    throttle_classes = []

    def get(self, request):
        return Response({"sarvam_api_key": secrets.get("sarvam_api_key")})


class AICapabilitiesView(APIView):
    """Which engine (sarvam / local) each AI job uses and whether it is ready. Signed-in users only."""

    def get(self, request):
        return Response(engines.capabilities())
