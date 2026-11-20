"""Imitation: teach the network the moves of the bot that recorded the shards, and who went on to win.

    ml/.venv/Scripts/python ml/train_bc.py --data .cache/learn/bc --out .cache/learn/bc.json --epochs 6

Games are split 95/5 by id for validation. Prints policy accuracy (top-1 against the recorded move) and
value loss per epoch, and writes the network as JSON for src/bots/learn/model.ts.
"""
from __future__ import annotations

import argparse
import time

import torch
import torch.nn.functional as F

from common import DEVICE, export, import_json, load, new_net, new_net2


def validate(net, data, idx, bs=8192, bf16=False):
    """Top-1 agreement with the recorded move (all rows, and rows the recorded bot searched) and value loss.
    Rows with the recorded network's logits count agreement with its best option (the move itself was sampled)."""
    net.train(False)
    tot, right, vloss, stot, sright = 0, 0, 0.0, 0, 0
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=bf16):
        for i in range(0, len(idx), bs):
            j = idx[i : i + bs]
            b = data.batch(j)
            logits, value = net(b)
            logits, value = logits.float(), value.float()
            want = torch.where(data.soft[j], b["teacher"].argmax(-1), data.chosen[j]) if "teacher" in b else data.chosen[j]
            hit = logits.argmax(-1) == want
            right += hit.sum().item()
            sright += (hit & data.searched[j]).sum().item()
            stot += data.searched[j].sum().item()
            vloss += F.binary_cross_entropy_with_logits(value, data.outcome[j], reduction="sum").item()
            tot += len(j)
    net.train(True)
    return right / tot, vloss / tot, sright / max(1, stot)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--init", help="start from this network (JSON)")
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--bs", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--value-weight", type=float, default=0.5)
    ap.add_argument("--searched-weight", type=float, default=1.0, help="policy loss weight of decisions the recorded bot searched (Expert Iteration)")
    ap.add_argument("--dims", default="", help="layer sizes for a new network, e.g. H=512,SH=96,OH=192,BAGD=24")
    ap.add_argument("--v2", action="store_true", help="a new version-2 network (card features; ml/common.py Net2)")
    ap.add_argument("--id-drop", type=float, default=0.15, help="v2: share of cards trained without their own vector (as if new)")
    ap.add_argument("--v3", action="store_true", help="a new version-3 network (the transformer of ml/net3.py)")
    ap.add_argument("--bf16", action="store_true", help="bfloat16 autocast (v3: faster, less memory)")
    a = ap.parse_args()

    t0 = time.time()
    data = load(a.data)
    print(f"{data.n} rows ({int(data.searched.sum())} searched), {data.opt_card.shape[0]} options, loaded in {time.time() - t0:.0f}s on {DEVICE}")
    val_games = (data.game * 2654435761 % 100) < 5
    train_idx = torch.nonzero(~val_games).squeeze(1)
    val_idx = torch.nonzero(val_games).squeeze(1)
    dims = {k: int(v) for k, v in (x.split("=") for x in a.dims.split(",") if x)} or None
    if a.init:
        net = import_json(a.init, a.id_drop)
    elif a.v3:
        from net3 import new_net3

        net = new_net3(data.glob.shape[1], data.opt_x.shape[1], dims, a.id_drop)
    else:
        net = new_net2(data, dims, a.id_drop) if a.v2 else new_net(data, dims)
    print(f"{sum(p.numel() for p in net.parameters())} parameters, dims {net.dims}", flush=True)
    opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=1e-4)
    steps = a.epochs * (len(train_idx) // a.bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=max(1, steps), pct_start=0.05)
    if a.init:
        acc, vl, sacc = validate(net, data, val_idx, bs=1024 if getattr(net, "version", 1) == 3 else 8192, bf16=a.bf16)
        print(f"before: validation policy top-1 {acc * 100:.1f}% (searched {sacc * 100:.1f}%), value BCE {vl:.4f}", flush=True)
    best = None
    for ep in range(a.epochs):
        perm = train_idx[torch.randperm(len(train_idx), device=train_idx.device)]
        tl, tn = 0.0, 0
        for i in range(0, len(perm) - a.bs + 1, a.bs):
            j = perm[i : i + a.bs]
            b = data.batch(j)
            with torch.autocast("cuda", dtype=torch.bfloat16, enabled=a.bf16):
                logits, value = net(b)
            logits, value = logits.float(), value.float()
            w = torch.where(data.searched[j], a.searched_weight, 1.0)
            pol = F.cross_entropy(logits, data.chosen[j], reduction="none")
            if "teacher" in b:
                # Soft targets: the recorded network's whole distribution, where it gave one.
                logp = F.log_softmax(logits, -1).masked_fill(~b["mask"], 0)
                soft = -(F.softmax(b["teacher"], -1) * logp).sum(-1)
                pol = torch.where(data.soft[j], soft, pol)
            ce = (pol * w).sum() / w.sum()
            loss = ce + a.value_weight * F.binary_cross_entropy_with_logits(value, data.outcome[j])
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()
            sched.step()
            tl += loss.item() * len(j)
            tn += len(j)
        acc, vl, sacc = validate(net, data, val_idx, bs=1024 if getattr(net, "version", 1) == 3 else 8192, bf16=a.bf16)
        print(f"epoch {ep}: train loss {tl / tn:.4f}, validation: policy top-1 {acc * 100:.1f}% (searched {sacc * 100:.1f}%), value BCE {vl:.4f} ({time.time() - t0:.0f}s)", flush=True)
        if best is None or acc > best:
            best = acc
            export(net, a.out, {"stage": "imitation", "epoch": ep, "top1": round(acc, 4), "valueBce": round(vl, 4), "rows": data.n})
    print(f"best top-1 {best * 100:.1f}% -> {a.out}")


if __name__ == "__main__":
    main()
