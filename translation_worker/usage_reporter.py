"""Reports cumulative per-call usage to the backend and applies its allow/deny decision."""

from __future__ import annotations

import asyncio
import contextlib
import logging

import httpx

from .metrics import LatencyStats
from .pipeline import Counters, UsageGate
from .providers.base import ProviderUsage

log = logging.getLogger("translation_worker.usage")


class UsageReporter:
    def __init__(
        self,
        *,
        backend_url: str,
        secret: str,
        room_name: str,
        usage: ProviderUsage,
        counters: Counters,
        stats: LatencyStats,
        gate: UsageGate,
        interval_s: float = 15.0,
        http: httpx.AsyncClient | None = None,
    ):
        self.room_name = room_name
        self.usage = usage
        self.counters = counters
        self.stats = stats
        self.gate = gate
        self.interval_s = interval_s
        self.secret = secret
        self._http = http or httpx.AsyncClient(base_url=backend_url, timeout=5)
        self._task: asyncio.Task | None = None
        self.consecutive_failures = 0
        if not secret:
            log.warning("WORKER_SHARED_SECRET not set: usage is not reported; only local per-call caps apply")

    def payload(self, final: bool = False) -> dict:
        return {
            "room_name": self.room_name,
            "stt_seconds": round(self.usage.stt_seconds, 2),
            "translate_chars": self.usage.translate_chars,
            "tts_chars": self.usage.tts_chars,
            "provider_requests": self.usage.requests,
            "provider_errors": self.usage.errors,
            "utterances": self.counters.utterances,
            "dropped_utterances": self.counters.dropped_utterances,
            "reconnects": self.counters.reconnects,
            "latency": self.stats.summary(),
            "final": final,
        }

    async def report(self, final: bool = False) -> dict | None:
        if not self.secret:
            return None
        try:
            resp = await self._http.post(
                "/api/internal/usage/", json=self.payload(final), headers={"X-Worker-Secret": self.secret}
            )
            resp.raise_for_status()
            decision = resp.json()
        except Exception as exc:
            self.consecutive_failures += 1
            log.warning("usage report failed (%s); local caps still enforced", exc.__class__.__name__)
            return None
        self.consecutive_failures = 0
        if not decision.get("allowed", True):
            self.gate.stop(decision.get("reason") or "backend_denied")
        return decision

    def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="usage reporter")

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self.interval_s)
            await self.report()

    async def aclose(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(BaseException):
                await self._task
        await self.report(final=True)
        await self._http.aclose()


class SegmentReporter:
    """Posts finalized utterances to the backend (saved transcripts). Fire-and-forget, bounded, in order."""

    def __init__(self, *, backend_url: str, secret: str, room_name: str, http: httpx.AsyncClient | None = None, max_queue: int = 200):
        self.room_name = room_name
        self.secret = secret
        self._http = http or httpx.AsyncClient(base_url=backend_url, timeout=5)
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=max_queue)
        self._task: asyncio.Task | None = None
        self.sent = 0
        self.failed = 0

    def submit(self, segment: dict) -> None:
        if not self.secret:
            return
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="segment reporter")
        try:
            self._queue.put_nowait({"room_name": self.room_name, **segment})
        except asyncio.QueueFull:
            self.failed += 1

    async def _loop(self) -> None:
        while True:
            body = await self._queue.get()
            try:
                resp = await self._http.post(
                    "/api/internal/meeting-segments/", json=body, headers={"X-Worker-Secret": self.secret}
                )
                resp.raise_for_status()
                self.sent += 1
            except Exception as exc:
                self.failed += 1
                log.warning("segment report failed (%s)", exc.__class__.__name__)
            finally:
                self._queue.task_done()

    async def flush(self, timeout: float = 5.0) -> None:
        if self._task is not None:
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._queue.join(), timeout)

    async def aclose(self) -> None:
        await self.flush()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(BaseException):
                await self._task
        await self._http.aclose()
