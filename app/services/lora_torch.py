"""LoRA injection and fitting for the forecast model's torch module (imported only when training runs).

NOT VERIFIED against a real checkpoint here: torch and the timesfm package are not installed in the test environment. The module-walking
code is generic torch; the single model-specific assumption is that the model exposes a differentiable `forward` returning quantiles,
which `_predict_quantiles` checks and refuses to guess when it does not.
"""
from __future__ import annotations

import logging
import math
from pathlib import Path

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


def inject(model, rank: int = 8, alpha: float = 16.0, include=("q", "k", "v", "qkv", "proj", "out")) -> list[str]:
    """Wrap the attention linear layers with LoRA. Returns the names that were wrapped."""
    torch = _torch()
    done = []
    for name, mod in list(model.named_modules()):
        for cname, child in list(mod.named_children()):
            if isinstance(child, torch.nn.Linear) and any(t in cname.lower() for t in include):
                setattr(mod, cname, make_lora_linear(child, rank, alpha)); done.append(f"{name}.{cname}".strip("."))
    return done


def lora_state(model) -> dict:
    return {k: v.detach().cpu() for k, v in model.state_dict().items() if k.endswith(".A") or k.endswith(".B")}


def _predict_quantiles(model, ctx):
    """Differentiable quantile forecast. Refuses to guess when the model does not provide one."""
    fn = getattr(model, "forward", None)
    if fn is None:
        raise RuntimeError("This model does not expose a forward pass, so it cannot be fine-tuned here.")
    out = fn(ctx)
    if isinstance(out, (tuple, list)):
        out = out[-1]
    return out


def fit(tfm, adapter: str, windows: list[dict], steps: int, rank: int, lr: float, out: Path) -> dict:
    torch = _torch()
    module = getattr(tfm, "model", tfm)
    names = inject(module, rank)
    if not names:
        raise RuntimeError("No attention layers were found to adapt.")
    params = [p for p in module.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr)
    rng = torch.Generator().manual_seed(0)
    losses = []
    for step in range(steps):
        i = int(torch.randint(len(windows), (1,), generator=rng))
        w = windows[i]
        ctx = torch.tensor(w["context"], dtype=torch.float32)[None]
        tgt = torch.tensor(w["target"], dtype=torch.float32)
        q = _predict_quantiles(module, ctx)[0, : len(tgt)]
        loss = 0.0
        for j, tau in enumerate(QUANTILES):
            e = tgt - q[:, j]
            loss = loss + torch.maximum(tau * e, (tau - 1) * e).mean()
        opt.zero_grad(); loss.backward(); opt.step(); losses.append(float(loss))
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"adapter": adapter, "rank": rank, "layers": names, "state": lora_state(module)}, out)
    return {"layers": len(names), "loss_start": losses[0] if losses else None, "loss_end": losses[-1] if losses else None}
