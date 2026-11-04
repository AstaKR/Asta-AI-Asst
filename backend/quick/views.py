"""Instant translation: one text or one short utterance in, translation (and optionally speech) out.

Used by the mobile app's Instant and Face-to-face screens. Nothing the user says or types is stored;
only usage numbers (QuickUsage) are kept for the daily AI budget.
"""

import base64
import io
import logging
import os
import tempfile
import wave
from pathlib import Path

from django.conf import settings
from rest_framework import serializers
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.models import get_preference
from meetings import audio as audio_lib
from meetings.errors import BudgetExceeded, ProviderError
from meetings.languages import AUTO, MEETING_LANGUAGES, from_bcp47, to_bcp47
from integrations.engines import Engines
from meetings.services import check_budget

from .models import QuickUsage

log = logging.getLogger(__name__)
LANGUAGE_CHOICES = list(MEETING_LANGUAGES)


class _Common(serializers.Serializer):
    target_language = serializers.ChoiceField(choices=LANGUAGE_CHOICES)
    speak = serializers.BooleanField(default=False)
    voice = serializers.ChoiceField(choices=settings.SUPPORTED_VOICES, required=False)


class TextSerializer(_Common):
    text = serializers.CharField(max_length=settings.QUICK_MAX_TEXT_CHARS, trim_whitespace=True)
    source_language = serializers.ChoiceField(choices=LANGUAGE_CHOICES)


class SpeechSerializer(_Common):
    file = serializers.FileField()
    source_language = serializers.ChoiceField(choices=[AUTO, *LANGUAGE_CHOICES], default=AUTO)
    # Speech-to-text only (e.g. dictating to the assistant): no translation or voice.
    transcribe_only = serializers.BooleanField(default=False)
    # Hands-free conversation: "ta,hi". The spoken language is detected and translated into the other one
    # (source_language must be "auto"; target_language is then ignored).
    pair = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_pair(self, value):
        if not value:
            return []
        langs = [x.strip() for x in value.split(",")]
        if len(langs) != 2 or langs[0] == langs[1] or any(x not in MEETING_LANGUAGES for x in langs):
            raise serializers.ValidationError("Give two different languages, e.g. ta,hi.")
        return langs

    def validate(self, attrs):
        if attrs["pair"] and attrs["source_language"] != AUTO:
            raise serializers.ValidationError({"pair": "Use pair only with source_language=auto."})
        return attrs


def _join_wavs(wavs: list[bytes]) -> bytes | None:
    """Sarvam may return several WAV parts; join them into one file for simple playback."""
    if not wavs:
        return None
    if len(wavs) == 1:
        return wavs[0]
    frames, params = bytearray(), None
    for data in wavs:
        with wave.open(io.BytesIO(data)) as w:
            params = params or w.getparams()
            frames.extend(w.readframes(w.getnframes()))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setparams(params)
        out.writeframes(bytes(frames))
    return buf.getvalue()


class _QuickView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "quick"

    def _voice(self, request, data) -> str:
        return data.get("voice") or get_preference(request.user).voice or settings.DEFAULT_VOICE

    def _finish(self, request, *, kind, data, original, source, stt_seconds, client: Engines):
        # Usage numbers count only billed (Sarvam) work; the local engine is free.
        target = data["target_language"]
        translate_chars = 0
        translation = original
        if source != target:
            if client.billed("translate"):
                check_budget(translate_chars=len(original))
                translate_chars = len(original)
            translation = client.translate(original, to_bcp47(source), to_bcp47(target))
        audio, tts_chars = None, 0
        if data["speak"] and translation:
            if client.billed("tts"):
                self._check_tts(len(translation))
                tts_chars = len(translation)
            audio = _join_wavs(client.text_to_speech(translation, to_bcp47(target), self._voice(request, data)))
        QuickUsage.objects.create(
            user=request.user,
            kind=kind,
            source_language=source,
            target_language=target,
            stt_seconds=stt_seconds,
            translate_chars=translate_chars,
            tts_chars=tts_chars,
        )
        return Response(
            {
                "original": original,
                "source_language": source,
                "translation": translation,
                "target_language": target,
                "audio": base64.b64encode(audio).decode() if audio else None,
                "audio_mime": "audio/wav" if audio else None,
            }
        )

    @staticmethod
    def _check_tts(chars: int) -> None:
        from calls.usage import daily_totals

        if daily_totals()["tts_chars"] + chars > settings.DAILY_LIMITS["tts_chars"]:
            raise BudgetExceeded("Today's AI voice limit would be exceeded. Try again tomorrow or raise DAILY_TTS_CHARS_LIMIT.")

    def _run(self, fn):
        try:
            return fn()
        except BudgetExceeded as exc:
            return Response({"detail": str(exc), "code": "budget"}, status=429)
        except ProviderError as exc:
            log.warning("quick translation provider error: %s", exc)
            return Response({"detail": str(exc), "code": "provider"}, status=502)


class QuickTextView(_QuickView):
    def post(self, request):
        s = TextSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data

        def go():
            client = Engines()
            return self._finish(
                request, kind=QuickUsage.Kind.TEXT, data=data, original=data["text"], source=data["source_language"], stt_seconds=0, client=client
            )

        return self._run(go)


class QuickSpeechView(_QuickView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        s = SpeechSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        upload = data["file"]
        ext = Path(upload.name or "").suffix.lower()
        if ext not in audio_lib.ALLOWED_EXTENSIONS:
            return Response({"detail": "Unsupported audio format."}, status=400)
        if upload.size > settings.QUICK_MAX_UPLOAD_KB * 1024:
            return Response({"detail": "The recording is too large."}, status=400)

        fd, tmp = tempfile.mkstemp(suffix=ext)
        try:
            with os.fdopen(fd, "wb") as f:
                for chunk in upload.chunks():
                    f.write(chunk)
            try:
                info = audio_lib.probe(tmp)
                if info.duration_seconds > settings.QUICK_MAX_SPEECH_SECONDS + 0.5:
                    return Response({"detail": f"Speak for at most {settings.QUICK_MAX_SPEECH_SECONDS} seconds at a time."}, status=400)
                wav = audio_lib.wav_bytes(audio_lib.decode_pcm16(tmp))
            except audio_lib.InvalidAudio as exc:
                return Response({"detail": str(exc)}, status=400)
        finally:
            os.unlink(tmp)

        def go():
            client = Engines()
            stt_seconds = info.duration_seconds if client.billed("stt") else 0
            if stt_seconds:
                check_budget(stt_seconds=stt_seconds)
            given = data["source_language"]
            text, detected = client.speech_to_text(wav, None if given == AUTO else to_bcp47(given))
            if not text:
                QuickUsage.objects.create(
                    user=request.user, kind=QuickUsage.Kind.SPEECH, source_language="", target_language=data["target_language"], stt_seconds=stt_seconds
                )
                return Response({"detail": "No speech was recognised. Hold the button and speak clearly.", "code": "no_speech"}, status=422)
            source = given if given != AUTO else (from_bcp47(detected) or data["target_language"])
            fields = {**data, "target_language": source, "speak": False} if data["transcribe_only"] else data
            if data["pair"]:
                if from_bcp47(detected) not in data["pair"]:
                    names = " or ".join(MEETING_LANGUAGES[x] for x in data["pair"])
                    return Response({"detail": f"Could not tell whether that was {names}. Please say it again.", "code": "unknown_language"}, status=422)
                source = from_bcp47(detected)
                fields = {**data, "target_language": next(x for x in data["pair"] if x != source)}
            return self._finish(
                request, kind=QuickUsage.Kind.SPEECH, data=fields, original=text, source=source, stt_seconds=stt_seconds, client=client
            )

        return self._run(go)
