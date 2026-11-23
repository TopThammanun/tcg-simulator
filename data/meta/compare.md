# The bots against real results

Bots: the game's bot without look-ahead (as the simulator plays), 4000 games over every deck pair (seed 31000000).
Real: 166 Limitless tournaments with 32+ players in the 30 days to 2026-11-18 (15874 players).
Real players are not the bot: a matchup's real result also depends on the lists people brought, which differ from ours.

**Distance from real results** (matchups with 30+ real games): root mean square 18.3 points over 52 matchups.

## Each deck against the other bot decks (weighted by real meta share)

| Deck | Limitless | Real overall | Real vs these decks | Bots vs these decks | Bots − real |
|---|---|---|---|---|---|
| alakazam | alakazam-dudunsparce | 51.6% | 51.7% | 72.1% | 20.4 |
| basic-box | basic-box-m | 51.9% | 51.0% | 33.2% | -17.8 |
| dragapult-ex | dragapult-ex | 53.5% | 49.0% | 64.6% | 15.6 |
| festival-lead-dipplin | festival-lead | 51.6% | 46.2% | 46.3% | 0.0 |
| festival-lead-seaking | festival-lead | 51.6% | 46.2% | 42.9% | -3.3 |
| ns-zoroark-ex | n-zoroark | 51.5% | 50.5% | 47.0% | -3.6 |
| player | basic-box-m | 51.9% | 51.0% | 25.8% | -25.1 |
| slowking | slowking-scr | 48.7% | 51.5% | 53.2% | 1.7 |

## Largest gaps

| Deck | vs | Real | Bots | Real games |
|---|---|---|---|---|
| player | dragapult-ex | 55.5% | 16.1% | 541 |
| dragapult-ex | player | 44.5% | 83.9% | 541 |
| alakazam | basic-box | 61.4% | 90.6% | 198 |
| basic-box | alakazam | 38.6% | 9.4% | 198 |
| alakazam | player | 61.4% | 87.3% | 198 |
| player | alakazam | 38.6% | 12.7% | 198 |
| festival-lead-dipplin | player | 43.4% | 69.4% | 99 |
| player | festival-lead-dipplin | 56.6% | 30.6% | 99 |
| slowking | alakazam | 45.0% | 20.6% | 131 |
| alakazam | slowking | 55.0% | 79.4% | 131 |
| festival-lead-dipplin | dragapult-ex | 36.7% | 12.9% | 196 |
| dragapult-ex | festival-lead-dipplin | 63.3% | 87.1% | 196 |

## Every matchup

| Deck | vs | Real (games) | Bots (games) | Bots − real |
|---|---|---|---|---|
| alakazam | basic-box | 61.4% (198) | 90.6% (128) | 29.3 |
| alakazam | dragapult-ex | 43.6% (312) | 57.1% (126) | 13.6 |
| alakazam | festival-lead-dipplin | 42.2% (64) | 63.5% (126) | 21.3 |
| alakazam | festival-lead-seaking | 42.2% (64) | 54.0% (126) | 11.8 |
| alakazam | ns-zoroark-ex | 50.8% (126) | 66.7% (126) | 15.9 |
| alakazam | player | 61.4% (198) | 87.3% (126) | 25.9 |
| alakazam | slowking | 55.0% (131) | 79.4% (126) | 24.4 |
| basic-box | alakazam | 38.6% (198) | 9.4% (128) | -29.3 |
| basic-box | dragapult-ex | 55.5% (541) | 33.3% (126) | -22.2 |
| basic-box | festival-lead-dipplin | 56.6% (99) | 39.7% (126) | -16.9 |
| basic-box | festival-lead-seaking | 56.6% (99) | 49.2% (126) | -7.4 |
| basic-box | ns-zoroark-ex | 52.1% (166) | 38.1% (126) | -14.0 |
| basic-box | player | — | 58.7% (126) |  |
| basic-box | slowking | 44.0% (201) | 38.1% (126) | -5.9 |
| dragapult-ex | alakazam | 56.4% (312) | 42.9% (126) | -13.6 |
| dragapult-ex | basic-box | 44.5% (541) | 66.7% (126) | 22.2 |
| dragapult-ex | festival-lead-dipplin | 63.3% (196) | 87.1% (124) | 23.8 |
| dragapult-ex | festival-lead-seaking | 63.3% (196) | 77.4% (124) | 14.2 |
| dragapult-ex | ns-zoroark-ex | 43.7% (326) | 61.3% (124) | 17.6 |
| dragapult-ex | player | 44.5% (541) | 83.9% (124) | 39.4 |
| dragapult-ex | slowking | 46.2% (381) | 40.3% (124) | -5.9 |
| festival-lead-dipplin | alakazam | 57.8% (64) | 36.5% (126) | -21.3 |
| festival-lead-dipplin | basic-box | 43.4% (99) | 60.3% (126) | 16.9 |
| festival-lead-dipplin | dragapult-ex | 36.7% (196) | 12.9% (124) | -23.8 |
| festival-lead-dipplin | festival-lead-seaking | — | 54.8% (124) |  |
| festival-lead-dipplin | ns-zoroark-ex | 60.3% (58) | 75.8% (124) | 15.5 |
| festival-lead-dipplin | player | 43.4% (99) | 69.4% (124) | 25.9 |
| festival-lead-dipplin | slowking | 55.1% (68) | 59.7% (124) | 4.5 |
| festival-lead-seaking | alakazam | 57.8% (64) | 46.0% (126) | -11.8 |
| festival-lead-seaking | basic-box | 43.4% (99) | 50.8% (126) | 7.4 |
| festival-lead-seaking | dragapult-ex | 36.7% (196) | 22.6% (124) | -14.2 |
| festival-lead-seaking | festival-lead-dipplin | — | 45.2% (124) |  |
| festival-lead-seaking | ns-zoroark-ex | 60.3% (58) | 64.5% (124) | 4.2 |
| festival-lead-seaking | player | 43.4% (99) | 53.2% (124) | 9.8 |
| festival-lead-seaking | slowking | 55.1% (68) | 46.8% (124) | -8.4 |
| ns-zoroark-ex | alakazam | 49.2% (126) | 33.3% (126) | -15.9 |
| ns-zoroark-ex | basic-box | 47.9% (166) | 61.9% (126) | 14.0 |
| ns-zoroark-ex | dragapult-ex | 56.3% (326) | 38.7% (124) | -17.6 |
| ns-zoroark-ex | festival-lead-dipplin | 39.7% (58) | 24.2% (124) | -15.5 |
| ns-zoroark-ex | festival-lead-seaking | 39.7% (58) | 35.5% (124) | -4.2 |
| ns-zoroark-ex | player | 47.9% (166) | 71.0% (124) | 23.1 |
| ns-zoroark-ex | slowking | 55.4% (140) | 41.9% (124) | -13.4 |
| player | alakazam | 38.6% (198) | 12.7% (126) | -25.9 |
| player | basic-box | — | 41.3% (126) |  |
| player | dragapult-ex | 55.5% (541) | 16.1% (124) | -39.4 |
| player | festival-lead-dipplin | 56.6% (99) | 30.6% (124) | -25.9 |
| player | festival-lead-seaking | 56.6% (99) | 46.8% (124) | -9.8 |
| player | ns-zoroark-ex | 52.1% (166) | 29.0% (124) | -23.1 |
| player | slowking | 44.0% (201) | 45.2% (124) | 1.1 |
| slowking | alakazam | 45.0% (131) | 20.6% (126) | -24.4 |
| slowking | basic-box | 56.0% (201) | 61.9% (126) | 5.9 |
| slowking | dragapult-ex | 53.8% (381) | 59.7% (124) | 5.9 |
| slowking | festival-lead-dipplin | 44.9% (68) | 40.3% (124) | -4.5 |
| slowking | festival-lead-seaking | 44.9% (68) | 53.2% (124) | 8.4 |
| slowking | ns-zoroark-ex | 44.6% (140) | 58.1% (124) | 13.4 |
| slowking | player | 56.0% (201) | 54.8% (124) | -1.1 |
