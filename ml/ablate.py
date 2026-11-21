"""N4's measurements (BOT-NEXT.md): which of the new inputs and the critic make an expert stronger, each on its own.

    ml/.venv/Scripts/python ml/ablate.py --base .cache/learn/league/r2/dragapult-ex.json --deck dragapult-ex \
        --root .cache/learn/n4 --iters 100 -- --epochs 2 --mb 4096 --lr 1e-4 --frozen .cache/learn/league/r2

From the same expert, ppo.py trains equally long: a control (the inputs it had), one run per input group (the
network widened, only that group's inputs on: prizes, revealed, history, sim) and one with the critic that sees
all, and one that imitates proved winning lines (N5, --sure). Each then plays the control with the same deck on both sides (a mirror: both play what they learned),
--games games; a group or the critic is worth keeping at >= 53%. Arguments after "--" go to every ppo.py run;
results are appended to data/learn/ablations.jsonl.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

from common import ROOT, run_gen
from experts import best
from match import paired_ci, wilson

RUNS = {
    "control": [],
    "prizes": ["--widen", "--inputs", "prizes"],
    "revealed": ["--widen", "--inputs", "revealed"],
    "history": ["--widen", "--inputs", "history"],
    "sim": ["--widen", "--inputs", "sim"],
    "critic": ["--critic"],
    # N5: imitate the first move of lines the engine proved win this turn (netbot.ts sureTarget).
    "sure": ["--sure", "0.5"],
}


def main():
    argv = sys.argv[1:]
    extra = argv[argv.index("--") + 1 :] if "--" in argv else []
    argv = argv[: argv.index("--")] if "--" in argv else argv
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--deck", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--iters", type=int, default=100)
    ap.add_argument("--games", type=int, default=3840)
    ap.add_argument("--only", default="", help="these runs only (comma-separated names of RUNS)")
    a = ap.parse_args(argv)
    root = os.path.abspath(a.root)
    names = a.only.split(",") if a.only else list(RUNS)
    for name in names:
        run = os.path.join(root, name)
        state = os.path.join(run, "state.json")
        done = json.load(open(state))["iter"] if os.path.exists(state) else 0
        if done < a.iters:
            cmd = [sys.executable, os.path.join(ROOT, "ml", "ppo.py"), "--init", os.path.abspath(a.base), "--dir", run, "--focus", a.deck,
                   "--iters", str(a.iters - done), *RUNS[name], *extra]
            print(" ".join(cmd), flush=True)
            subprocess.run(cmd, cwd=ROOT, check=True)
    control = os.path.join(root, "control", "current.json")
    from serve import Server

    server = Server().start()
    log = os.path.join(ROOT, "data", "learn", "ablations.jsonl")
    for name in names:
        if name == "control":
            continue
        mine = os.path.join(root, name, "current.json")
        tag = f"ablate-{os.getpid()}"
        cfg = {
            "out": os.path.join(ROOT, ".cache", "learn", tag),
            "games": a.games,
            "base": 87_000_000,
            "threads": 12,
            "players": {"A": {"kind": "net", "weights": mine, "temperature": 0}, "B": {"kind": "net", "weights": control, "temperature": 0}},
            "pairs": [{"a": "A", "b": "B", "share": 1, "decksA": {a.deck: 1}, "decksB": {a.deck: 1}}],
            "server": {"concurrent": 64, "lanes": 1},
        }
        t0 = time.time()
        r = run_gen(cfg, os.path.join(ROOT, ".cache", "learn", f"{tag}.json"), server)
        sc = r["scores"]["A vs B"]
        lo, hi = wilson(sc["score"], sc["n"])
        row = {"run": name, "deck": a.deck, "base": os.path.relpath(os.path.abspath(a.base), ROOT).replace("\\", "/"), "iters": a.iters,
               "score": sc["score"], "n": sc["n"], "se": round(r.get("paired", {}).get("A vs B", {}).get("se", 0), 5),
               "seconds": round(time.time() - t0), "date": time.strftime("%Y-%m-%d %H:%M")}
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        verdict = "keep" if sc["score"] / sc["n"] >= 0.53 else "no gain"
        print(f"{name:<9} vs control: {sc['score'] / sc['n'] * 100:.1f}% (95% CI {lo * 100:.1f}-{hi * 100:.1f}{paired_ci(r)}) -> {verdict}", flush=True)


if __name__ == "__main__":
    main()
