from ..config import WorkerConfig
from .base import ProviderConfigError, SpeechProvider


def create_provider(cfg: WorkerConfig) -> SpeechProvider:
    """Factory: add new providers here. Test doubles are NOT registered — production never falls back to fakes."""
    if cfg.provider == "sarvam":
        from .sarvam import SarvamProvider

        return SarvamProvider(cfg.sarvam)
    if cfg.provider == "local":
        from .local import LocalProvider

        return LocalProvider(cfg.local)
    raise ProviderConfigError(f"Unknown SPEECH_PROVIDER {cfg.provider!r}")
