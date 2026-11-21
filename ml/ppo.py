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
import re
import shutil
import time

import numpy as np
import torch
import torch.nn.functional as F

from common import BAGS_V3, DEVICE, ROOT, Critic, Data, export, import_json, run_gen, start_gen, widen

import glob as globmod


def gae(data: Data, lam: float, values: torch.Tensor | None = None) -> tuple[torch.Tensor, torch.Tensor]:
    """Advantages and returns per row; each (game, player) is one trajectory in row order. `values`: the baseline
    (default: the value the playing network gave, data.value; --critic: the critic that sees all)."""
    base = data.value if values is None else values
    game = data.game.cpu().numpy()
    player = data.player.cpu().numpy()
    value = base.cpu().numpy().astype(np.float64)
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
    return advt, (advt + base).clamp(0, 1)


# Version 4's inputs by group (src/bots/learn/encode.ts: bags 8-10, globals 83-90, option numbers 30-37). --inputs
# keeps some; the others read as zeros (their weights then stay at zero: the ablations of BOT-NEXT.md N4).
INPUT_GROUPS = {
    "prizes": {"bags": [8], "glob": [83], "opt": []},
    "revealed": {"bags": [9], "glob": [84, 85], "opt": []},
    "history": {"bags": [10], "glob": [86, 87, 88, 89, 90], "opt": []},
    "sim": {"bags": [], "glob": [], "opt": list(range(30, 38))},
}


def inputs_off(keep: str) -> dict[str, list[int]]:
    """Data.off for the groups not in `keep` ("all", "none" or a comma list of INPUT_GROUPS)."""
    on = set(INPUT_GROUPS) if keep == "all" else set() if keep == "none" else set(keep.split(","))
    assert on <= set(INPUT_GROUPS), on - set(INPUT_GROUPS)
    off: dict[str, list[int]] = {"bags": [], "glob": [], "opt": []}
    for g, cols in INPUT_GROUPS.items():
        if g not in on:
            for k in off:
                off[k] += cols[k]
    return off


def pfsp(base: dict[str, float], wr: dict[str, float]) -> dict[str, float]:
    """Opponent deck weights that favour the decks the network still loses to (AlphaStar's prioritised fictitious
    self-play; the weighting of a top Kaggle team: 0.15 + (1 - win rate)^2), times the base weights."""
    w = {d: b * (0.15 + (1 - wr.get(d, 0.5)) ** 2) for d, b in base.items()}
    total = sum(w.values()) or 1.0
    return {d: round(x / total, 4) for d, x in w.items()}


def deck_scores(res: dict, me: str = "net") -> dict[str, tuple[float, int]]:
    """The network's score and games against each opponent deck, over every pairing (gen.ts byDeck)."""
    out: dict[str, list[float]] = {}
    for key, v in res.get("byDeck", {}).items():
        if not key.startswith(me + " "):
            continue
        opp = key.split(" vs ")[-1]
        o = out.setdefault(opp, [0.0, 0])
        o[0] += v["score"]
        o[1] += v["n"]
    return {d: (sc, n) for d, (sc, n) in out.items()}


def critic_values(net, data: Data, a, mb: int = 8192) -> torch.Tensor:
    """The critic's chance to win for every row (the baseline of the advantages with --critic)."""
    out = torch.empty(data.n, device=data.value.device)
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=a.bf16):
        for i in range(0, data.n, mb):
            j = torch.arange(i, min(data.n, i + mb), device=out.device)
            out[j] = torch.sigmoid(net.forward_train(data.batch(j), critic=True)["critic"].float())
    return out


def training_heads(net) -> dict[str, torch.Tensor]:
    """The parameters the weights file leaves out (aux_*, critic): heads.pt keeps them across a resume."""
    return {k: v for k, v in net.state_dict().items() if k.startswith(("aux_", "critic."))}


def deck_files() -> dict[str, dict]:
    """Every deck file's slug -> frontmatter fields this script reads (metaShare, limitless)."""
    out = {}
    folder = os.path.join(ROOT, "src", "content", "decks")
    for f in sorted(os.listdir(folder)):
        if not f.endswith(".md"):
            continue
        text = open(os.path.join(folder, f), encoding="utf-8").read().split("---")[1]
        out[os.path.splitext(f)[0]] = dict(re.findall(r"^(\w+):\s*(.+?)\s*$", text, re.M))
    return out


def parse_decks(text: str) -> dict[str, float]:
    """"slug=weight,slug" -> {slug: weight} (weight 1 when left out)."""
    return {k: float(v) if v else 1.0 for k, _, v in (x.partition("=") for x in text.split(",") if x)}


def opponent_decks(extra_text: str, meta_part: float) -> dict[str, float]:
    """Opponent deck weights for a specialist: `extra` as given (e.g. player=0.1), `meta_part` by the decks' real
    meta share (decks of one archetype split it), the rest spread evenly over every deck."""
    decks = deck_files()
    extra = parse_decks(extra_text)
    share = {d: float(m["metaShare"]) for d, m in decks.items() if "metaShare" in m}
    same = {d: sum(1 for e in share if decks[e].get("limitless") == decks[d].get("limitless")) for d in share}
    share = {d: s / same[d] for d, s in share.items()}
    total = sum(share.values()) or 1.0
    even = (1 - meta_part - sum(extra.values())) / len(decks)
    return {d: round(even + meta_part * share.get(d, 0) / total + extra.get(d, 0), 4) for d in decks}


def card_counts(data: Data) -> torch.Tensor:
    """How many card tokens each row has (version 3: cards with a count in the first 8 bags), counted in slices."""
    out = torch.empty(data.n, dtype=torch.long, device=data.bags.device)
    step = 65536
    for i in range(0, data.n, step):
        has = data.bags[i : i + step, :BAGS_V3].sum(1) > 0
        has[:, 0] = False
        out[i : i + step] = has.sum(1)
    return out


def minibatches(data: Data, mb: int, cards: torch.Tensor | None) -> list[torch.Tensor]:
    """One epoch's minibatches (row indices). Random, or with `cards` (--bucket) rows of a similar size (option-count
    class, then card count) together, the minibatches in random order: a batch then pads to little more than its
    rows need (version 3 spent over half of its tokens on padding, BOT-NEXT.md)."""
    n = data.n
    dev = data.opt_count.device
    if cards is None:
        perm = torch.randperm(n, device=dev)
        return [perm[i : i + mb] for i in range(0, n - mb // 2, mb)]
    cls = torch.bucketize(data.opt_count, torch.tensor([4, 8, 16, 32], device=dev))
    order = torch.argsort(cls.float() * 1000 + cards.float() + torch.rand(n, device=dev))
    chunks = [order[i : i + mb] for i in range(0, n - mb // 2, mb)]
    return [chunks[k] for k in torch.randperm(len(chunks)).tolist()]


def ppo_update(net, anchor, data: Data, adv, ret, opt, a, kl_coef: float):
    stats = {"pg": 0.0, "v": 0.0, "ent": 0.0, "kl": 0.0, "clip": 0.0, "aux": 0.0, "steps": 0}
    cards = card_counts(data) if a.bucket else None
    # Minibatches of similar rows would each normalise their advantages within one kind of decision: normalise
    # once over all rows instead.
    adv_all = (adv - adv.mean()) / (adv.std() + 1e-8) if a.bucket else None
    for _ in range(a.epochs):
        for j in minibatches(data, a.mb, cards):
            b = data.batch(j)
            if cards is not None:
                b["C"] = int(cards[j].max())
            with torch.autocast("cuda", dtype=torch.bfloat16, enabled=a.bf16):
                out = net.forward_train(b, critic=a.critic)
            logits, value, aux = out["logits"].float(), out["value"].float(), out.get("aux")
            logp_all = F.log_softmax(logits, -1)
            logp = logp_all.gather(1, data.chosen[j][:, None]).squeeze(1)
            ratio = torch.exp(logp - data.logp[j])
            if adv_all is not None:
                A = adv_all[j]
            else:
                A = adv[j]
                A = (A - A.mean()) / (A.std() + 1e-8)
            pg = -torch.min(ratio * A, ratio.clamp(1 - a.clip, 1 + a.clip) * A).mean()
            vloss = F.binary_cross_entropy_with_logits(value, ret[j])
            if a.critic:
                # The critic learns the same returns; the shipped value head keeps learning them too.
                vloss = vloss + F.binary_cross_entropy_with_logits(out["critic"].float(), ret[j])
            p = logp_all.exp() * b["mask"]
            ent = -(p * logp_all.masked_fill(~b["mask"], 0)).sum(-1).mean()
            loss = pg + a.vcoef * vloss - a.ent * ent
            al = torch.zeros((), device=adv.device)
            if aux is not None:
                from net3 import aux_loss

                al = aux_loss(aux, b)
                loss = loss + a.aux_weight * al
            kl = torch.zeros((), device=adv.device)
            if anchor is not None and kl_coef > 0:
                with torch.no_grad(), torch.autocast("cuda", dtype=torch.bfloat16, enabled=a.bf16):
                    lb, _ = anchor(b)
                lpb = F.log_softmax(lb.float(), -1)
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
            stats["aux"] += al.item()
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
    ap.add_argument("--frozen", help="a fixed network to play as 'frozen' in --mix (best move, no sampling): train an exploiter against it")
    ap.add_argument("--eval-vs", default="hard", choices=["hard", "frozen", "bot"], help="who the greedy network is measured against (bot = the game's bot now)")
    ap.add_argument("--variants", type=float, default=0.0, help="share of sides that play a real list (.cache/meta/variants.json, scripts/meta/variants.ts)")
    ap.add_argument("--starts", help="games people played against the bot (the review page's games file): some games start from their positions")
    ap.add_argument("--starts-share", type=float, default=0.1, help="share of the games that start from --starts positions")
    ap.add_argument("--focus", help="the network always plays this deck (a specialist), e.g. dragapult-ex")
    ap.add_argument("--vs-weights", default="", help="with --focus: extra weight on some opponent decks, e.g. player=0.4 (the rest spread evenly)")
    ap.add_argument("--vs-meta", type=float, default=0.0, help="with --focus: this share of the opponent decks follows the real meta share (deck frontmatter metaShare)")
    ap.add_argument("--variants-a", type=float, default=None, help="with fixed decks: share of the network's own sides that play a real list (default: --variants)")
    ap.add_argument("--decks-a", default="", help="decks the network plays, slug=weight,... (an exploiter: every deck); overrides --focus's")
    ap.add_argument("--decks-b", default="", help="decks its opponents play, slug=weight,... (an exploiter: the expert's deck); overrides --focus's")
    ap.add_argument("--eval-every", type=int, default=10)
    ap.add_argument("--eval-games", type=int, default=480)
    ap.add_argument("--no-server", dest="server", action="store_false", help="compute the networks' moves in the gen.ts workers (no GPU server)")
    ap.add_argument("--concurrent", type=int, default=128, help="games in flight per worker (batched, BOT-LEAP.md L1)")
    ap.add_argument("--resign", type=float, default=0.0, help="a side whose value is below this at the start of --resign-turns own turns in a row resigns (0 = never)")
    ap.add_argument("--resign-turns", type=int, default=2)
    ap.add_argument("--keep-playing", type=float, default=0.1, help="share of games where nobody resigns (checks how often resigning was wrong)")
    ap.add_argument("--bf16", action="store_true", help="bfloat16 autocast in the update (version 3: faster, less memory)")
    ap.add_argument("--aux-weight", type=float, default=0.25, help="version 3: weight of the training-only targets (opponent's hand, Prize difference)")
    ap.add_argument("--overlap", action="store_true", help="play the next iteration's games while this one trains (games one iteration behind)")
    ap.add_argument("--bucket", action="store_true", help="minibatches of similar-sized rows, padding cut (version 3 ~1.9x faster), advantages normalised over all rows")
    ap.add_argument("--critic", action="store_true", help="advantages from a critic that also sees the hidden cards (training only, BOT-NEXT.md N4)")
    ap.add_argument("--widen", action="store_true", help="a new run's network reads every input of the encoder now (new weights at zero: the same moves at first)")
    ap.add_argument("--inputs", default="all", help="version 4 inputs it may use: all, none, or some of prizes,revealed,history,sim (the rest read as zeros)")
    ap.add_argument("--pfsp", action="store_true", help="with fixed decks: opponent decks it loses to come up more often (weights 0.15 + (1 - win rate)^2, BOT-NEXT.md N3)")
    ap.add_argument("--serve-keep", type=int, default=12, help="networks the inference server keeps loaded at once (an expert set as opponents is one per deck)")
    ap.add_argument("--offmeta", type=float, default=0.0, help="share of games whose opponent plays an off-meta list (.cache/meta/offmeta.json train, scripts/meta/variants.ts; BOT-NEXT.md N6)")
    ap.add_argument("--patience", type=int, default=0, help="stop when the evaluation has not beaten its best for this many iterations (0 = run --iters); the best is state.json best, its weights eval-<iter>.json")
    a = ap.parse_args()
    # gen.ts runs from the repo root, so every path it gets is absolute.
    a.dir = os.path.abspath(a.dir)
    a.init = os.path.abspath(a.init)
    if a.frozen:
        a.frozen = os.path.abspath(a.frozen)

    os.makedirs(a.dir, exist_ok=True)
    state_path = os.path.join(a.dir, "state.json")
    state = json.load(open(state_path)) if os.path.exists(state_path) else {"iter": 0}
    cur_path = os.path.join(a.dir, "current.json")
    if state["iter"] == 0 or not os.path.exists(cur_path):
        if a.widen:
            export(widen(import_json(a.init, id_drop=0.0)), cur_path, {"stage": "widened", "from": os.path.basename(a.init)})
        else:
            shutil.copy(a.init, cur_path)
        shutil.copy(cur_path, os.path.join(a.dir, "league-0.json"))
    # No card-vector dropout here: the update compares against the move probabilities the games were played with.
    net = import_json(cur_path, id_drop=0.0)
    heads_path = os.path.join(a.dir, "heads.pt")
    if a.critic:
        net.critic = Critic(*net.critic_size()).to(DEVICE)
    if os.path.exists(heads_path) and state["iter"] > 0:
        net.load_state_dict(torch.load(heads_path, map_location=DEVICE), strict=False)
    anchor = import_json(a.init, id_drop=0.0)
    anchor.train(False)
    for p in anchor.parameters():
        p.requires_grad_(False)
    opt = torch.optim.Adam(net.parameters(), lr=a.lr)
    opt_path = os.path.join(a.dir, "opt.pt")
    saved = torch.load(opt_path, map_location=DEVICE) if os.path.exists(opt_path) and state["iter"] > 0 else None
    # Cards added since (v2: more id rows) change parameter shapes: the saved moments no longer fit, start them again.
    if saved and all(st["exp_avg"].shape == p.shape for p, st in zip(net.parameters(), saved["state"].values()) if "exp_avg" in st):
        opt.load_state_dict(saved)
        # The saved state carries the old learning rate; --lr wins when resuming.
        for g in opt.param_groups:
            g["lr"] = a.lr
    mix = {k: float(v) for k, v in (x.split(":") for x in a.mix.split(","))}
    focus = {}
    if a.focus:
        focus = {"decksA": {a.focus: 1}, "decksB": opponent_decks(a.vs_weights, a.vs_meta)}
    if a.decks_a:
        focus["decksA"] = parse_decks(a.decks_a)
    if a.decks_b:
        focus["decksB"] = parse_decks(a.decks_b)
    if focus:
        print(f"decks: the network plays {focus.get('decksA', 'all')} against {focus.get('decksB', 'all')}", flush=True)
    eval_decks = {k: v for k, v in (("decksA", focus.get("decksA")), ("decksB", parse_decks(a.decks_b) if a.decks_b else None)) if v}
    log = open(os.path.join(a.dir, "log.jsonl"), "a")
    server = None
    if a.server:
        from serve import Server

        server = Server(keep=a.serve_keep).start()
    batched = {"concurrent": a.concurrent, "lanes": 1}
    # --pfsp: each opponent deck's running win rate (state.json keeps it), and the weights it started from.
    base_b = dict(focus.get("decksB", {}))
    if a.pfsp:
        assert base_b, "--pfsp needs fixed opponent decks (--focus or --decks-b)"
        focus["decksB"] = pfsp(base_b, state.get("wr", {}))
    resign = {"below": a.resign, "turns": a.resign_turns, "keepPlaying": a.keep_playing} if a.resign > 0 else None

    def gen_config(it: int, out: str, weights: str) -> dict:
        league = sorted(globmod.glob(os.path.join(a.dir, "league-*.json")))
        players = {
            "net": {"kind": "net", "weights": weights, "temperature": 1, "record": True},
            # With fixed decks, self-play's other side is the same network unrecorded: only the network's own decks train it.
            "selfopp": {"kind": "net", "weights": weights, "temperature": 1},
            "old": {"kind": "net", "weights": random.choice(league), "temperature": 1},
            "normal": {"kind": "normal"},
            "hard": {"kind": "hard"},
            "random": {"kind": "random"},
            "bot": {"kind": "bot", "fast": True},
        }
        if a.frozen:
            players["frozen"] = {"kind": "net", "weights": a.frozen, "temperature": 0}
        own = "selfopp" if focus else "net"
        pairs = [{"a": "net", "b": own if k == "self" else k, "share": v, **focus} for k, v in mix.items() if v > 0]
        variants = {}
        if a.variants > 0 or (a.variants_a or 0) > 0:
            variants = {"variants": {"path": os.path.join(ROOT, ".cache", "meta", "variants.json"), "share": a.variants}}
            if a.variants_a is not None:
                variants["variants"]["shareA"] = a.variants_a
        if a.starts:
            variants["starts"] = {"path": os.path.abspath(a.starts), "share": a.starts_share}
        if a.offmeta > 0:
            variants["offmeta"] = {"path": os.path.join(ROOT, ".cache", "meta", "offmeta.json"), "share": a.offmeta}
        cfg = {"out": out, "games": a.games, "base": 10_000_000 + it * 100_000, "threads": a.threads, "players": players, "pairs": pairs, **variants}
        if server:
            cfg["server"] = {**batched, **({"resign": resign} if resign else {})}
        return cfg

    def start(it: int):
        """Start the games of iteration `it`, played by a copy of the current weights (the training goes on writing
        current.json; with --overlap these games are played while the iteration before trains)."""
        out = os.path.join(a.dir, f"games-{it % 2}")
        shutil.rmtree(out, ignore_errors=True)
        weights = os.path.join(a.dir, f"behavior-{it % 2}.json")
        shutil.copy(cur_path, weights)
        return out, start_gen(gen_config(it, out, weights), os.path.join(a.dir, f"gen-{it % 2}.json"), server)

    pending = None
    data = None
    for n_iter in range(a.iters):
        it = state["iter"]
        t0 = time.time()
        out, gen = pending or start(it)
        res = gen.wait()
        t1 = time.time()
        # The last iteration's rows go before these load (both at once would need twice the GPU memory).
        data = adv = ret = None
        data = Data(sorted(globmod.glob(os.path.join(out, "*.bin"))))
        data.off = inputs_off(a.inputs)
        # The next iteration's games, played meanwhile by the weights before this update (one iteration behind;
        # PPO's ratio to the recorded move probabilities corrects for it).
        pending = start(it + 1) if a.overlap and n_iter < a.iters - 1 else None
        adv, ret = gae(data, a.lam, critic_values(net, data, a) if a.critic else None)
        kl_coef = a.kl * max(0.0, 1 - it / max(1, a.kl_iters))
        stats = ppo_update(net, anchor, data, adv, ret, opt, a, kl_coef)
        it += 1
        export(net, cur_path, {"stage": "ppo", "iter": it})
        torch.save(opt.state_dict(), opt_path)
        heads = training_heads(net)
        if heads:
            torch.save(heads, heads_path)
        if it % 10 == 0:
            shutil.copy(cur_path, os.path.join(a.dir, f"league-{it}.json"))
        row = {
            "iter": it,
            "rows": data.n,
            "games": res["games"],
            "scores": {k: round(v["score"] / v["n"], 3) for k, v in res["scores"].items() if k.startswith("net vs")},
            **stats,
            "gen_s": round(t1 - t0),  # with --overlap: the wait for the games still running
            "train_s": round(time.time() - t1),
            **({"resign": res["resign"]} if "resign" in res else {}),
        }
        if a.pfsp:
            wr = state.setdefault("wr", {})
            for d, (sc, n) in deck_scores(res).items():
                if d in base_b and n:
                    wr[d] = round(0.8 * wr.get(d, sc / n) + 0.2 * sc / n, 4)
            focus["decksB"] = pfsp(base_b, wr)
            row["pfsp"] = focus["decksB"]
        if it % a.eval_every == 0:
            # A copy plays (the server keeps reading the files it serves; current.json is rewritten every iteration).
            eval_path = os.path.join(a.dir, f"eval-{it}.json")
            shutil.copy(cur_path, eval_path)
            ecfg = {
                "out": os.path.join(a.dir, "eval"),
                "games": a.eval_games,
                "base": 90_000_000,
                "threads": a.threads,
                "players": {
                    "net": {"kind": "net", "weights": eval_path, "temperature": 0},
                    "hard": {"kind": "hard"},
                    "bot": {"kind": "bot", "fast": True},
                    **({"frozen": {"kind": "net", "weights": a.frozen, "temperature": 0}} if a.frozen else {}),
                },
                # The network's own decks, against every deck evenly (or the --decks-b ones): the field the gates use.
                "pairs": [{"a": "net", "b": a.eval_vs, "share": 1, **eval_decks}],
                **({"server": batched} if server else {}),
            }
            er = run_gen(ecfg, os.path.join(a.dir, "eval.json"), server)
            sc = er["scores"][f"net vs {a.eval_vs}"]
            row[f"eval_vs_{a.eval_vs}"] = round(sc["score"] / sc["n"], 4)
            row["eval_n"] = sc["n"]
            pe = er.get("paired", {}).get(f"net vs {a.eval_vs}")
            if pe:
                row["eval_se"] = round(pe["se"], 4)
            if row[f"eval_vs_{a.eval_vs}"] > state.get("best", (-1, 0))[0]:
                state["best"] = (row[f"eval_vs_{a.eval_vs}"], it)
        state["iter"] = it
        json.dump(state, open(state_path, "w"))
        log.write(json.dumps(row) + "\n")
        log.flush()
        print(json.dumps(row), flush=True)
        # --patience: stop once the evaluation has not beaten its best for that many iterations.
        if a.patience and "best" in state and it - state["best"][1] >= a.patience:
            print(f"no better evaluation for {a.patience} iterations (best {state['best'][0]} at {state['best'][1]}): stopping", flush=True)
            state["stopped"] = True
            json.dump(state, open(state_path, "w"))
            if pending:
                try:
                    pending[1].wait()  # the games already started (--overlap) finish before the server goes
                except RuntimeError:
                    pass
            break


if __name__ == "__main__":
    main()
