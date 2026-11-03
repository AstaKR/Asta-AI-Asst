class ProviderError(Exception):
    """Base for transcription / translation / summary provider failures. Messages are safe to show users."""

    retryable = False


class ProviderNotConfigured(ProviderError):
    """Missing API key or optional dependency (e.g. faster-whisper not installed)."""


class ProviderAuthError(ProviderError):
    pass


class ProviderQuotaError(ProviderError):
    """Credits exhausted. Never retried."""


class ProviderRateLimited(ProviderError):
    retryable = True


class ProviderUnavailable(ProviderError):
    """Timeouts, 5xx and network errors."""

    retryable = True


class ProviderRequestError(ProviderError):
    """The provider rejected the request (400/422)."""


class BudgetExceeded(Exception):
    """A configured usage limit would be exceeded."""
