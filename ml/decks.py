"""Each deck's score when player A plays it against player B on every deck evenly (BOT-NEXT.md N0, N1).

    ml/.venv/Scripts/python ml/decks.py --a net:.cache/learn/l2-60.json --b net:.cache/learn/l2-60.json --server
    ml/.venv/Scripts/python ml/decks.py --a net:.cache/learn/experts --b net:.cache/learn/l2-60.json --server

With the same network on both sides this is how well that network pilots each deck (the baseline); with A an
expert set (a folder of <deck>.json) it is how much each expert adds over it on the same deals (same --base).
Every result is appended to data/learn/decks.jsonl.
"""
from __future__ import annotations

import argparse
import json
import os
import time

from common import ROOT, run_gen
from match import paired_ci, spec, wilson

LOG = os.path.join(ROOT, "data", "learn", "decks.jsonl")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--decks", default="", help="these decks only (comma-separated slugs); default every deck file")
    ap.add_argument("--games", type=int, default=1920, help="games per deck")
    ap.add_argument("--base", type=int, default=83_000_000)
    ap.add_argument("--threads", type=int, default=15)
    ap.add_argument("--server", action="store_true", help="network players without look-ahead run batched on the GPU")
    ap.add_argument("--b-offmeta", action="store_true", help="B plays the held-out off-meta lists (.cache/meta/offmeta.json, BOT-NEXT.md N6) instead of the deck files")
    ap.add_argument("--note", default="")
    a = ap.parse_args()
    folder = os.path.join(ROOT, "src", "content", "decks")
    decks = a.decks.split(",") if a.decks else sorted(os.path.splitext(f)[0] for f in os.listdir(folder) if f.endswith(".md"))
    server = None
    if a.server:
        from serve import Server

        server = Server().start()
    rows = []
    for d in decks:
        tag = f"decks-{os.getpid()}"
        cfg = {
            "out": os.path.join(ROOT, ".cache", "learn", tag),
            "games": a.games,
            "base": a.base,
            "threads": a.threads,
            "players": {"A": spec(a.a), "B": spec(a.b)},
            "pairs": [{"a": "A", "b": "B", "share": 1, "decksA": {d: 1}}],
            **({"offmeta": {"path": os.path.join(ROOT, ".cache", "meta", "offmeta.json"), "share": 1, "heldOut": True}} if a.b_offmeta else {}),
            **({"server": {"concurrent": 128, "lanes": 1}} if server else {}),
        }
        t0 = time.time()
        r = run_gen(cfg, os.path.join(ROOT, ".cache", "learn", f"{tag}.json"), server)
        sc = r["scores"]["A vs B"]
        lo, hi = wilson(sc["score"], sc["n"])
        pe = r.get("paired", {}).get("A vs B", {})
        row = {"a": a.a, "b": a.b + (" (held-out off-meta lists)" if a.b_offmeta else ""), "deck": d, "score": sc["score"], "n": sc["n"], "se": round(pe.get("se", 0), 5), "base": a.base,
               "seconds": round(time.time() - t0), "date": time.strftime("%Y-%m-%d %H:%M"), "note": a.note}
        rows.append(row)
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        print(f"  {d:<24} {sc['score'] / sc['n'] * 100:5.1f}% (95% CI {lo * 100:.1f}-{hi * 100:.1f}{paired_ci(r)})  {row['seconds']}s", flush=True)
    mean = sum(r["score"] / r["n"] for r in rows) / len(rows)
    print(f"mean over {len(rows)} decks: {mean * 100:.1f}%")


if __name__ == "__main__":
    main()
