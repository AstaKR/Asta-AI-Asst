"""Django settings. All secrets and environment-specific values come from env vars (.env at repo root)."""

import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent
load_dotenv(REPO_ROOT / ".env")


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise ImproperlyConfigured(f"Missing required environment variable {name}")
    return value


def env_bool(name: str, default: bool) -> bool:
    return env(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    return int(env(name, str(default)))


def env_float(name: str, default: float) -> float:
    return float(env(name, str(default)))


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in env(name, default).split(",") if item.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = env("DJANGO_SECRET_KEY", "insecure-dev-only-key" if DEBUG else None)
if not DEBUG and (SECRET_KEY.startswith("insecure") or SECRET_KEY.startswith("replace")):
    raise ImproperlyConfigured("Set a strong DJANGO_SECRET_KEY in production")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework.authtoken",
    "accounts",
    "calls",
    "meetings",
    "quick",
    "assistant",
    "telephony",
    "integrations",
    "billing",
    "adminpanel",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

_db_url = env("DATABASE_URL", "sqlite:///db.sqlite3")
if _db_url.startswith("sqlite:///") and not _db_url.startswith("sqlite:////"):
    # Resolve relative SQLite paths against backend/
    _db_url = f"sqlite:///{(BASE_DIR / _db_url.removeprefix('sqlite:///')).as_posix()}"
DATABASES = {"default": dj_database_url.parse(_db_url, conn_max_age=60)}
if DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3":
    # Dev only: IMMEDIATE transactions + busy timeout so concurrent writes wait instead of
    # failing with "database is locked" (SQLite cannot upgrade a deferred read lock safely).
    DATABASES["default"]["CONN_MAX_AGE"] = 0
    DATABASES["default"]["OPTIONS"] = {"transaction_mode": "IMMEDIATE", "timeout": 20}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------- Browser security ----------
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "http://localhost:5173")
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7

if not DEBUG:
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    # The worker reports usage over the private Docker network (plain HTTP to backend:8000).
    SECURE_REDIRECT_EXEMPT = [r"^api/internal/"]
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

REST_FRAMEWORK = {
    # Session cookies for the web app; "Authorization: Token <key>" for the mobile app.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.TokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/minute",
        "user": "300/minute",
        "auth": "20/hour",
        "otp": env("OTP_RATE", "10/hour"),
        "room_create": env("ROOM_CREATE_RATE", "10/hour"),
        "token": env("TOKEN_RATE", "30/hour"),
        "quick": env("QUICK_RATE", "120/hour"),
        "assistant": env("ASSISTANT_RATE", "60/hour"),
        "dial": env("DIAL_RATE", "20/hour"),
        "admin_keys": env("ADMIN_KEYS_RATE", "30/hour"),
    },
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}

# ---------- Application settings ----------
LIVEKIT_URL = env("LIVEKIT_URL", "ws://localhost:7880")
LIVEKIT_AUTO_PORT = env_int("LIVEKIT_AUTO_PORT", 7880)
if LIVEKIT_URL == "auto" and not DEBUG:
    raise ImproperlyConfigured("LIVEKIT_URL=auto is for local development only; set the real wss:// URL")
LIVEKIT_API_KEY = env("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = env("LIVEKIT_API_SECRET", "")
LIVEKIT_TOKEN_TTL_SECONDS = env_int("LIVEKIT_TOKEN_TTL_SECONDS", 600)
AGENT_NAME = env("AGENT_NAME", "call-translator")
WORKER_SHARED_SECRET = env("WORKER_SHARED_SECRET", "")
TRANSLATION_ENABLED = env_bool("TRANSLATION_ENABLED", True)

# Languages offered in the first release (Sarvam BCP-47 codes).
SUPPORTED_LANGUAGES = {"ta-IN": "Tamil", "hi-IN": "Hindi", "en-IN": "English"}
# bulbul:v3 voices offered in the UI (subset of the documented speaker list).
SUPPORTED_VOICES = ["shubh", "aditya", "rahul", "rohan", "amit", "ritu", "priya", "neha", "pooja", "kavya"]
DEFAULT_VOICE = env("SARVAM_DEFAULT_SPEAKER", "shubh")

MAX_PARTICIPANTS = env_int("MAX_PARTICIPANTS", 2)
MAX_CALL_DURATION_SECONDS = env_int("MAX_CALL_DURATION_SECONDS", 600)
# Video calls only use LiveKit bandwidth (no extra AI cost); turn off on metered LiveKit plans if needed.
VIDEO_CALLS_ENABLED = env_bool("VIDEO_CALLS_ENABLED", True)
ROOM_INVITE_TTL_SECONDS = env_int("ROOM_INVITE_TTL_SECONDS", 60 * 60 * 6)

DAILY_LIMITS = {
    "call_seconds": env_int("DAILY_CALL_SECONDS_LIMIT", 3600),
    "stt_seconds": env_int("DAILY_STT_SECONDS_LIMIT", 1800),
    "tts_chars": env_int("DAILY_TTS_CHARS_LIMIT", 20000),
    "translate_chars": env_int("DAILY_TRANSLATE_CHARS_LIMIT", 40000),
}
PER_CALL_LIMITS = {
    "stt_seconds": env_int("PER_CALL_STT_SECONDS_LIMIT", 600),
    "tts_chars": env_int("PER_CALL_TTS_CHARS_LIMIT", 6000),
    "translate_chars": env_int("PER_CALL_TRANSLATE_CHARS_LIMIT", 12000),
}

# ---------- Mobile-number login (OTP) ----------
# console = print codes to the server log (DEBUG only); memory = tests; a real DLT-registered SMS
# provider must be configured before production use.
SMS_BACKEND = env("SMS_BACKEND", "console" if DEBUG else "disabled")
OTP_LENGTH = env_int("OTP_LENGTH", 6)
OTP_TTL_SECONDS = env_int("OTP_TTL_SECONDS", 300)
OTP_MAX_ATTEMPTS = env_int("OTP_MAX_ATTEMPTS", 5)
OTP_RESEND_SECONDS = env_int("OTP_RESEND_SECONDS", 30)
OTP_MAX_PER_PHONE_PER_HOUR = env_int("OTP_MAX_PER_PHONE_PER_HOUR", 5)

# Virtual number users forward their mobile calls to (empty until a telephony provider is set up).
PHONE_FORWARDING_NUMBER = env("PHONE_FORWARDING_NUMBER", "")

# ---------- Phone calls through LiveKit SIP (telephony app) ----------
# Off until a SIP trunk (Exotel / Plivo) and the LiveKit SIP service are set up: see docs/TELEPHONY.md.
TELEPHONY_ENABLED = env_bool("TELEPHONY_ENABLED", False)
LIVEKIT_SIP_OUTBOUND_TRUNK_ID = env("LIVEKIT_SIP_OUTBOUND_TRUNK_ID", "")
# Rooms created by the inbound SIP dispatch rule start with this prefix (manage.py setup_sip uses it).
PHONE_ROOM_PREFIX = env("PHONE_ROOM_PREFIX", "phone-")
# Attribute carrying the number that forwarded the call (an X-* header mapped by the inbound trunk).
# Whether the provider sends it must be confirmed with Exotel/Plivo; dedicated lines (PhoneLine) always work.
PHONE_FORWARDED_FROM_ATTRIBUTE = env("PHONE_FORWARDED_FROM_ATTRIBUTE", "forwarded_from")
PHONE_RING_SECONDS = env_int("PHONE_RING_SECONDS", 30)
PHONE_DIAL_ALLOWED_PREFIXES = [p.strip() for p in env("PHONE_DIAL_ALLOWED_PREFIXES", "+91").split(",") if p.strip()]
PHONE_DIAL_DAILY_LIMIT_PER_USER = env_int("PHONE_DIAL_DAILY_LIMIT_PER_USER", 20)

# ---------- Meetings: recordings, transcripts, summaries ----------
# Recordings are stored privately (never served as static files; only the owner can stream them).
MEDIA_ROOT = Path(env("MEDIA_ROOT", "") or str(BASE_DIR / "media_private"))
MEDIA_URL = "/media-private/"  # not routed: files are served by the authenticated audio endpoint
MEETING_MAX_UPLOAD_MB = env_int("MEETING_MAX_UPLOAD_MB", 200)
MEETING_MAX_DURATION_SECONDS = env_int("MEETING_MAX_DURATION_SECONDS", 2 * 60 * 60)
# Transcription engine: sarvam (cloud, paid per audio second) | local (faster-whisper, free, optional install)
MEETING_STT_ENGINE = env("MEETING_STT_ENGINE", "sarvam")
MEETING_STT_MODEL = env("MEETING_STT_MODEL", "saaras:v4")
MEETING_STT_MODE = env("MEETING_STT_MODE", "codemix")  # codemix handles Tamil/Hindi mixed with English
MEETING_TRANSLATE_MODEL = env("MEETING_TRANSLATE_MODEL", "mayura:v1")
LOCAL_WHISPER_MODEL = env("LOCAL_WHISPER_MODEL", "small")
SARVAM_API_KEY = env("SARVAM_API_KEY", "").strip()
# Free local open-source AI service (local_ai/, its own virtualenv; see docs/LOCAL_AI.md).
LOCAL_AI_URL = env("LOCAL_AI_URL", "").strip()  # e.g. http://127.0.0.1:8090 ; empty = not used
LOCAL_AI_SECRET = env("LOCAL_AI_SECRET", "").strip()
LOCAL_AI_TIMEOUT_SECONDS = float(env("LOCAL_AI_TIMEOUT_SECONDS", "300"))  # CPU models are slow on laptops
LOCAL_AI_CHUNK_SECONDS = env_int("LOCAL_AI_CHUNK_SECONDS", 300)  # meeting audio is sent in pieces for progress
# Which engine each AI job uses: sarvam (cloud, paid) | local (free, this server). Meetings keep MEETING_STT_ENGINE.
AI_ENGINE = env("AI_ENGINE", "sarvam")
TRANSLATE_ENGINE = env("TRANSLATE_ENGINE", AI_ENGINE)
STT_ENGINE = env("STT_ENGINE", AI_ENGINE)
TTS_ENGINE = env("TTS_ENGINE", AI_ENGINE)
SARVAM_MIN_REQUEST_INTERVAL = float(env("SARVAM_MIN_REQUEST_INTERVAL", "1.05"))
PROVIDER_TIMEOUT_SECONDS = float(env("PROVIDER_TIMEOUT_SECONDS", "30"))
# AI summaries: anthropic | ollama (local) | none. Uses ANTHROPIC_API_KEY (server-side only).
SUMMARY_PROVIDER = env("SUMMARY_PROVIDER", "anthropic")
SUMMARY_MODEL = env("SUMMARY_MODEL", "claude-opus-5-5")
SUMMARY_EFFORT = env("SUMMARY_EFFORT", "medium")
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", "").strip()
# SUMMARY_PROVIDER=ollama: a local model served by Ollama (free). Qwen3 models are Apache-2.0.
OLLAMA_URL = env("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = env("OLLAMA_MODEL", "qwen3:4b")
OLLAMA_TIMEOUT_SECONDS = float(env("OLLAMA_TIMEOUT_SECONDS", "600"))
# Encrypts provider API keys saved from the admin page (Fernet key; generate with
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())").
# Required in production; keep it out of the database backups' location.
SECRETS_ENCRYPTION_KEY = env("SECRETS_ENCRYPTION_KEY", "").strip()

# ---------- Plans (billing app) and admin dashboard ----------
# Per-user limits come from the user's plan (default: the plan marked is_default). Staff are not limited.
PLANS_ENFORCED = env_bool("PLANS_ENFORCED", True)
# Cost estimates shown on the admin dashboard (INR). Check them against your provider invoices.
COST_SARVAM_STT_INR_PER_HOUR = env_float("COST_SARVAM_STT_INR_PER_HOUR", 30.0)
COST_SARVAM_TRANSLATE_INR_PER_10K_CHARS = env_float("COST_SARVAM_TRANSLATE_INR_PER_10K_CHARS", 20.0)
COST_SARVAM_TTS_INR_PER_10K_CHARS = env_float("COST_SARVAM_TTS_INR_PER_10K_CHARS", 30.0)
COST_CLAUDE_INPUT_USD_PER_MTOK = env_float("COST_CLAUDE_INPUT_USD_PER_MTOK", 4.0)  # Opus 5.5
COST_CLAUDE_OUTPUT_USD_PER_MTOK = env_float("COST_CLAUDE_OUTPUT_USD_PER_MTOK", 20.0)
COST_USD_TO_INR = env_float("COST_USD_TO_INR", 88.0)
MEETING_AUTO_SUMMARY = env_bool("MEETING_AUTO_SUMMARY", False)

# ---------- Instant / face-to-face translation ----------
# One short utterance or text per request; counted in the same daily AI budget as calls and meetings.
QUICK_MAX_SPEECH_SECONDS = env_int("QUICK_MAX_SPEECH_SECONDS", 30)  # Sarvam REST STT limit
QUICK_MAX_UPLOAD_KB = env_int("QUICK_MAX_UPLOAD_KB", 2048)
QUICK_MAX_TEXT_CHARS = env_int("QUICK_MAX_TEXT_CHARS", 1000)
QUICK_TTS_MODEL = env("SARVAM_TTS_MODEL", "bulbul:v3")
QUICK_TTS_SAMPLE_RATE = env_int("SARVAM_TTS_SAMPLE_RATE", 24000)

# ---------- AI assistant (chat + photo translation, Claude) ----------
# Uses ANTHROPIC_API_KEY. Opus 5.5 at low effort costs roughly Rs 1 per chat reply; claude-haiku-5-5 costs less.
ASSISTANT_MODEL = env("ASSISTANT_MODEL", "claude-opus-5-5")
ASSISTANT_EFFORT = env("ASSISTANT_EFFORT", "low")
ASSISTANT_MAX_TOKENS = env_int("ASSISTANT_MAX_TOKENS", 4000)
ASSISTANT_MAX_CONVERSATION_CHARS = env_int("ASSISTANT_MAX_CONVERSATION_CHARS", 20000)
ASSISTANT_MAX_IMAGE_MB = env_int("ASSISTANT_MAX_IMAGE_MB", 5)  # Claude's per-image limit
ASSISTANT_DAILY_REQUESTS_PER_USER = env_int("ASSISTANT_DAILY_REQUESTS_PER_USER", 100)
ASSISTANT_DAILY_REQUESTS = env_int("ASSISTANT_DAILY_REQUESTS", 500)
