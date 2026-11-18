# The bots against real results

Bots: the game's bot without look-ahead (as the simulator plays), 4000 games over every deck pair (seed 31000000).
Real: 166 Limitless tournaments with 32+ players in the 30 days to 2026-11-18 (15874 players).
Real players are not the bot: a matchup's real result also depends on the lists people brought, which differ from ours.

**Distance from real results** (matchups with 30+ real games): root mean square 25.8 points over 52 matchups.

## Each deck against the other bot decks (weighted by real meta share)

| Deck | Limitless | Real overall | Real vs these decks | Bots vs these decks | Bots − real |
|---|---|---|---|---|---|
| alakazam | alakazam-dudunsparce | 51.6% | 51.7% | 60.8% | 9.1 |
| basic-box | basic-box-m | 51.9% | 51.0% | 45.2% | -5.8 |
| dragapult-ex | dragapult-ex | 53.5% | 49.0% | 82.4% | 33.4 |
| festival-lead-dipplin | festival-lead | 51.6% | 46.2% | 33.2% | -13.1 |
| festival-lead-seaking | festival-lead | 51.6% | 46.2% | 30.0% | -16.2 |
| ns-zoroark-ex | n-zoroark | 51.5% | 50.5% | 44.4% | -6.1 |
| player | basic-box-m | 51.9% | 51.0% | 41.1% | -9.9 |
| slowking | slowking-scr | 48.7% | 51.5% | 14.0% | -37.6 |

## Largest gaps

| Deck | vs | Real | Bots | Real games |
|---|---|---|---|---|
| basic-box | slowking | 44.0% | 96.8% | 201 |
| slowking | basic-box | 56.0% | 3.2% | 201 |
| slowking | alakazam | 45.0% | 1.6% | 131 |
| alakazam | slowking | 55.0% | 98.4% | 131 |
| dragapult-ex | slowking | 46.2% | 87.1% | 381 |
| slowking | dragapult-ex | 53.8% | 12.9% | 381 |
| player | slowking | 44.0% | 83.9% | 201 |
| slowking | player | 56.0% | 16.1% | 201 |
| dragapult-ex | player | 44.5% | 82.3% | 541 |
| player | dragapult-ex | 55.5% | 17.7% | 541 |
| basic-box | dragapult-ex | 55.5% | 19.0% | 541 |
| dragapult-ex | basic-box | 44.5% | 81.0% | 541 |

## Every matchup

| Deck | vs | Real (games) | Bots (games) | Bots − real |
|---|---|---|---|---|
| alakazam | basic-box | 61.4% (198) | 67.2% (128) | 5.8 |
| alakazam | dragapult-ex | 43.6% (312) | 27.0% (126) | -16.6 |
| alakazam | festival-lead-dipplin | 42.2% (64) | 69.8% (126) | 27.7 |
| alakazam | festival-lead-seaking | 42.2% (64) | 68.3% (126) | 26.1 |
| alakazam | ns-zoroark-ex | 50.8% (126) | 60.3% (126) | 9.5 |
| alakazam | player | 61.4% (198) | 81.0% (126) | 19.6 |
| alakazam | slowking | 55.0% (131) | 98.4% (126) | 43.5 |
| basic-box | alakazam | 38.6% (198) | 32.8% (128) | -5.8 |
| basic-box | dragapult-ex | 55.5% (541) | 19.0% (126) | -36.5 |
| basic-box | festival-lead-dipplin | 56.6% (99) | 65.1% (126) | 8.5 |
| basic-box | festival-lead-seaking | 56.6% (99) | 71.4% (126) | 14.9 |
| basic-box | ns-zoroark-ex | 52.1% (166) | 44.4% (126) | -7.7 |
| basic-box | player | — | 74.6% (126) |  |
| basic-box | slowking | 44.0% (201) | 96.8% (126) | 52.8 |
| dragapult-ex | alakazam | 56.4% (312) | 73.0% (126) | 16.6 |
| dragapult-ex | basic-box | 44.5% (541) | 81.0% (126) | 36.5 |
| dragapult-ex | festival-lead-dipplin | 63.3% (196) | 91.9% (124) | 28.7 |
| dragapult-ex | festival-lead-seaking | 63.3% (196) | 90.3% (124) | 27.1 |
| dragapult-ex | ns-zoroark-ex | 43.7% (326) | 79.0% (124) | 35.3 |
| dragapult-ex | player | 44.5% (541) | 82.3% (124) | 37.8 |
| dragapult-ex | slowking | 46.2% (381) | 87.1% (124) | 40.9 |
| festival-lead-dipplin | alakazam | 57.8% (64) | 30.2% (126) | -27.7 |
| festival-lead-dipplin | basic-box | 43.4% (99) | 34.9% (126) | -8.5 |
| festival-lead-dipplin | dragapult-ex | 36.7% (196) | 8.1% (124) | -28.7 |
| festival-lead-dipplin | festival-lead-seaking | — | 51.6% (124) |  |
| festival-lead-dipplin | ns-zoroark-ex | 60.3% (58) | 59.7% (124) | -0.7 |
| festival-lead-dipplin | player | 43.4% (99) | 37.1% (124) | -6.3 |
| festival-lead-dipplin | slowking | 55.1% (68) | 66.1% (124) | 11.0 |
| festival-lead-seaking | alakazam | 57.8% (64) | 31.7% (126) | -26.1 |
| festival-lead-seaking | basic-box | 43.4% (99) | 28.6% (126) | -14.9 |
| festival-lead-seaking | dragapult-ex | 36.7% (196) | 9.7% (124) | -27.1 |
| festival-lead-seaking | festival-lead-dipplin | — | 48.4% (124) |  |
| festival-lead-seaking | ns-zoroark-ex | 60.3% (58) | 59.7% (124) | -0.7 |
| festival-lead-seaking | player | 43.4% (99) | 27.4% (124) | -16.0 |
| festival-lead-seaking | slowking | 55.1% (68) | 58.1% (124) | 2.9 |
| ns-zoroark-ex | alakazam | 49.2% (126) | 39.7% (126) | -9.5 |
| ns-zoroark-ex | basic-box | 47.9% (166) | 55.6% (126) | 7.7 |
| ns-zoroark-ex | dragapult-ex | 56.3% (326) | 21.0% (124) | -35.3 |
| ns-zoroark-ex | festival-lead-dipplin | 39.7% (58) | 40.3% (124) | 0.7 |
| ns-zoroark-ex | festival-lead-seaking | 39.7% (58) | 40.3% (124) | 0.7 |
| ns-zoroark-ex | player | 47.9% (166) | 51.6% (124) | 3.7 |
| ns-zoroark-ex | slowking | 55.4% (140) | 83.9% (124) | 28.5 |
| player | alakazam | 38.6% (198) | 19.0% (126) | -19.6 |
| player | basic-box | — | 25.4% (126) |  |
| player | dragapult-ex | 55.5% (541) | 17.7% (124) | -37.8 |
| player | festival-lead-dipplin | 56.6% (99) | 62.9% (124) | 6.3 |
| player | festival-lead-seaking | 56.6% (99) | 72.6% (124) | 16.0 |
| player | ns-zoroark-ex | 52.1% (166) | 48.4% (124) | -3.7 |
| player | slowking | 44.0% (201) | 83.9% (124) | 39.8 |
| slowking | alakazam | 45.0% (131) | 1.6% (126) | -43.5 |
| slowking | basic-box | 56.0% (201) | 3.2% (126) | -52.8 |
| slowking | dragapult-ex | 53.8% (381) | 12.9% (124) | -40.9 |
| slowking | festival-lead-dipplin | 44.9% (68) | 33.9% (124) | -11.0 |
| slowking | festival-lead-seaking | 44.9% (68) | 41.9% (124) | -2.9 |
| slowking | ns-zoroark-ex | 44.6% (140) | 16.1% (124) | -28.5 |
| slowking | player | 56.0% (201) | 16.1% (124) | -39.8 |
