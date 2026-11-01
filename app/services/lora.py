"""Adapter registry and the on-demand training job for the incremental LoRA update.

Adapters live in models/ (lora_<ProductGroup>.pt and lora_global_sl.pt) next to lora_manifest.json, which records what each one was trained on.
Training itself is scripts/incremental_lora_update.py; this module only finds adapters, reports their state and starts the script.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
_job: dict = {"state": "idle"}
_lock = threading.Lock()


def models_dir() -> Path:
    return Path(os.environ.get("MODELS_DIR") or ROOT / "models")


def name_for(product_group: str | None) -> str:
    if not product_group:
        return "lora_global_sl"
    return "lora_" + (re.sub(r"[^A-Za-z0-9]+", "_", product_group).strip("_")[:60] or "group")


def enabled() -> bool:
    return os.environ.get("LORA_ENABLED", "0") == "1"


def manifest() -> dict:
    p = models_dir() / "lora_manifest.json"
    try:
        return json.loads(p.read_text(encoding="utf8"))
    except (OSError, ValueError):
        return {}


def status(product_group: str | None = None) -> dict:
    m = manifest()
    out = {"training_enabled": enabled(), "applied_at_inference": False,
           "note": "Adapters are trained and stored here. They are not yet switched on in the forecast engine, so forecasts do not change until that is verified on your checkpoint.",
           "global": {}, "group": {}}
    for key, nm in (("global", name_for(None)), ("group", name_for(product_group) if product_group else None)):
        if not nm:
            continue
        f = models_dir() / f"{nm}.pt"
        info = m.get(nm, {})
        out[key] = {"name": nm, "exists": f.exists(), "trained_through": info.get("trained_through"), "trained_at": info.get("trained_at"), "windows": info.get("windows"), "steps": info.get("steps")}
    out["job"] = dict(_job)
    return out


def start(product_group: str | None, global_too: bool = True) -> dict:
    if not enabled():
        return {"ok": False, "message": "Adapter training is switched off on this server. Set LORA_ENABLED=1 where torch and the forecast model are installed."}
    with _lock:
        if _job.get("state") == "running":
            return {"ok": False, "message": "A training run is already in progress."}
        args = [sys.executable, str(ROOT / "scripts" / "incremental_lora_update.py")]
        args += ["--product-group", product_group] if product_group else ["--all"]
        if global_too:
            args += ["--with-global"]
        log = models_dir() / "lora_train.log"
        models_dir().mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen(args, stdout=open(log, "ab"), stderr=subprocess.STDOUT, cwd=str(ROOT))
        _job.clear(); _job.update({"state": "running", "pid": proc.pid, "started": int(time.time()), "product_group": product_group})

        def watch() -> None:
            code = proc.wait()
            with _lock:
                _job.update({"state": "done" if code == 0 else "failed", "exit_code": code, "finished": int(time.time())})
        threading.Thread(target=watch, daemon=True).start()
    return {"ok": True, "message": "Training started in the background.", "job": dict(_job)}
