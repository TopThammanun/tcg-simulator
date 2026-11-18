# The bots against real results

Bots: the game's bot without look-ahead (as the simulator plays), 4000 games over every deck pair (seed 31000000).
Real: 166 Limitless tournaments with 32+ players in the 30 days to 2026-11-18 (15874 players).
Real players are not the bot: a matchup's real result also depends on the lists people brought, which differ from ours.

**Distance from real results** (matchups with 30+ real games): root mean square 27.7 points over 52 matchups.

## Each deck against the other bot decks (weighted by real meta share)

| Deck | Limitless | Real overall | Real vs these decks | Bots vs these decks | Bots − real |
|---|---|---|---|---|---|
| alakazam | alakazam-dudunsparce | 51.6% | 51.7% | 54.5% | 2.8 |
| basic-box | basic-box-m | 51.9% | 51.0% | 53.2% | 2.2 |
| dragapult-ex | dragapult-ex | 53.5% | 49.0% | 80.4% | 31.3 |
| festival-lead-dipplin | festival-lead | 51.6% | 46.2% | 32.8% | -13.4 |
| festival-lead-seaking | festival-lead | 51.6% | 46.2% | 15.9% | -30.3 |
| ns-zoroark-ex | n-zoroark | 51.5% | 50.5% | 55.0% | 4.4 |
| player | basic-box-m | 51.9% | 51.0% | 40.7% | -10.3 |
| slowking | slowking-scr | 48.7% | 51.5% | 13.3% | -38.3 |

## Largest gaps

| Deck | vs | Real | Bots | Real games |
|---|---|---|---|---|
| basic-box | slowking | 44.0% | 96.8% | 201 |
| slowking | basic-box | 56.0% | 3.2% | 201 |
| dragapult-ex | slowking | 46.2% | 95.2% | 381 |
| slowking | dragapult-ex | 53.8% | 4.8% | 381 |
| ns-zoroark-ex | festival-lead-seaking | 39.7% | 82.3% | 58 |
| festival-lead-seaking | ns-zoroark-ex | 60.3% | 17.7% | 58 |
| player | slowking | 44.0% | 83.9% | 201 |
| slowking | player | 56.0% | 16.1% | 201 |
| alakazam | slowking | 55.0% | 93.7% | 131 |
| slowking | alakazam | 45.0% | 6.3% | 131 |
| dragapult-ex | player | 44.5% | 82.3% | 541 |
| player | dragapult-ex | 55.5% | 17.7% | 541 |

## Every matchup

| Deck | vs | Real (games) | Bots (games) | Bots − real |
|---|---|---|---|---|
| alakazam | basic-box | 61.4% (198) | 54.7% (128) | -6.7 |
| alakazam | dragapult-ex | 43.6% (312) | 23.8% (126) | -19.8 |
| alakazam | festival-lead-dipplin | 42.2% (64) | 65.1% (126) | 22.9 |
| alakazam | festival-lead-seaking | 42.2% (64) | 63.5% (126) | 21.3 |
| alakazam | ns-zoroark-ex | 50.8% (126) | 57.1% (126) | 6.3 |
| alakazam | player | 61.4% (198) | 71.4% (126) | 10.1 |
| alakazam | slowking | 55.0% (131) | 93.7% (126) | 38.7 |
| basic-box | alakazam | 38.6% (198) | 45.3% (128) | 6.7 |
| basic-box | dragapult-ex | 55.5% (541) | 27.0% (126) | -28.6 |
| basic-box | festival-lead-dipplin | 56.6% (99) | 73.0% (126) | 16.5 |
| basic-box | festival-lead-seaking | 56.6% (99) | 88.9% (126) | 32.3 |
| basic-box | ns-zoroark-ex | 52.1% (166) | 52.4% (126) | 0.3 |
| basic-box | player | — | 77.8% (126) |  |
| basic-box | slowking | 44.0% (201) | 96.8% (126) | 52.8 |
| dragapult-ex | alakazam | 56.4% (312) | 76.2% (126) | 19.8 |
| dragapult-ex | basic-box | 44.5% (541) | 73.0% (126) | 28.6 |
| dragapult-ex | festival-lead-dipplin | 63.3% (196) | 91.9% (124) | 28.7 |
| dragapult-ex | festival-lead-seaking | 63.3% (196) | 96.8% (124) | 33.5 |
| dragapult-ex | ns-zoroark-ex | 43.7% (326) | 59.7% (124) | 16.0 |
| dragapult-ex | player | 44.5% (541) | 82.3% (124) | 37.8 |
| dragapult-ex | slowking | 46.2% (381) | 95.2% (124) | 49.0 |
| festival-lead-dipplin | alakazam | 57.8% (64) | 34.9% (126) | -22.9 |
| festival-lead-dipplin | basic-box | 43.4% (99) | 27.0% (126) | -16.5 |
| festival-lead-dipplin | dragapult-ex | 36.7% (196) | 8.1% (124) | -28.7 |
| festival-lead-dipplin | festival-lead-seaking | — | 51.6% (124) |  |
| festival-lead-dipplin | ns-zoroark-ex | 60.3% (58) | 58.1% (124) | -2.3 |
| festival-lead-dipplin | player | 43.4% (99) | 43.5% (124) | 0.1 |
| festival-lead-dipplin | slowking | 55.1% (68) | 62.9% (124) | 7.8 |
| festival-lead-seaking | alakazam | 57.8% (64) | 36.5% (126) | -21.3 |
| festival-lead-seaking | basic-box | 43.4% (99) | 11.1% (126) | -32.3 |
| festival-lead-seaking | dragapult-ex | 36.7% (196) | 3.2% (124) | -33.5 |
| festival-lead-seaking | festival-lead-dipplin | — | 48.4% (124) |  |
| festival-lead-seaking | ns-zoroark-ex | 60.3% (58) | 17.7% (124) | -42.6 |
| festival-lead-seaking | player | 43.4% (99) | 11.3% (124) | -32.1 |
| festival-lead-seaking | slowking | 55.1% (68) | 40.3% (124) | -14.8 |
| ns-zoroark-ex | alakazam | 49.2% (126) | 42.9% (126) | -6.3 |
| ns-zoroark-ex | basic-box | 47.9% (166) | 47.6% (126) | -0.3 |
| ns-zoroark-ex | dragapult-ex | 56.3% (326) | 40.3% (124) | -16.0 |
| ns-zoroark-ex | festival-lead-dipplin | 39.7% (58) | 41.9% (124) | 2.3 |
| ns-zoroark-ex | festival-lead-seaking | 39.7% (58) | 82.3% (124) | 42.6 |
| ns-zoroark-ex | player | 47.9% (166) | 69.4% (124) | 21.5 |
| ns-zoroark-ex | slowking | 55.4% (140) | 83.9% (124) | 28.5 |
| player | alakazam | 38.6% (198) | 28.6% (126) | -10.1 |
| player | basic-box | — | 22.2% (126) |  |
| player | dragapult-ex | 55.5% (541) | 17.7% (124) | -37.8 |
| player | festival-lead-dipplin | 56.6% (99) | 56.5% (124) | -0.1 |
| player | festival-lead-seaking | 56.6% (99) | 88.7% (124) | 32.1 |
| player | ns-zoroark-ex | 52.1% (166) | 30.6% (124) | -21.5 |
| player | slowking | 44.0% (201) | 83.9% (124) | 39.8 |
| slowking | alakazam | 45.0% (131) | 6.3% (126) | -38.7 |
| slowking | basic-box | 56.0% (201) | 3.2% (126) | -52.8 |
| slowking | dragapult-ex | 53.8% (381) | 4.8% (124) | -49.0 |
| slowking | festival-lead-dipplin | 44.9% (68) | 37.1% (124) | -7.8 |
| slowking | festival-lead-seaking | 44.9% (68) | 59.7% (124) | 14.8 |
| slowking | ns-zoroark-ex | 44.6% (140) | 16.1% (124) | -28.5 |
| slowking | player | 56.0% (201) | 16.1% (124) | -39.8 |
