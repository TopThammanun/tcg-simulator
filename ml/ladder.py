"""The yardstick (BOT-LEAP.md L0): every measured match between two players goes into data/learn/ladder.jsonl, and
`table` fits one Elo rating per player to all of them (Bradley-Terry, 95% ranges from the curvature).

    ml/.venv/Scripts/python ml/ladder.py play net:.cache/learn/v2-600.json bot --games 1920 --server
    ml/.venv/Scripts/python ml/ladder.py play search:.cache/learn/v2-600.json bot-search --games 1920
    ml/.venv/Scripts/python ml/ladder.py table --anchor bot-search

Players are written as ml/match.py takes them (net:, search:, bot, bot-search, hard, normal). A match is every
deck pair from both seats with the same deals; a different --base gives other deals. Results of matches with the
time-limited look-ahead depend on the machine being free (other work slows its search).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time

import numpy as np

from common import ROOT, run_gen
from match import paired_ci, spec, wilson

LADDER = os.path.join(ROOT, "data", "learn", "ladder.jsonl")


def play(a: str, b: str, games: int, base: int, threads: int, server: bool, note: str, a_decks: str = "") -> dict:
    tag = f"ladder-{os.getpid()}"
    cfg = {
        "out": os.path.join(ROOT, ".cache", "learn", tag),
        "games": games,
        "base": base,
        "threads": threads,
        "players": {"A": spec(a), "B": spec(b)},
        "pairs": [{"a": "A", "b": "B", "share": 1, **({"decksA": {d: 1 for d in a_decks.split(",")}} if a_decks else {})}],
    }
    srv = None
    if server:
        from serve import Server

        srv = Server().start()
        cfg["server"] = {"concurrent": 128, "lanes": 1}
    t0 = time.time()
    r = run_gen(cfg, os.path.join(ROOT, ".cache", "learn", f"{tag}.json"), srv)
    sc = r["scores"]["A vs B"]
    row = {"a": a, "b": b, "score": sc["score"], "n": sc["n"], "base": base, "seconds": round(time.time() - t0), "date": time.strftime("%Y-%m-%d %H:%M"), "note": note}
    if a_decks:
        # A played only these decks: kept for the record, left out of the Elo table (not the same contest).
        row["a_decks"] = a_decks
    pe = r.get("paired", {}).get("A vs B")
    if pe:
        row["se"] = round(pe["se"], 5)
    # A's score with each of its decks (keys "A <its deck> vs <B's deck>"): a ship gate also asks that no deck got worse.
    by = {}
    for k, v in r.get("byDeck", {}).items():
        if k.startswith("A "):
            d = k[2:].split(" vs ")[0]
            sc_n = by.setdefault(d, [0, 0])
            sc_n[0] += v["score"]
            sc_n[1] += v["n"]
    if by:
        row["byDeckA"] = by
    os.makedirs(os.path.dirname(LADDER), exist_ok=True)
    with open(LADDER, "a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")
    lo, hi = wilson(sc["score"], sc["n"])
    print(f"{a} vs {b}: {sc['score']}/{sc['n']} = {sc['score'] / sc['n'] * 100:.1f}% (95% CI {lo * 100:.1f}-{hi * 100:.1f}{paired_ci(r)}), {row['seconds']}s")
    for d, (score, n) in sorted(by.items()):
        dlo, dhi = wilson(score, n)
        print(f"  A with {d:<24} {score / n * 100:5.1f}% ({dlo * 100:.1f}-{dhi * 100:.1f}, {n} games)")
    return row


def fit(rows: list[dict], anchor: str) -> list[tuple[str, float, float, int]]:
    """Bradley-Terry ratings (Elo scale), each with its 95% half-range, for every player in the results."""
    players = sorted({r["a"] for r in rows} | {r["b"] for r in rows})
    if anchor not in players:
        anchor = players[0]
    ix = {p: i for i, p in enumerate(players)}
    k = math.log(10) / 400
    r = np.zeros(len(players))
    games = np.zeros(len(players), dtype=int)
    for row in rows:
        games[ix[row["a"]]] += row["n"]
        games[ix[row["b"]]] += row["n"]
    free = [i for i in range(len(players)) if players[i] != anchor]
    for _ in range(100):
        g = np.zeros(len(players))
        h = np.zeros((len(players), len(players)))
        for row in rows:
            i, j = ix[row["a"]], ix[row["b"]]
            p = 1 / (1 + math.exp(-k * (r[i] - r[j])))
            g[i] += k * (row["score"] - row["n"] * p)
            g[j] -= k * (row["score"] - row["n"] * p)
            w = k * k * row["n"] * p * (1 - p)
            h[i, i] -= w
            h[j, j] -= w
            h[i, j] += w
            h[j, i] += w
        hf = h[np.ix_(free, free)]
        step = np.linalg.lstsq(hf, -g[free], rcond=None)[0]
        r[free] += step
        if np.abs(step).max() < 1e-6:
            break
    cov = np.linalg.pinv(-h[np.ix_(free, free)])
    half = np.zeros(len(players))
    half[free] = 1.96 * np.sqrt(np.clip(np.diag(cov), 0, None))
    return sorted(((p, float(r[ix[p]]), float(half[ix[p]]), int(games[ix[p]])) for p in players), key=lambda x: -x[1])


def linked(rows: list[dict]) -> list[set[str]]:
    """Players in groups that matches connect; ratings compare only within a group."""
    groups: list[set[str]] = []
    for r in rows:
        hit = [g for g in groups if r["a"] in g or r["b"] in g]
        merged = set().union(*hit) | {r["a"], r["b"]}
        groups = [g for g in groups if g not in hit] + [merged]
    return groups


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("play")
    p.add_argument("a")
    p.add_argument("b")
    p.add_argument("--games", type=int, default=1920)
    p.add_argument("--base", type=int, default=80_000_000)
    p.add_argument("--threads", type=int, default=15)
    p.add_argument("--server", action="store_true", help="network players without look-ahead run batched on the GPU")
    p.add_argument("--note", default="")
    p.add_argument("--a-decks", default="", help="A plays only these decks (comma-separated); the row stays out of the Elo table")
    t = sub.add_parser("table")
    t.add_argument("--anchor", default="bot-search", help="the player rated 0")
    a = ap.parse_args()
    if a.cmd == "play":
        play(a.a, a.b, a.games, a.base, a.threads, a.server, a.note, a.a_decks)
        return
    rows = [r for r in (json.loads(l) for l in open(LADDER, encoding="utf-8")) if not r.get("a_decks")] if os.path.exists(LADDER) else []
    if not rows:
        raise SystemExit("no results yet")
    print(f"{len(rows)} matches, Elo with {a.anchor} = 0 (95% range)")
    for name, elo, half, n in fit(rows, a.anchor):
        print(f"  {elo:+7.0f} +-{half:3.0f}  {name}  ({n} games)")
    groups = linked(rows)
    if len(groups) > 1:
        print("not comparable across these groups (no match links them yet):")
        for g in groups:
            print("   ", ", ".join(sorted(g)))


if __name__ == "__main__":
    main()
