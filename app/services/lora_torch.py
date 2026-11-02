"""LoRA injection and fitting for the forecast model's torch module (imported only when training runs).

Written against the real timesfm 2.x torch module (TimesFM_2p5_200M_torch_module): attention layers are `attn.qkv_proj` and `attn.out`,
and `forward(patched_inputs, patched_masks, None)` is differentiable (the library's own `decode` is wrapped in no_grad, so training
rebuilds its pre-fill step). Tested with the real architecture and random weights; it has not been run on the released checkpoint,
which could not be downloaded where this was developed.
"""
from __future__ import annotations

import logging
import math
from pathlib import Path

import numpy as np

log = logging.getLogger("lora")
QUANTILES = (0.1, 0.5, 0.9)


def _torch():
    import torch
    return torch


def make_lora_linear(base, rank: int, alpha: float):
    torch = _torch()

    class LoRALinear(torch.nn.Module):
        def __init__(self, base, rank, alpha):
            super().__init__()
            self.base, self.scale = base, alpha / rank
            self.A = torch.nn.Parameter(torch.zeros(rank, base.in_features))
            self.B = torch.nn.Parameter(torch.zeros(base.out_features, rank))
            torch.nn.init.kaiming_uniform_(self.A, a=math.sqrt(5))
            for p in self.base.parameters():
                p.requires_grad_(False)

        def forward(self, x):
            return self.base(x) + (x @ self.A.t() @ self.B.t()) * self.scale
    return LoRALinear(base, rank, alpha)


def inject(model, rank: int = 8, alpha: float = 16.0, include=("qkv_proj", "out")) -> list[str]:
    """Wrap the attention projections (and nothing else) with LoRA. Returns the names that were wrapped."""
    torch = _torch()
    for prm in model.parameters():          # freeze the whole base model first: only the new A and B matrices may train
        prm.requires_grad_(False)
    done = []
    for name, mod in list(model.named_modules()):
        if type(mod).__name__ != "MultiHeadAttention":
            continue
        for cname in include:
            child = getattr(mod, cname, None)
            if isinstance(child, torch.nn.Linear):
                setattr(mod, cname, make_lora_linear(child, rank, alpha)); done.append(f"{name}.{cname}")
    return done


def remove(model) -> int:
    """Take the LoRA wrappers off again so the shared base model is exactly as it was (train the next adapter from the same base)."""
    torch = _torch()
    n = 0
    for mod in model.modules():
        for cname, child in list(mod.named_children()):
            if hasattr(child, "A") and hasattr(child, "B") and hasattr(child, "base"):
                setattr(mod, cname, child.base); n += 1
    for prm in model.parameters():
        prm.requires_grad_(True)
    return n


def lora_state(model) -> dict:
    return {k: v.detach().cpu() for k, v in model.state_dict().items() if k.endswith(".A") or k.endswith(".B")}


def load_lora_state(model, state: dict) -> int:
    """Put saved A and B matrices back into a model that has been through inject(). Returns how many tensors matched."""
    own = model.state_dict(); n = 0
    for k, v in state.items():
        if k in own and own[k].shape == v.shape:
            own[k].copy_(v); n += 1
    return n


def _predict_quantiles(module, ctx):
    """Differentiable next-128 forecast [B, 128, 10] (point, then q0.1 to q0.9) for contexts [B, L], mirroring the library's pre-fill step."""
    torch = _torch()
    from timesfm.torch import util
    p = module.p
    B, L = ctx.shape
    ctx = ctx[:, L - (L // p) * p:]                      # whole patches only
    patched = ctx.reshape(B, -1, p)
    masks = torch.zeros_like(patched, dtype=torch.bool)
    n = torch.zeros(B); mu = torch.zeros(B); sigma = torch.zeros(B); mus, sigmas = [], []
    for i in range(patched.shape[1]):
        (n, mu, sigma), _ = util.update_running_stats(n, mu, sigma, patched[:, i], masks[:, i])
        mus.append(mu); sigmas.append(sigma)
    cmu, csig = torch.stack(mus, 1), torch.stack(sigmas, 1)
    normed = torch.where(masks, 0.0, util.revin(patched, cmu, csig, reverse=False))
    (_, _, out_ts, _), _ = module(normed, masks, None)
    out = util.revin(out_ts, cmu, csig, reverse=True).reshape(B, -1, module.o, module.q)
    return out[:, -1]


def _fit(tfm, adapter: str, windows: list[dict], steps: int, rank: int, lr: float, out: Path, batch: int = 4) -> dict:
    torch = _torch()
    module = getattr(tfm, "model", tfm)
    base_before = {k: v.detach().clone() for k, v in list(module.state_dict().items())[:6]}
    names = inject(module, rank)
    if not names:
        raise RuntimeError("No attention layers were found to adapt.")
    module.train()
    params = [p for p in module.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr)
    gen = torch.Generator().manual_seed(0)
    losses = []
    for _ in range(steps):
        idx = torch.randint(len(windows), (batch,), generator=gen).tolist()
        h = min(module.o, min(len(windows[i]["target"]) for i in idx))
        L = min(len(windows[i]["context"]) for i in idx)
        ctx = torch.tensor(np.array([windows[i]["context"][-L:] for i in idx]), dtype=torch.float32)
        tgt = torch.tensor(np.array([windows[i]["target"][:h] for i in idx]), dtype=torch.float32)
        q = _predict_quantiles(module, ctx)[:, :h]
        scale = ctx.abs().mean(dim=1, keepdim=True).clamp_min(1e-6)      # scale-free loss, so big-spend series do not drown small ones
        q, tgt = q / scale[:, :, None], tgt / scale
        loss = 0.0
        for col, tau in zip((1, 5, 9), QUANTILES):
            e = tgt - q[:, :, col]
            loss = loss + torch.maximum(tau * e, (tau - 1) * e).mean()
        opt.zero_grad(); loss.backward(); opt.step(); losses.append(float(loss.detach()))
    module.eval()
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"adapter": adapter, "rank": rank, "layers": names, "state": lora_state(module)}, out)
    remove(module)
    changed = any(not torch.equal(v, module.state_dict()[k]) for k, v in base_before.items() if k in module.state_dict())
    return {"layers": len(names), "loss_start": losses[0] if losses else None, "loss_end": losses[-1] if losses else None, "base_weights_changed": bool(changed)}


def fit(tfm, adapter: str, windows: list[dict], steps: int, rank: int, lr: float, out: Path, batch: int = 4) -> dict:
    """Train one adapter on the shared base model and always hand the base model back unwrapped, even if training fails."""
    module = getattr(tfm, "model", tfm)
    try:
        return _fit(tfm, adapter, windows, steps, rank, lr, out, batch)
    finally:
        remove(module)
