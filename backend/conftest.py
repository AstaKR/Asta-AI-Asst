import pytest


@pytest.fixture(autouse=True)
def _fresh_provider_keys():
    """Provider keys are cached for 30 s in-process; tests change them via settings."""
    from integrations import secrets

    secrets.clear_cache()
    yield
    secrets.clear_cache()
