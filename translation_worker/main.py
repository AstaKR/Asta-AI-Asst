"""Translation worker entrypoint (LiveKit Agents server, explicit dispatch by agent name).

Run from the repo root:
    .venv\\Scripts\\python -m translation_worker.main dev
"""

from __future__ import annotations

import json
import logging
import os

from livekit.agents import AutoSubscribe, JobContext, JobRequest, WorkerOptions, cli

from .config import load_config, with_backend_keys
from .providers import create_provider
from .providers.base import ProviderConfigError
from .session import CallSession

log = logging.getLogger("translation_worker")
CFG = load_config()


async def request_fnc(req: JobRequest) -> None:
    await req.accept(name="AI Translator", attributes={"role": "translator"})


async def entrypoint(ctx: JobContext) -> None:
    try:
        meta = json.loads(ctx.job.metadata or "{}")
    except json.JSONDecodeError:
        meta = {}
    cfg = await with_backend_keys(CFG)
    provider, disabled_reason = None, ""
    if not cfg.translation_enabled:
        disabled_reason = "translation_disabled"
    else:
        try:
            provider = create_provider(cfg)
        except ProviderConfigError as exc:
            log.error("translation unavailable: %s", exc)
            disabled_reason = "provider_not_configured"

    await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_NONE)
    log.info("joined room %s (translation %s)", ctx.room.name, "on" if provider else f"off: {disabled_reason}")
    session = CallSession(ctx.room, cfg, provider, job_metadata=meta, lkapi=ctx.api, disabled_reason=disabled_reason)
    ctx.add_shutdown_callback(session.aclose)
    await session.start()


def main() -> None:
    # LIVEKIT_WORKER_URL lets the worker reach LiveKit over localhost when both run on one machine,
    # while LIVEKIT_URL (handed to phones/browsers in tokens) uses the network address.
    # The Agents CLI reads LIVEKIT_URL itself (overriding WorkerOptions.ws_url), so override the
    # environment variable for this process only.
    if os.environ.get("LIVEKIT_WORKER_URL"):
        os.environ["LIVEKIT_URL"] = os.environ["LIVEKIT_WORKER_URL"]
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, request_fnc=request_fnc, agent_name=CFG.agent_name))


if __name__ == "__main__":
    main()
