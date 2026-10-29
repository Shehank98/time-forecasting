"""Client workspaces: datasets persisted in the database with a small in-memory cache."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Iterator

import pandas as pd

from . import repo

log = logging.getLogger(__name__)

CACHE_DATASETS = int(os.environ.get("CACHE_DATASETS", "24"))


@dataclass
class Dataset:
    df: pd.DataFrame
    report: dict
    files: list[str] = field(default_factory=list)
    hashes: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    @property
    def version(self) -> str:
        """Stable id of the data content and mapping, used as the forecast cache key."""
        blob = "|".join(sorted(self.hashes)) + json.dumps(self.meta, sort_keys=True, default=str)
        return f"{hashlib.sha1(blob.encode()).hexdigest()[:16]}-{len(self.df)}"


class _Cache:
    """LRU of loaded datasets keyed by (client, kind, name) and the row's update stamp."""

    def __init__(self, size: int) -> None:
        self._d: OrderedDict[tuple, tuple[object, Dataset]] = OrderedDict()
        self._size = size
        self._lock = threading.Lock()

    def get(self, key: tuple, stamp: object) -> Dataset | None:
        with self._lock:
            hit = self._d.get(key)
            if hit and hit[0] == stamp:
                self._d.move_to_end(key)
                return hit[1]
        return None

    def put(self, key: tuple, stamp: object, ds: Dataset) -> None:
        with self._lock:
            self._d[key] = (stamp, ds)
            self._d.move_to_end(key)
            while len(self._d) > self._size:
                self._d.popitem(last=False)

    def drop(self, key: tuple) -> None:
        with self._lock:
            self._d.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._d.clear()


cache = _Cache(CACHE_DATASETS)


def split_key(key: str) -> tuple[str, str]:
    """'tv' -> ('tv', ''); 'kpi:Leads' -> ('kpi', 'Leads')."""
    kind, _, name = key.partition(":")
    return kind, name


class DatasetMap:
    """dict-like access to a client's datasets: ws.data['tv'], ws.data['kpi:Search demand']."""

    def __init__(self, client_id: int, user_id: int | None) -> None:
        self.client_id, self.user_id = client_id, user_id

    def get(self, key: str) -> Dataset | None:
        kind, name = split_key(key)
        stamp = repo.dataset_stamp(self.client_id, kind, name)
        if stamp is None:
            return None
        ck = (self.client_id, kind, name)
        ds = cache.get(ck, stamp)
        if ds is None:
            row = repo.load_dataset(self.client_id, kind, name)
            if row is None:
                return None
            ds = Dataset(row["df"], row["report"], row["files"], row["hashes"], row["meta"])
            cache.put(ck, stamp, ds)
        return ds

    def __getitem__(self, key: str) -> Dataset:
        ds = self.get(key)
        if ds is None:
            raise KeyError(key)
        return ds

    def __contains__(self, key: str) -> bool:
        kind, name = split_key(key)
        return repo.dataset_stamp(self.client_id, kind, name) is not None

    def __setitem__(self, key: str, ds: Dataset) -> None:
        kind, name = split_key(key)
        repo.save_dataset(self.client_id, kind, name, ds.df, ds.report, ds.meta, ds.files, ds.hashes, self.user_id)
        cache.drop((self.client_id, kind, name))

    def pop(self, key: str, default: object = None) -> object:
        kind, name = split_key(key)
        repo.delete_dataset(self.client_id, kind, name)
        cache.drop((self.client_id, kind, name))
        return default

    def __iter__(self) -> Iterator[str]:
        for d in repo.list_datasets(self.client_id):
            yield d["kind"] if not d["name"] else f"{d['kind']}:{d['name']}"


@dataclass
class Workspace:
    """What a request works on: one client, as one user."""
    client_id: int
    user_id: int
    is_admin: bool = False

    def __post_init__(self) -> None:
        self.data = DatasetMap(self.client_id, self.user_id)

    @property
    def sid(self) -> str:
        return f"u{self.user_id}"


def content_hash(content: bytes) -> str:
    return hashlib.sha1(content).hexdigest()
