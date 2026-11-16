"""Self-play reinforcement learning (PPO + GAE) for the network bot, starting from the imitation network.

    ml/.venv/Scripts/python ml/ppo.py --init .cache/learn/bc.json --dir .cache/learn/ppo --iters 300

Each iteration: scripts/learn/gen.ts plays `--games` games with the current network sampling its moves
(temperature 1) against itself, earlier versions (league), the normal bot and the hard bot, on every deck
pair; only the network's own decisions are recorded. Rewards: 1 for a win, 0 for a loss, at the end.
The policy is updated with clipped PPO, the value head toward GAE returns, and early on a KL term keeps
the policy near the imitation network. Every `--eval-every` iterations the greedy network plays the hard
bot on fixed seeds; results go to <dir>/log.jsonl. Resumes from <dir>/state.json.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import time

import numpy as np
import torch
import torch.nn.functional as F

from common import DEVICE, Data, export, import_json, run_gen

import glob as globmod


def gae(data: Data, lam: float) -> tuple[torch.Tensor, torch.Tensor]:
    """Advantages and returns per row; each (game, player) is one trajectory in row order."""
    game = data.game.cpu().numpy()
    player = data.player.cpu().numpy()
    value = data.value.cpu().numpy().astype(np.float64)
    outcome = data.outcome.cpu().numpy().astype(np.float64)
    key = game * 2 + player
    order = np.argsort(key, kind="stable")
    adv = np.zeros(len(order))
    k = key[order]
    v = value[order]
    o = outcome[order]
    last = np.ones(len(order), dtype=bool)
    last[:-1] = k[1:] != k[:-1]
    a = 0.0
    for i in range(len(order) - 1, -1, -1):
        if last[i]:
            delta = o[i] - v[i]
            a = delta
        else:
            delta = v[i + 1] - v[i]
            a = delta + lam * a
        adv[i] = a
    out = np.zeros(len(order))
    out[order] = adv
    advt = torch.from_numpy(out).float().to(data.value.device)
    return advt, (advt + data.value).clamp(0, 1)


def ppo_update(net, anchor, data: Data, adv, ret, opt, a, kl_coef: float):
    n = data.n
    stats = {"pg": 0.0, "v": 0.0, "ent": 0.0, "kl": 0.0, "clip": 0.0, "steps": 0}
    for _ in range(a.epochs):
        perm = torch.randperm(n, device=adv.device)
        for i in range(0, n - a.mb // 2, a.mb):
            j = perm[i : i + a.mb]
            b = data.batch(j)
            logits, value = net(b)
            logp_all = F.log_softmax(logits, -1)
            logp = logp_all.gather(1, data.chosen[j][:, None]).squeeze(1)
            ratio = torch.exp(logp - data.logp[j])
            A = adv[j]
            A = (A - A.mean()) / (A.std() + 1e-8)
            pg = -torch.min(ratio * A, ratio.clamp(1 - a.clip, 1 + a.clip) * A).mean()
            vloss = F.binary_cross_entropy_with_logits(value, ret[j])
            p = logp_all.exp() * b["mask"]
            ent = -(p * logp_all.masked_fill(~b["mask"], 0)).sum(-1).mean()
            loss = pg + a.vcoef * vloss - a.ent * ent
            kl = torch.zeros((), device=adv.device)
            if anchor is not None and kl_coef > 0:
                with torch.no_grad():
                    lb, _ = anchor(b)
                    lpb = F.log_softmax(lb, -1)
                kl = (p * (logp_all - lpb).masked_fill(~b["mask"], 0)).sum(-1).mean()
                loss = loss + kl_coef * kl
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 0.5)
            opt.step()
            stats["pg"] += pg.item()
            stats["v"] += vloss.item()
            stats["ent"] += ent.item()
            stats["kl"] += kl.item()
            stats["clip"] += ((ratio - 1).abs() > a.clip).float().mean().item()
            stats["steps"] += 1
    s = stats.pop("steps")
    return {k: round(v / max(1, s), 4) for k, v in stats.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--init", required=True, help="imitation network (JSON)")
    ap.add_argument("--dir", default=".cache/learn/ppo")
    ap.add_argument("--iters", type=int, default=300)
    ap.add_argument("--games", type=int, default=960)
    ap.add_argument("--threads", type=int, default=15)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--mb", type=int, default=4096)
    ap.add_argument("--clip", type=float, default=0.2)
    ap.add_argument("--vcoef", type=float, default=0.5)
    ap.add_argument("--ent", type=float, default=0.003)
    ap.add_argument("--lam", type=float, default=0.95)
    ap.add_argument("--kl", type=float, default=0.05, help="KL to the imitation network at the start (decays to 0)")
    ap.add_argument("--kl-iters", type=int, default=60)
    ap.add_argument("--mix", default="self:0.5,old:0.15,normal:0.1,hard:0.25")
    ap.add_argument("--eval-every", type=int, default=10)
    ap.add_argument("--eval-games", type=int, default=480)
    a = ap.parse_args()
    # gen.ts runs from the repo root, so every path it gets is absolute.
    a.dir = os.path.abspath(a.dir)
    a.init = os.path.abspath(a.init)

    os.makedirs(a.dir, exist_ok=True)
    state_path = os.path.join(a.dir, "state.json")
    state = json.load(open(state_path)) if os.path.exists(state_path) else {"iter": 0}
    cur_path = os.path.join(a.dir, "current.json")
    if state["iter"] == 0 or not os.path.exists(cur_path):
        shutil.copy(a.init, cur_path)
        shutil.copy(a.init, os.path.join(a.dir, "league-0.json"))
    net = import_json(cur_path)
    anchor = import_json(a.init)
    anchor.train(False)
    for p in anchor.parameters():
        p.requires_grad_(False)
    opt = torch.optim.Adam(net.parameters(), lr=a.lr)
    opt_path = os.path.join(a.dir, "opt.pt")
    if os.path.exists(opt_path) and state["iter"] > 0:
        opt.load_state_dict(torch.load(opt_path, map_location=DEVICE))
    mix = {k: float(v) for k, v in (x.split(":") for x in a.mix.split(","))}
    log = open(os.path.join(a.dir, "log.jsonl"), "a")

    for _ in range(a.iters):
        it = state["iter"]
        t0 = time.time()
        league = sorted(globmod.glob(os.path.join(a.dir, "league-*.json")))
        players = {
            "net": {"kind": "net", "weights": cur_path, "temperature": 1, "record": True},
            "old": {"kind": "net", "weights": random.choice(league), "temperature": 1},
            "normal": {"kind": "normal"},
            "hard": {"kind": "hard"},
        }
        pairs = [{"a": "net", "b": "net" if k == "self" else k, "share": v} for k, v in mix.items() if v > 0]
        out = os.path.join(a.dir, "games")
        shutil.rmtree(out, ignore_errors=True)
        cfg = {"out": out, "games": a.games, "base": 10_000_000 + it * 100_000, "threads": a.threads, "players": players, "pairs": pairs}
        res = run_gen(cfg, os.path.join(a.dir, "gen.json"))
        t1 = time.time()
        data = Data(sorted(globmod.glob(os.path.join(out, "*.bin"))))
        adv, ret = gae(data, a.lam)
        kl_coef = a.kl * max(0.0, 1 - it / max(1, a.kl_iters))
        stats = ppo_update(net, anchor, data, adv, ret, opt, a, kl_coef)
        it += 1
        export(net, cur_path, {"stage": "ppo", "iter": it})
        torch.save(opt.state_dict(), opt_path)
        if it % 10 == 0:
            shutil.copy(cur_path, os.path.join(a.dir, f"league-{it}.json"))
        row = {
            "iter": it,
            "rows": data.n,
            "games": res["games"],
            "scores": {k: round(v["score"] / v["n"], 3) for k, v in res["scores"].items() if k.startswith("net vs")},
            **stats,
            "gen_s": round(t1 - t0),
            "train_s": round(time.time() - t1),
        }
        if it % a.eval_every == 0:
            ecfg = {
                "out": os.path.join(a.dir, "eval"),
                "games": a.eval_games,
                "base": 90_000_000,
                "threads": a.threads,
                "players": {"net": {"kind": "net", "weights": cur_path, "temperature": 0}, "hard": {"kind": "hard"}},
                "pairs": [{"a": "net", "b": "hard", "share": 1}],
            }
            er = run_gen(ecfg, os.path.join(a.dir, "eval.json"))
            sc = er["scores"]["net vs hard"]
            row["eval_vs_hard"] = round(sc["score"] / sc["n"], 4)
            row["eval_n"] = sc["n"]
            shutil.copy(cur_path, os.path.join(a.dir, f"eval-{it}.json"))
        state["iter"] = it
        json.dump(state, open(state_path, "w"))
        log.write(json.dumps(row) + "\n")
        log.flush()
        print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
