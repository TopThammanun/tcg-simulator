"""The experts' league (BOT-NEXT.md N3): every deck's expert trains against the previous round's experts, so each
deck across the table is piloted by its own expert rather than by the generalist.

    ml/.venv/Scripts/python ml/league.py --start .cache/learn/experts-n1 --root .cache/learn/league --rounds 2 \
        --iters 120 -- --epochs 2 --mb 4096 --lr 1e-4

Round r: for each deck, ppo.py continues that deck's expert from round r-1 (--focus deck) with the round r-1 expert
set as the frozen opponent (60%), its own earlier versions (20%), itself (15%) and the game's network (5%),
opponent decks by PFSP; then round r's set is put together from each run's best evaluated checkpoint
(<root>/r<r>/). Arguments after "--" go to every ppo.py run. Resumes: a deck whose run reached --iters (or
stopped on --patience) is not run again.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

from common import ROOT
from experts import best


def main():
    argv = sys.argv[1:]
    extra = argv[argv.index("--") + 1 :] if "--" in argv else []
    argv = argv[: argv.index("--")] if "--" in argv else argv
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True, help="round 0: an expert set (folder of <deck>.json + default.json)")
    ap.add_argument("--root", required=True)
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--iters", type=int, default=120)
    ap.add_argument("--decks", default="", help="these decks only (default: every expert in --start)")
    ap.add_argument("--mix", default="frozen:0.6,old:0.2,self:0.15,bot:0.05")
    a = ap.parse_args(argv)
    start = os.path.abspath(a.start)
    root = os.path.abspath(a.root)
    decks = a.decks.split(",") if a.decks else sorted(os.path.splitext(f)[0] for f in os.listdir(start) if f.endswith(".json") and f != "default.json")
    prev = start
    for r in range(1, a.rounds + 1):
        here = os.path.join(root, f"r{r}")
        os.makedirs(here, exist_ok=True)
        for d in decks:
            run = os.path.join(root, f"r{r}-{d}")
            state = os.path.join(run, "state.json")
            done = json.load(open(state)) if os.path.exists(state) else {"iter": 0}
            if done["iter"] < a.iters and not done.get("stopped"):
                cmd = [sys.executable, os.path.join(ROOT, "ml", "ppo.py"), "--init", os.path.join(prev, f"{d}.json"), "--dir", run,
                       "--focus", d, "--iters", str(a.iters - done["iter"]), "--mix", a.mix, "--frozen", prev, "--pfsp",
                       "--eval-vs", "frozen", *extra]
                print(" ".join(cmd), flush=True)
                subprocess.run(cmd, cwd=ROOT, check=True)
            path, score, it = best(run)
            print(f"round {r} {d}: best {score} at iteration {it}", flush=True)
            dst = os.path.join(here, f"{d}.json")
            with open(path, "rb") as fi, open(dst, "wb") as fo:
                fo.write(fi.read())
        with open(os.path.join(prev, "default.json"), "rb") as fi, open(os.path.join(here, "default.json"), "wb") as fo:
            fo.write(fi.read())
        prev = here
    print(f"last round's experts: {prev}")


if __name__ == "__main__":
    main()
