from django.conf import settings

from integrations import secrets

from ..errors import ProviderNotConfigured
from .base import SummaryProvider, TranscriptLine

# Which API key each notes provider needs (notes, live notes and recall all follow SUMMARY_PROVIDER).
PROVIDER_KEYS = {"gemini": "gemini_api_key", "anthropic": "anthropic_api_key"}


def get_summarizer() -> SummaryProvider:
    """Providers live in this package; add another one here without touching callers."""
    provider = settings.SUMMARY_PROVIDER
    if provider == "gemini":
        from .gemini_provider import GeminiSummaryProvider

        return GeminiSummaryProvider()
    if provider == "anthropic":
        from .anthropic_provider import AnthropicSummaryProvider

        return AnthropicSummaryProvider()
    if provider in ("", "none"):
        raise ProviderNotConfigured("AI summaries are turned off (SUMMARY_PROVIDER=none).")
    raise ProviderNotConfigured(f"Unknown SUMMARY_PROVIDER {provider!r}")


def summaries_enabled() -> bool:
    key = PROVIDER_KEYS.get(settings.SUMMARY_PROVIDER)
    return bool(key and secrets.get(key))


__all__ = ["PROVIDER_KEYS", "SummaryProvider", "TranscriptLine", "get_summarizer", "summaries_enabled"]
