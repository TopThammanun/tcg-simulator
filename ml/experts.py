"""Deck experts (BOT-NEXT.md N1): put an expert set together and ship it to the play screen.

    ml/.venv/Scripts/python ml/experts.py assemble --out .cache/learn/experts-n1 --default .cache/learn/l2-60.json \
        dragapult-ex=.cache/learn/x2-dragapult-ex/eval-290.json basic-box=...
    ml/.venv/Scripts/python ml/experts.py best .cache/learn/x2-dragapult-ex          # its best evaluated checkpoint
    ml/.venv/Scripts/python ml/experts.py ship --set .cache/learn/experts-n1         # -> src/bots/learn/experts/*.json

An expert set is a folder of <deck slug>.json with default.json for the other decks: gen.ts, match.py and decks.py
take the folder wherever they take a weights file (`net:<folder>`, `search:<folder>`). `ship` writes each expert
as float16 (half the download; check one with scripts/learn/half-check.ts) where the web loads it from
(src/bots/experts.ts); the bundled network keeps playing the decks without one. `--no-look-ahead <slugs>` marks
experts that play without look-ahead on the play screen (meta.search, src/bots/index.ts): those whose deck the
look-ahead helps by under 3 points (BOT-NEXT.md N5, ml/ladder.py play "search:<set>" vs "search:<set>|samples=0").
"""
from __future__ import annotations

import argparse
import json
import os
import shutil

from common import ROOT, b64, unb64, write_json

WEB = os.path.join(ROOT, "src", "bots", "learn", "experts")


def best(run_dir: str) -> tuple[str, float, int]:
    """A PPO run's best evaluated checkpoint (state.json best, else the highest eval in log.jsonl)."""
    rows = [json.loads(l) for l in open(os.path.join(run_dir, "log.jsonl"), encoding="utf-8")]
    evals = [(next(v for k, v in r.items() if k.startswith("eval_vs_")), r["iter"]) for r in rows if any(k.startswith("eval_vs_") for k in r)]
    score, it = max(evals)
    return os.path.join(run_dir, f"eval-{it}.json"), score, it


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("assemble")
    s.add_argument("--out", required=True)
    s.add_argument("--default", required=True, help="the network for decks without an expert")
    s.add_argument("experts", nargs="*", help="slug=weights.json")
    b = sub.add_parser("best")
    b.add_argument("run")
    p = sub.add_parser("ship")
    p.add_argument("--set", required=True)
    p.add_argument("--decks", default="", help="only these (comma-separated)")
    p.add_argument("--no-look-ahead", default="", help="these experts play without look-ahead (comma-separated)")
    a = ap.parse_args()
    if a.cmd == "best":
        path, score, it = best(a.run)
        print(f"{path}  (eval {score} at iteration {it})")
        return
    if a.cmd == "assemble":
        os.makedirs(a.out, exist_ok=True)
        shutil.copy(a.default, os.path.join(a.out, "default.json"))
        for spec in a.experts:
            slug, _, path = spec.partition("=")
            shutil.copy(path, os.path.join(a.out, f"{slug}.json"))
        print(f"{a.out}: default + {', '.join(x.split('=')[0] for x in a.experts) or 'no experts'}")
        return
    os.makedirs(WEB, exist_ok=True)
    only = set(a.decks.split(",")) if a.decks else None
    plain = set(a.no_look_ahead.split(",")) if a.no_look_ahead else set()
    for f in sorted(os.listdir(a.set)):
        slug = os.path.splitext(f)[0]
        if not f.endswith(".json") or slug == "default" or (only and slug not in only):
            continue
        j = json.load(open(os.path.join(a.set, f)))
        j["tensors"] = {k: b64(unb64(v), half=True) for k, v in j["tensors"].items()}
        meta = j.setdefault("meta", {})
        # From .cache/ on when the set was trained in another worktree of the repo.
        src = os.path.abspath(os.path.join(a.set, f)).replace("\\", "/")
        meta["shipped from"] = src[src.find(".cache/"):] if ".cache/" in src else os.path.relpath(src, ROOT).replace("\\", "/")
        if slug in plain:
            meta["search"] = {"samples": 0}
        else:
            meta.pop("search", None)
        write_json(j, os.path.join(WEB, f))
        print(f"shipped {slug} ({os.path.getsize(os.path.join(WEB, f)) / 1e6:.1f} MB){' without look-ahead' if slug in plain else ''}")


if __name__ == "__main__":
    main()
