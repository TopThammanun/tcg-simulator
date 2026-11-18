"""A match between two bots on every deck pair, both seats, same deals: score of A with a 95% interval.

    ml/.venv/Scripts/python ml/match.py --a net:.cache/learn/bc.json --b hard --games 960
    ml/.venv/Scripts/python ml/match.py --a search:src/bots/learn/weights.json --b net:src/bots/learn/weights.json

Bots: normal, hard, bot / bot-search (the game's bot: bundled network and specialists, without / with look-ahead),
net:<weights> (no look-ahead), search:<weights>[:width:samples:horizon] (look-ahead with the
attack planner's line among the options, as the game uses it), search-np:<weights> (look-ahead on policy options only),
search-ng:<weights> (planner's first step only, without the sure-line checks: the bot of round 2).
"""
import argparse
import math
import os

from common import ROOT, run_gen


def spec(s: str) -> dict:
    kind, *rest = s.split(":", 1)
    if kind in ("normal", "hard"):
        return {"kind": kind}
    if kind in ("bot", "bot-search"):
        return {"kind": "bot", "fast": kind == "bot"}
    if kind == "net":
        return {"kind": "net", "weights": rest[0], "temperature": 0}
    if kind in ("search", "search-np", "search-ng"):
        parts = rest[0].rsplit(":", 3) if rest[0].count(":") >= 3 else [rest[0]]
        # The play screen's time limit per decision (src/bots/index.ts SEARCH).
        out = {"kind": "search", "weights": parts[0], "tactics": kind != "search-np", "guards": kind == "search", "deadlineMs": 2500}
        if len(parts) == 4:
            out.update(width=int(parts[1]), samples=int(parts[2]), horizon=parts[3])
        return out
    raise SystemExit(f"unknown bot {s}")


def decks(a) -> dict:
    """decksA / decksB for gen.ts from --a-decks / --b-decks ("dragapult-ex" or "player=0.4,slowking=0.6")."""
    out = {}
    for side, text in (("decksA", a.a_decks), ("decksB", a.b_decks)):
        if text:
            out[side] = {k: float(v) if v else 1.0 for k, _, v in (x.partition("=") for x in text.split(","))}
    return out


def wilson(score: float, n: int, z: float = 1.96) -> tuple[float, float]:
    p = score / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--games", type=int, default=960)
    ap.add_argument("--base", type=int, default=70_000_000)
    ap.add_argument("--threads", type=int, default=15)
    ap.add_argument("--by-deck", action="store_true", help="also print A's score per deck pair")
    ap.add_argument("--a-decks", default="", help="A plays only these decks: slug or slug=weight,...")
    ap.add_argument("--b-decks", default="", help="B plays only these decks (same form)")
    a = ap.parse_args()
    # Own config and output per run: matches run side by side must not read each other's config.
    tag = f"match-{os.getpid()}"
    cfg = {
        "out": os.path.join(ROOT, ".cache", "learn", tag),
        "games": a.games,
        "base": a.base,
        "threads": a.threads,
        "players": {"A": spec(a.a), "B": spec(a.b)},
        "pairs": [{"a": "A", "b": "B", "share": 1, **decks(a)}],
    }
    r = run_gen(cfg, os.path.join(ROOT, ".cache", "learn", f"{tag}.json"))
    sc = r["scores"]["A vs B"]
    lo, hi = wilson(sc["score"], sc["n"])
    print(f"{a.a} vs {a.b}: {sc['score']}/{sc['n']} = {sc['score'] / sc['n'] * 100:.1f}% (95% CI {lo * 100:.1f}-{hi * 100:.1f}); "
          f"slowest decision A {r['maxThinkMs'].get('A', 0):.0f} ms, B {r['maxThinkMs'].get('B', 0):.0f} ms; {r['seconds']:.0f}s")
    if a.by_deck:
        # A's score by its deck (rows) against B's deck, then by A's deck overall.
        own = {}
        for key, v in sorted(r.get("byDeck", {}).items()):
            if not key.startswith("A "):
                continue
            deck = key[2:].split(" vs ")[0]
            o = own.setdefault(deck, [0.0, 0])
            o[0] += v["score"]
            o[1] += v["n"]
            print(f"  {key[2:]:<50} {v['score']:>6}/{v['n']:<4} {v['score'] / v['n'] * 100:5.1f}%")
        for deck, (sc_, n) in sorted(own.items(), key=lambda x: x[1][0] / x[1][1]):
            print(f"  A playing {deck:<28} {sc_ / n * 100:5.1f}% of {n}")


if __name__ == "__main__":
    main()
