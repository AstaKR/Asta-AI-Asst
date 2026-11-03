"""Maps Anthropic SDK exceptions to the provider errors shown to users (shared by notes and the assistant)."""

from __future__ import annotations

from contextlib import contextmanager

import anthropic

from .errors import ProviderAuthError, ProviderQuotaError, ProviderRateLimited, ProviderRequestError, ProviderUnavailable


@contextmanager
def anthropic_errors():
    try:
        yield
    except anthropic.AuthenticationError as exc:
        raise ProviderAuthError("The Anthropic API key was rejected.") from exc
    except anthropic.PermissionDeniedError as exc:
        raise ProviderAuthError("The Anthropic API key lacks permission for this model.") from exc
    except anthropic.RateLimitError as exc:
        raise ProviderRateLimited("Anthropic rate limit reached; try again shortly.") from exc
    except anthropic.BadRequestError as exc:
        if "credit" in str(exc).lower():
            raise ProviderQuotaError("Anthropic credits are exhausted.") from exc
        raise ProviderRequestError(f"Anthropic rejected the request: {exc.message}"[:300]) from exc
    except anthropic.APIStatusError as exc:
        raise ProviderUnavailable(f"Anthropic server error ({exc.status_code}).") from exc
    except anthropic.APIConnectionError as exc:
        raise ProviderUnavailable("Could not reach Anthropic.") from exc
