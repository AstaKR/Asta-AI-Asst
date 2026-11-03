import pytest


@pytest.fixture(autouse=True)
def _fresh_provider_keys():
    """Provider keys are cached for 30 s in-process; tests change them via settings."""
    from integrations import secrets

    secrets.clear_cache()
    yield
    secrets.clear_cache()


@pytest.fixture(autouse=True)
def _no_real_local_ai(settings):
    """Tests never reach a running local AI service (.env may point at one); tests that need it mock it."""
    from integrations import local_ai

    settings.LOCAL_AI_URL = ""
    local_ai.clear_health_cache()
    yield
    local_ai.clear_health_cache()
