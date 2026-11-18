# The bots against real results

Bots: the game's bot without look-ahead (as the simulator plays), 4000 games over every deck pair (seed 31000000).
Real: 166 Limitless tournaments with 32+ players in the 30 days to 2026-11-18 (15874 players).
Real players are not the bot: a matchup's real result also depends on the lists people brought, which differ from ours.

**Distance from real results** (matchups with 30+ real games): root mean square 23.1 points over 52 matchups.

## Each deck against the other bot decks (weighted by real meta share)

| Deck | Limitless | Real overall | Real vs these decks | Bots vs these decks | Bots − real |
|---|---|---|---|---|---|
| alakazam | alakazam-dudunsparce | 51.6% | 51.7% | 66.8% | 15.1 |
| basic-box | basic-box-m | 51.9% | 51.0% | 47.0% | -4.0 |
| dragapult-ex | dragapult-ex | 53.5% | 49.0% | 71.7% | 22.6 |
| festival-lead-dipplin | festival-lead | 51.6% | 46.2% | 42.3% | -4.0 |
| festival-lead-seaking | festival-lead | 51.6% | 46.2% | 41.9% | -4.3 |
| ns-zoroark-ex | n-zoroark | 51.5% | 50.5% | 43.8% | -6.7 |
| player | basic-box-m | 51.9% | 51.0% | 45.3% | -5.7 |
| slowking | slowking-scr | 48.7% | 51.5% | 14.2% | -37.3 |

## Largest gaps

| Deck | vs | Real | Bots | Real games |
|---|---|---|---|---|
| basic-box | slowking | 44.0% | 95.2% | 201 |
| slowking | basic-box | 56.0% | 4.8% | 201 |
| player | slowking | 44.0% | 88.7% | 201 |
| slowking | player | 56.0% | 11.3% | 201 |
| alakazam | slowking | 55.0% | 96.8% | 131 |
| slowking | alakazam | 45.0% | 3.2% | 131 |
| dragapult-ex | slowking | 46.2% | 83.9% | 381 |
| slowking | dragapult-ex | 53.8% | 16.1% | 381 |
| basic-box | dragapult-ex | 55.5% | 30.2% | 541 |
| dragapult-ex | basic-box | 44.5% | 69.8% | 541 |
| festival-lead-dipplin | alakazam | 57.8% | 33.3% | 64 |
| alakazam | festival-lead-dipplin | 42.2% | 66.7% | 64 |

## Every matchup

| Deck | vs | Real (games) | Bots (games) | Bots − real |
|---|---|---|---|---|
| alakazam | basic-box | 61.4% (198) | 79.7% (128) | 18.3 |
| alakazam | dragapult-ex | 43.6% (312) | 42.9% (126) | -0.7 |
| alakazam | festival-lead-dipplin | 42.2% (64) | 66.7% (126) | 24.5 |
| alakazam | festival-lead-seaking | 42.2% (64) | 57.1% (126) | 15.0 |
| alakazam | ns-zoroark-ex | 50.8% (126) | 66.7% (126) | 15.9 |
| alakazam | player | 61.4% (198) | 77.8% (126) | 16.4 |
| alakazam | slowking | 55.0% (131) | 96.8% (126) | 41.9 |
| basic-box | alakazam | 38.6% (198) | 20.3% (128) | -18.3 |
| basic-box | dragapult-ex | 55.5% (541) | 30.2% (126) | -25.4 |
| basic-box | festival-lead-dipplin | 56.6% (99) | 55.6% (126) | -1.0 |
| basic-box | festival-lead-seaking | 56.6% (99) | 58.7% (126) | 2.2 |
| basic-box | ns-zoroark-ex | 52.1% (166) | 52.4% (126) | 0.3 |
| basic-box | player | — | 55.6% (126) |  |
| basic-box | slowking | 44.0% (201) | 95.2% (126) | 51.2 |
| dragapult-ex | alakazam | 56.4% (312) | 57.1% (126) | 0.7 |
| dragapult-ex | basic-box | 44.5% (541) | 69.8% (126) | 25.4 |
| dragapult-ex | festival-lead-dipplin | 63.3% (196) | 82.3% (124) | 19.0 |
| dragapult-ex | festival-lead-seaking | 63.3% (196) | 83.9% (124) | 20.6 |
| dragapult-ex | ns-zoroark-ex | 43.7% (326) | 67.7% (124) | 24.0 |
| dragapult-ex | player | 44.5% (541) | 67.7% (124) | 23.3 |
| dragapult-ex | slowking | 46.2% (381) | 83.9% (124) | 37.7 |
| festival-lead-dipplin | alakazam | 57.8% (64) | 33.3% (126) | -24.5 |
| festival-lead-dipplin | basic-box | 43.4% (99) | 44.4% (126) | 1.0 |
| festival-lead-dipplin | dragapult-ex | 36.7% (196) | 17.7% (124) | -19.0 |
| festival-lead-dipplin | festival-lead-seaking | — | 56.5% (124) |  |
| festival-lead-dipplin | ns-zoroark-ex | 60.3% (58) | 75.8% (124) | 15.5 |
| festival-lead-dipplin | player | 43.4% (99) | 43.5% (124) | 0.1 |
| festival-lead-dipplin | slowking | 55.1% (68) | 75.8% (124) | 20.7 |
| festival-lead-seaking | alakazam | 57.8% (64) | 42.9% (126) | -15.0 |
| festival-lead-seaking | basic-box | 43.4% (99) | 41.3% (126) | -2.2 |
| festival-lead-seaking | dragapult-ex | 36.7% (196) | 16.1% (124) | -20.6 |
| festival-lead-seaking | festival-lead-dipplin | — | 43.5% (124) |  |
| festival-lead-seaking | ns-zoroark-ex | 60.3% (58) | 80.6% (124) | 20.3 |
| festival-lead-seaking | player | 43.4% (99) | 48.4% (124) | 5.0 |
| festival-lead-seaking | slowking | 55.1% (68) | 62.9% (124) | 7.8 |
| ns-zoroark-ex | alakazam | 49.2% (126) | 33.3% (126) | -15.9 |
| ns-zoroark-ex | basic-box | 47.9% (166) | 47.6% (126) | -0.3 |
| ns-zoroark-ex | dragapult-ex | 56.3% (326) | 32.3% (124) | -24.0 |
| ns-zoroark-ex | festival-lead-dipplin | 39.7% (58) | 24.2% (124) | -15.5 |
| ns-zoroark-ex | festival-lead-seaking | 39.7% (58) | 19.4% (124) | -20.3 |
| ns-zoroark-ex | player | 47.9% (166) | 56.5% (124) | 8.6 |
| ns-zoroark-ex | slowking | 55.4% (140) | 79.0% (124) | 23.7 |
| player | alakazam | 38.6% (198) | 22.2% (126) | -16.4 |
| player | basic-box | — | 44.4% (126) |  |
| player | dragapult-ex | 55.5% (541) | 32.3% (124) | -23.3 |
| player | festival-lead-dipplin | 56.6% (99) | 56.5% (124) | -0.1 |
| player | festival-lead-seaking | 56.6% (99) | 51.6% (124) | -5.0 |
| player | ns-zoroark-ex | 52.1% (166) | 43.5% (124) | -8.6 |
| player | slowking | 44.0% (201) | 88.7% (124) | 44.7 |
| slowking | alakazam | 45.0% (131) | 3.2% (126) | -41.9 |
| slowking | basic-box | 56.0% (201) | 4.8% (126) | -51.2 |
| slowking | dragapult-ex | 53.8% (381) | 16.1% (124) | -37.7 |
| slowking | festival-lead-dipplin | 44.9% (68) | 24.2% (124) | -20.7 |
| slowking | festival-lead-seaking | 44.9% (68) | 37.1% (124) | -7.8 |
| slowking | ns-zoroark-ex | 44.6% (140) | 21.0% (124) | -23.7 |
| slowking | player | 56.0% (201) | 11.3% (124) | -44.7 |
