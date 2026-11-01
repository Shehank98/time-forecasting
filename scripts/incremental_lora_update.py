#!/usr/bin/env python
"""Incremental LoRA update from the history vault.

    python scripts/incremental_lora_update.py --product-group "Detergents" --with-global
    python scripts/incremental_lora_update.py --all
    python scripts/incremental_lora_update.py --product-group "Detergents" --dry-run     # shows what would be trained, needs no torch

Each run trains only on windows that end after the adapter's `trained_through` date (recorded in models/lora_manifest.json) plus a
small replay sample of older windows, so adapters keep learning as new uploads reach the vault without starting over.

Outputs: models/lora_<ProductGroup>.pt per product group and models/lora_global_sl.pt for the whole agency.

STATUS: the vault reading, window selection, incremental bookkeeping and --dry-run are tested. The training step needs torch and the
timesfm checkpoint and has NOT been run against a real checkpoint in this repository's test environment (neither is installed there).
The forecast engine does not load these adapters at inference yet; see app/services/lora.py.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.services import lora, vault  # noqa: E402


def daily_series(vault_root: Path, product_group: str | None) -> list[tuple[str, pd.Series]]:
    """Zero-filled daily spend per advertiser for one product group (or every group), and daily mean TVR per channel for the global adapter."""
    out: list[tuple[str, pd.Series]] = []
    base = vault_root / "lmrb"
    if base.exists():
        for gdir in sorted(base.iterdir()):
            for f in sorted(gdir.glob("*.parquet")):
                df = pd.read_parquet(f, columns=["date", "product_group", "advertiser", "cost"])
                if df.empty or (product_group and df["product_group"].iloc[0] != product_group):
                    continue
                s = df.groupby(pd.to_datetime(df["date"]))["cost"].sum()
                out.append((f"{df['product_group'].iloc[0]}|{df['advertiser'].iloc[0]}", s.asfreq("D", fill_value=0.0)))
    if product_group is None and (vault_root / "tv").exists():
        for f in sorted((vault_root / "tv").glob("*.parquet")):
            df = pd.read_parquet(f, columns=["date", "channel", "tvr"])
            if len(df):
                out.append((f"TV|{df['channel'].iloc[0]}", df.groupby(pd.to_datetime(df["date"]))["tvr"].mean().asfreq("D").interpolate(limit_direction="both")))
    return out


def make_windows(series: list[tuple[str, pd.Series]], context: int, horizon: int, stride: int, trained_through: str | None, replay: float, seed: int = 0) -> dict:
    """Training windows (context, target). New ones end after trained_through; a replay share of older ones keeps old knowledge fresh."""
    rng = np.random.default_rng(seed)
    cut = pd.Timestamp(trained_through) if trained_through else None
    new, old = [], []
    for name, s in series:
        v, idx = s.to_numpy(dtype=float), s.index
        n = len(v)
        for end in range(min(context, max(28, n - horizon)), n - horizon + 1, stride):    # end = first target index
            ctx = v[max(0, end - context):end]
            if len(ctx) < 28 or not np.any(ctx):
                continue
            w = {"name": name, "context": ctx, "target": v[end:end + horizon], "ends": idx[end + horizon - 1]}
            (new if cut is None or w["ends"] > cut else old).append(w)
    keep_old = [old[i] for i in rng.permutation(len(old))[: int(len(old) * replay)]] if old else []
    return {"new": new, "replay": keep_old, "all": new + keep_old, "through": max([w["ends"] for w in new + old], default=None)}


def train(adapter: str, windows: list[dict], steps: int, rank: int, lr: float, models: Path) -> dict:
    """LoRA fine-tuning on the forecast model with a pinball (quantile) loss. Needs torch and the timesfm checkpoint."""
    try:
        import torch  # noqa: F401
    except ImportError as exc:
        raise SystemExit("Training needs torch and the timesfm checkpoint, which are not installed here. Use --dry-run to check the data.") from exc
    from app.services import forecast as F
    if not F.model.load():
        raise SystemExit(f"The forecast model could not be loaded: {F.model.error}")
    from app.services.lora_torch import fit
    return fit(F.model._tfm, adapter, windows, steps=steps, rank=rank, lr=lr, out=models / f"{adapter}.pt")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--product-group")
    g.add_argument("--all", action="store_true", help="every product group in the vault")
    ap.add_argument("--with-global", action="store_true", help="also update the agency-wide adapter")
    ap.add_argument("--context", type=int, default=256)
    ap.add_argument("--horizon", type=int, default=28)
    ap.add_argument("--stride", type=int, default=14)
    ap.add_argument("--replay", type=float, default=0.2, help="share of older windows replayed")
    ap.add_argument("--steps", type=int, default=200)
    ap.add_argument("--rank", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    vroot, models = vault.root(), lora.models_dir()
    groups = [a.product_group] if a.product_group else sorted({p.name for p in (vroot / "lmrb").iterdir()}) if (vroot / "lmrb").exists() else []
    if a.all:        # directory names are slugs; recover the real names from the files
        names = []
        for d in (vroot / "lmrb").iterdir() if (vroot / "lmrb").exists() else []:
            f = next(d.glob("*.parquet"), None)
            if f is not None:
                names.append(pd.read_parquet(f, columns=["product_group"])["product_group"].iloc[0])
        groups = sorted(set(names))
    jobs: list[tuple[str, str | None]] = [(lora.name_for(g), g) for g in groups] + ([(lora.name_for(None), None)] if a.with_global or a.all else [])
    manifest = lora.manifest()
    report = []
    for adapter, pg in jobs:
        info = manifest.get(adapter, {})
        w = make_windows(daily_series(vroot, pg), a.context, a.horizon, a.stride, info.get("trained_through"), a.replay)
        row = {"adapter": adapter, "product_group": pg, "new_windows": len(w["new"]), "replay_windows": len(w["replay"]), "trained_through_before": info.get("trained_through")}
        report.append(row)
        if a.dry_run or not w["all"] or not w["new"]:
            row["action"] = "dry run" if a.dry_run else "nothing new to learn"
            continue
        res = train(adapter, w["all"], a.steps, a.rank, a.lr, models)
        manifest[adapter] = {"trained_through": str(w["through"].date()), "trained_at": int(time.time()), "windows": len(w["all"]), "steps": a.steps, "rank": a.rank, **res}
        models.mkdir(parents=True, exist_ok=True)
        (models / "lora_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
        row["action"] = "trained"
    print(json.dumps({"vault": str(vroot), "models": str(models), "adapters": report}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
