# Training log

Self-play experiments for the bots. scripts/train.ts writes one line per generation (self-play games, data,
network fit, gate match); the other sections were written by hand from scripts/hard-gate.ts and scripts/tune.ts.

## Run 1: board features only

- gen 0: self-play 1600 games by ยาก → 47240 positions; network on 47240 (validation loss 0.4056, right 81.2%); new vs ยาก: 228/480 = 47.5% (95% CI 43.1–52.0) → kept old; slowest decision 1751 ms; 150s + 8s + 72s
- gen 1: self-play 1600 games by ยาก → 47480 positions; network on 94720 (validation loss 0.3923, right 81.0%); new vs ยาก: 237/480 = 49.4% (95% CI 44.9–53.8) → kept old; slowest decision 1450 ms; 158s + 17s + 71s

Not better than the hard bot's hand-made score: the network judges positions well (81% right) but not
the small differences between candidate moves. Stopped after gen 1.

## Run 2: + the hand-made score as an input, own hand, Prize race; same search breadth as the hard bot

- gen 0: self-play 1600 games by ยาก → 47240 positions; network on 47240 (validation loss 0.3837, right 81.7%); new vs ยาก: 217/480 = 45.2% (95% CI 40.8–49.7) → kept old; slowest decision 929 ms; 142s + 9s + 57s

Still worse. Stopped.

## Other experiments (scripts/hard-gate.ts, 480 games each unless said)

- network blended 50/50 with the hand-made score, vs ยาก: 52.3% (47.8–56.7), not significant
- network scoring at the end of my own turn (half-length rollouts), 8 deals × 3 candidates, vs ยาก: 50.0% (45.5–54.5)
- wider search (8 deals, 3 extra candidates), vs ยาก: 57.5% (53.0–61.8) on seeds 50000+, but only
  51.0% (47.9–54.2) over 960 fresh games: not really stronger
- two-round search (4 deals, then 8 more for the two best), vs ยาก: 56.3% (51.8–60.6) on the same seeds

## SPSA self-play tuning of the main weights (scripts/tune.ts)

- 16 chains × 3,000 steps = 96,000 games in 252 s. Tuned ปกติ vs hand-set ปกติ: 51.6% of 8,000 fresh games
  (95% CI 50.5–52.7); tuned ยาก vs hand-set ยาก: 50.6% of 480 (46.2–55.1). Adopted (src/bots/params.ts).
  The chains disagree on most weights: win rate is flat around these values, so the bots' strength is
  limited by how they decide (their rules), not by the numbers. The clearest signal: a lower devThreshold
  (develop the board before looking at the attack plan).
