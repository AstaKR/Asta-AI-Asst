from django.conf import settings

from integrations import secrets

from ..errors import ProviderNotConfigured
from .base import SummaryProvider, TranscriptLine


def get_summarizer() -> SummaryProvider:
    """Providers live in this package; add e.g. an OpenAI provider here without touching callers."""
    provider = settings.SUMMARY_PROVIDER
    if provider == "anthropic":
        from .anthropic_provider import AnthropicSummaryProvider

        return AnthropicSummaryProvider()
    if provider == "ollama":
        from .ollama_provider import OllamaSummaryProvider

        return OllamaSummaryProvider()
    if provider in ("", "none"):
        raise ProviderNotConfigured("AI summaries are turned off (SUMMARY_PROVIDER=none).")
    raise ProviderNotConfigured(f"Unknown SUMMARY_PROVIDER {provider!r}")


def summaries_enabled() -> bool:
    if settings.SUMMARY_PROVIDER == "ollama":
        return True  # local; a job reports clearly if Ollama or the model is missing
    return settings.SUMMARY_PROVIDER == "anthropic" and bool(secrets.get("anthropic_api_key"))


__all__ = ["SummaryProvider", "TranscriptLine", "get_summarizer", "summaries_enabled"]
