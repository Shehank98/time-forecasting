"""In-memory per-session data store with TTL cleanup. Nothing is persisted."""
from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field

import pandas as pd

log = logging.getLogger(__name__)

TTL_SECONDS = int(os.environ.get("SESSION_TTL_MIN", "120")) * 60


@dataclass
class Dataset:
    df: pd.DataFrame
    report: dict
    files: list[str] = field(default_factory=list)
    hashes: list[str] = field(default_factory=list)

    @property
    def version(self) -> str:
        """Stable id of the data content, used as the forecast cache key."""
        h = hashlib.sha1("|".join(sorted(self.hashes)).encode()).hexdigest()
        return f"{h[:16]}-{len(self.df)}"


@dataclass
class Session:
    sid: str
    touched: float = field(default_factory=time.time)
    data: dict[str, Dataset] = field(default_factory=dict)


class SessionStore:
    def __init__(self, ttl: int = TTL_SECONDS) -> None:
        self.ttl = ttl
        self._s: dict[str, Session] = {}
        self._lock = threading.Lock()

    def _sweep(self) -> None:
        now = time.time()
        for sid in [k for k, v in self._s.items() if now - v.touched > self.ttl]:
            del self._s[sid]
            log.info("Expired session %s", sid)

    def get(self, sid: str | None, create: bool = True) -> Session | None:
        with self._lock:
            self._sweep()
            if sid and sid in self._s:
                s = self._s[sid]
            elif create:
                s = Session(sid=uuid.uuid4().hex)
                self._s[s.sid] = s
            else:
                return None
            s.touched = time.time()
            return s

    def __len__(self) -> int:
        return len(self._s)


def content_hash(content: bytes) -> str:
    return hashlib.sha1(content).hexdigest()
