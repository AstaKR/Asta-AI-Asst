import dataclasses

import httpx
import pytest

from translation_worker.config import load_config, with_backend_keys


def cfg_with(secret="s3cret", key="env-key"):
    base = load_config()
    return dataclasses.replace(base, worker_secret=secret, backend_url="http://backend", sarvam=dataclasses.replace(base.sarvam, api_key=key))


def client(handler):
    return httpx.AsyncClient(base_url="http://backend", transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_uses_admin_key_from_backend():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"sarvam_api_key": "admin-key"})

    cfg = await with_backend_keys(cfg_with(), http=client(handler))
    assert cfg.sarvam.api_key == "admin-key"
    assert seen[0].url.path == "/api/internal/provider-keys/" and seen[0].headers["X-Worker-Secret"] == "s3cret"


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [httpx.Response(403), httpx.Response(200, json={"sarvam_api_key": ""})], ids=["forbidden", "empty"])
async def test_keeps_env_key(response):
    cfg = await with_backend_keys(cfg_with(), http=client(lambda r: response))
    assert cfg.sarvam.api_key == "env-key"


@pytest.mark.asyncio
async def test_backend_down_keeps_env_key():
    def handler(request):
        raise httpx.ConnectError("down")

    assert (await with_backend_keys(cfg_with(), http=client(handler))).sarvam.api_key == "env-key"


@pytest.mark.asyncio
async def test_no_secret_skips_request():
    def handler(request):
        raise AssertionError("must not call the backend without a shared secret")

    assert (await with_backend_keys(cfg_with(secret=""), http=client(handler))).sarvam.api_key == "env-key"
