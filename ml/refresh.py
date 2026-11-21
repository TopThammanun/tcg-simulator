"""Keep the experts current (BOT-NEXT.md, ทางคู่ขนาน): when pick-lists.ts changes a deck's list, or a rule fix touches
how a deck plays, its expert trains on from the one in the set; then both play the set's field on the N0 deals (the
deck's current list), and the better one goes into a new set, shipped to the play screen with --ship.

    ml/.venv/Scripts/python ml/refresh.py --set .cache/learn/experts-n1 --decks dragapult-ex --out .cache/learn/experts-n1b [--ship]

Training is N1's expert run against the set (ppo.py --focus, --iters 150, stopping 50 iterations without a better
eval); arguments after "--" replace TRAIN. Runs go to <out>-runs/<deck>; resumes. Rows go to data/learn/decks.jsonl.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

from common import ROOT
from decks import measure
from experts import best

TRAIN = ["--games", "1920", "--threads", "12", "--concurrent", "64", "--mix", "self:0.3,old:0.2,frozen:0.45,normal:0.05",
         "--variants", "0.7", "--variants-a", "0.2", "--vs-meta", "0.4", "--vs-weights", "player=0.1", "--epochs", "2", "--mb", "4096",
         "--lr", "1e-4", "--overlap", "--resign", "0.03", "--eval-every", "10", "--eval-games", "1920", "--patience", "50"]


def main():
    argv = sys.argv[1:]
    extra = argv[argv.index("--") + 1 :] if "--" in argv else []
    argv = argv[: argv.index("--")] if "--" in argv else argv
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", required=True, help="the expert set now in use (folder of <deck>.json + default.json)")
    ap.add_argument("--decks", required=True, help="the decks whose list or rules changed (comma-separated)")
    ap.add_argument("--out", required=True, help="the new set")
    ap.add_argument("--iters", type=int, default=150)
    ap.add_argument("--games", type=int, default=1920, help="games per deck for the comparison")
    ap.add_argument("--threads", type=int, default=12)
    ap.add_argument("--ship", action="store_true", help="ship the new set's experts (experts.py ship)")
    a = ap.parse_args(argv)
    old = os.path.abspath(a.set)
    out = os.path.abspath(a.out)
    shutil.copytree(old, out, dirs_exist_ok=True)
    decks = a.decks.split(",")
    current = {d: os.path.join(old, f"{d}.json") if os.path.exists(os.path.join(old, f"{d}.json")) else os.path.join(old, "default.json") for d in decks}
    for d in decks:
        run = os.path.join(f"{out}-runs", d)
        state = os.path.join(run, "state.json")
        done = json.load(open(state)) if os.path.exists(state) else {"iter": 0}
        if done["iter"] < a.iters and not done.get("stopped"):
            cmd = [sys.executable, os.path.join(ROOT, "ml", "ppo.py"), "--init", current[d], "--dir", run, "--focus", d, "--iters", str(a.iters - done["iter"]),
                   "--frozen", old, "--eval-vs", "frozen", *(extra or TRAIN)]
            print(" ".join(cmd), flush=True)
            subprocess.run(cmd, cwd=ROOT, check=True)
    from serve import Server

    server = Server().start()
    for d in decks:
        cand = best(os.path.join(f"{out}-runs", d))[0]
        new = measure(f"net:{cand}", f"net:{old}", d, a.games, 83_000_000, a.threads, server, f"refresh: {d} trained on")
        now = measure(f"net:{current[d]}", f"net:{old}", d, a.games, 83_000_000, a.threads, server, f"refresh: {d} in the set")
        keep = new["score"] >= now["score"]
        if keep:
            shutil.copy(cand, os.path.join(out, f"{d}.json"))
        print(f"{d}: trained on {new['score'] / new['n'] * 100:.1f}%, in the set {now['score'] / now['n'] * 100:.1f}% -> {'replaced' if keep else 'kept'}", flush=True)
    if a.ship:
        subprocess.run([sys.executable, os.path.join(ROOT, "ml", "experts.py"), "ship", "--set", out], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
