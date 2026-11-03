"""Keeps loaded models within a RAM budget: least-recently-used models are unloaded first."""

from __future__ import annotations

import gc
import logging
import threading
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

log = logging.getLogger(__name__)


class ModelUnavailable(Exception):
    """A model or its library is not installed, not downloaded, or not accessible (gated repo)."""


class ModelRegistry:
    def __init__(self, budget_gb: float):
        self.budget_gb = budget_gb
        self._loaded: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str, size_gb: float, loader: Callable[[], Any]) -> Any:
        with self._lock:
            if key in self._loaded:
                self._loaded.move_to_end(key)
                return self._loaded[key][0]
            while self._loaded and self.used_gb + size_gb > self.budget_gb:
                old, _ = self._loaded.popitem(last=False)
                log.info("unloading %s to stay within %.1f GB", old, self.budget_gb)
                gc.collect()
            log.info("loading %s (~%.1f GB)", key, size_gb)
            try:
                obj = loader()
            except ModelUnavailable:
                raise
            except Exception as exc:
                raise ModelUnavailable(f"{key} could not be loaded: {exc.__class__.__name__}: {exc}") from exc
            self._loaded[key] = (obj, size_gb)
            return obj

    @property
    def used_gb(self) -> float:
        return sum(size for _, size in self._loaded.values())

    def loaded(self) -> list[str]:
        return list(self._loaded)
