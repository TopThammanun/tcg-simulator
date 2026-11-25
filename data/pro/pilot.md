# How the pros pilot each deck, next to the bot

Pros: 297 games read off 24 broadcasts of the major events (`scripts/pro/streams.ts`, `trace.ts`) with both players named, read from
their first turn and 6 turns or more. Bot: the game's bot without look-ahead (each deck's expert), 8 games per deck pair, both seats.
Both: the board at the end of each own turn. The reader merges some turns (a turn whose panel light it missed joins the
ones around it: the pros' games read have fewer own turns than they had), so their "by own turn k" runs early, about a
turn; it misses about 0.1 Benched Pokémon per side; their Trainers are only those the stream showed big (lower bounds).
A difference is listed below only when the reader's errors would shrink it, not make it: fewer Pokémon in play or the
main Pokémon later for the pros, a Trainer the pros are shown playing more than the bot plays it.

## Where the bot parts from the pros

- Alakazam Powerful Hand: Pokémon in play over the game: pros 4.5, bot 5.4; a full Bench in 33% of the pros' own turns, 66% of the bot's.
- Basic Box: Pokémon in play over the game: pros 4.9, bot 5.6; a full Bench in 42% of the pros' own turns, 61% of the bot's.
- Dragapult ex: Pokémon in play over the game: pros 4.6, bot 5.2; a full Bench in 31% of the pros' own turns, 55% of the bot's.
- Festival Lead (Seaking): Pokémon in play over the game: pros 4.8, bot 5.4; a full Bench in 43% of the pros' own turns, 69% of the bot's.
- N's Zoroark ex: Pokémon in play after own turn 2: pros 3.6, bot 4.7 (the pros fewer).
- N's Zoroark ex: Pokémon in play after own turn 3: pros 4.3, bot 5.3 (the pros fewer).
- N's Zoroark ex: Pokémon in play over the game: pros 4.1, bot 5.3; a full Bench in 27% of the pros' own turns, 57% of the bot's.
- Slowking Seek Inspiration: Slowking in play by own turn 2: pros 44%, bot 83% (the pros later).
- Slowking Seek Inspiration: Slowking in play by own turn 3: pros 72%, bot 94% (the pros later).
- Slowking Seek Inspiration: Pokémon in play after own turn 3: pros 4.5, bot 5.6 (the pros fewer).
- Slowking Seek Inspiration: Pokémon in play over the game: pros 4.4, bot 5.6; a full Bench in 21% of the pros' own turns, 72% of the bot's.

## The pros' decks read

| Deck | Sides |
|---|---|
| Dragapult | 143 |
| Basic Box | 45 |
| Dragapult Dusknoir | 43 |
| Slowking | 39 |
| N's Zoroark | 37 |
| Alakazam Dudunsparce | 36 |
| Dragapult Blaziken | 31 |
| Hydrapple | 21 |
| Alakazam Dusknoir | 21 |
| Dhelmise | 19 |
| Dragapult Dudunsparce | 15 |
| Crustle | 14 |
| Rocket's Honchkrow | 13 |
| Festival Lead | 12 |
| Sharpedo Toxtricity | 12 |
| Talonflame Dusknoir | 10 |
| Lucario Hariyama | 8 |
| Lillie's Clefairy | 8 |
| Hop's Trevenant | 8 |
| Lopunny Dusknoir | 7 |
| Mega Excadrill | 7 |
| Ethan's Typhlosion | 6 |
| Rocket's Mewtwo | 6 |
| Raging Bolt Ogerpon | 4 |
| Greninja | 4 |
| Lopunny Dudunsparce | 4 |
| Cynthia's Garchomp | 3 |
| Seaking Festival Lead | 3 |
| Starmie Froslass | 3 |
| Diancie Dusknoir | 2 |
| Kangaskhan Bouffalant | 2 |
| Absol Audino | 2 |
| Okidogi Barbaracle | 2 |
| Beedrill | 2 |
| ? | 1 |
| Toucannon | 1 |

## Alakazam Powerful Hand

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 57 (5.5) | 224 (6.4) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.6 / 4.5 / 4.8 | 4.2 / 5.3 / 5.6 |
| Benched, end of own turn 1 / 2 | 2.6 / 3.5 | 3.2 / 4.3 |
| Alakazam in play by own turn 2 / 3 / 4 | 39% / 67% / 83% | 22% / 82% / 91% |
| First Prize by own turn 2 / 3 / 4 | 33% / 68% / 77% | 21% / 73% / 88% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.4 / 2.0 / 2.5 | 1.3 / 2.5 / 3.4 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.5 / 33% | 5.4 / 66% |
| Pokémon in play by own turn 2 (share of games) | Abra 79%, Kadabra 58%, Dunsparce 46%, Alakazam 39%, Duskull 35%, Genesect 25% | Abra 98%, Kadabra 87%, Dunsparce 84%, Fezandipiti ex 42%, Lillie's Clefairy ex 37%, Alakazam 22% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Hilda | 16% | 28% | 43% | 86% |
| Dawn | 18% | 21% | 57% | 95% |
| Gwynn | 12% | 21% | 0% | 0% |
| Buddy-Buddy Poffin | 19% | 19% | 68% | 85% |
| Dusk Ball | 14% | 16% | 0% | 0% |
| Boss's Orders | 5% | 11% | 9% | 67% |
| Lana's Aid | 4% | 11% | 0% | 0% |
| Poké Pad | 9% | 9% | 71% | 99% |

## Basic Box

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 45 (5.5) | 224 (5.7) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.2 / 4.3 / 4.9 | 2.9 / 4.2 / 5.5 |
| Benched, end of own turn 1 / 2 | 2.2 / 3.3 | 1.9 / 3.2 |
| Mega Kangaskhan ex in play by own turn 2 / 3 / 4 | 84% / 89% / 87% | 94% / 95% / 97% |
| First Prize by own turn 2 / 3 / 4 | 29% / 73% / 97% | 44% / 79% / 89% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.4 / 2.2 / 2.9 | 1.5 / 2.4 / 3.6 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.9 / 42% | 5.6 / 61% |
| Pokémon in play by own turn 2 (share of games) | Mega Kangaskhan ex 84%, Latias ex 82%, Teal Mask Ogerpon ex 67%, Meowth ex 51%, Lillie's Clefairy ex 33%, Wellspring Mask Ogerpon ex 31% | Mega Kangaskhan ex 94%, Teal Mask Ogerpon ex 75%, Latias ex 62%, Meowth ex 62%, Lillie's Clefairy ex 30%, Fezandipiti ex 22% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Cyrano | 13% | 18% | 51% | 80% |
| Ultra Ball | 7% | 18% | 49% | 87% |
| Crispin | 11% | 16% | 62% | 95% |
| Area Zero Underdepths | 4% | 9% | 30% | 77% |
| Boss's Orders | 2% | 9% | 12% | 54% |
| Energy Switch | 2% | 7% | 26% | 64% |
| Glass Trumpet | 0% | 7% | 1% | 41% |
| Lillie's Determination | 4% | 4% | 0% | 0% |

## Dragapult ex

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 232 (5.7) | 224 (6.4) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.5 / 4.4 / 4.6 | 3.7 / 5.0 / 5.3 |
| Benched, end of own turn 1 / 2 | 2.5 / 3.4 | 2.7 / 4.0 |
| Dragapult ex in play by own turn 2 / 3 / 4 | 16% / 49% / 65% | 0% / 66% / 85% |
| First Prize by own turn 2 / 3 / 4 | 19% / 33% / 58% | 2% / 24% / 52% |
| Prize cards taken by own turn 3 / 4 / 5 | 0.7 / 1.2 / 1.6 | 0.4 / 1.3 / 2.6 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.6 / 31% | 5.2 / 55% |
| Pokémon in play by own turn 2 (share of games) | Dreepy 84%, Drakloak 76%, Budew 65%, Munkidori 33%, Meowth ex 27%, Dunsparce 25% | Dreepy 100%, Drakloak 86%, Budew 62%, Munkidori 47%, Dunsparce 43%, Fezandipiti ex 35% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Buddy-Buddy Poffin | 8% | 12% | 73% | 91% |
| Lillie's Determination | 7% | 12% | 70% | 96% |
| Poké Pad | 9% | 12% | 72% | 97% |
| Crispin | 4% | 11% | 15% | 82% |
| Crushing Hammer | 7% | 10% | 58% | 94% |
| Boss's Orders | 4% | 9% | 14% | 70% |
| Dusk Ball | 6% | 9% | 0% | 0% |
| Judge | 4% | 9% | 9% | 32% |

## Festival Lead (Dipplin)

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 4 (4.0) | 224 (5.8) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.0 / 3.5 / 4.5 | 3.8 / 4.9 / 5.3 |
| Benched, end of own turn 1 / 2 | 2.0 / 2.5 | 2.8 / 3.9 |
| Dipplin in play by own turn 2 / 3 / 4 | 25% / 50% / 67% | 60% / 78% / 87% |
| First Prize by own turn 2 / 3 / 4 | 0% / 50% / 67% | 44% / 69% / 82% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.3 / 2.0 / 1.0 | 1.5 / 2.6 / 3.6 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 3.6 / 8% | 5.4 / 73% |
| Pokémon in play by own turn 2 (share of games) | Grookey 100%, Applin 75%, Goldeen 75%, Dipplin 25%, Thwackey 25% | Grookey 97%, Applin 91%, Thwackey 82%, Goldeen 68%, Dipplin 60%, Seaking 29% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Fighting Gong | 0% | 25% | 0% | 0% |
| Buddy-Buddy Poffin | 0% | 0% | 75% | 84% |
| Lillie's Determination | 0% | 0% | 73% | 88% |
| Festival Grounds | 0% | 0% | 68% | 87% |
| Poké Pad | 0% | 0% | 61% | 92% |

## Festival Lead (Seaking)

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 11 (5.8) | 224 (5.6) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 4.4 / 5.3 / 4.8 | 3.7 / 5.0 / 5.3 |
| Benched, end of own turn 1 / 2 | 3.4 / 4.3 | 2.7 / 4.0 |
| Seaking in play by own turn 2 / 3 / 4 | 45% / 64% / 80% | 40% / 57% / 69% |
| First Prize by own turn 2 / 3 / 4 | 9% / 45% / 70% | 40% / 64% / 78% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.0 / 1.2 / 2.2 | 1.3 / 2.4 / 3.3 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.8 / 43% | 5.4 / 69% |
| Pokémon in play by own turn 2 (share of games) | Grookey 82%, Goldeen 82%, Applin 73%, Thwackey 64%, Seaking 45%, Dipplin 45% | Grookey 96%, Applin 92%, Goldeen 73%, Thwackey 68%, Dipplin 54%, Seaking 40% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Gladion's Final Battle | 0% | 36% | 0% | 1% |
| Buddy-Buddy Poffin | 27% | 27% | 74% | 88% |
| Sacred Ash | 9% | 18% | 4% | 55% |
| Fighting Gong | 0% | 18% | 0% | 0% |
| Festival Grounds | 0% | 9% | 60% | 79% |
| Lillie's Determination | 9% | 9% | 74% | 86% |
| Boss's Orders | 0% | 9% | 10% | 61% |
| Poké Pad | 0% | 0% | 65% | 89% |
| Ultra Ball | 0% | 0% | 35% | 66% |

## N's Zoroark ex

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 37 (6.5) | 224 (6.3) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.4 / 3.6 / 4.3 | 3.7 / 4.7 / 5.3 |
| Benched, end of own turn 1 / 2 | 2.5 / 2.6 | 2.7 / 3.7 |
| N's Zoroark ex in play by own turn 2 / 3 / 4 | 62% / 73% / 79% | 79% / 89% / 94% |
| First Prize by own turn 2 / 3 / 4 | 32% / 54% / 67% | 11% / 40% / 68% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.0 / 1.6 / 1.8 | 0.6 / 1.4 / 2.4 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.1 / 27% | 5.3 / 57% |
| Pokémon in play by own turn 2 (share of games) | N's Zoroark ex 62%, N's Zorua 59%, Pecharunt ex 32%, Budew 22%, N's Reshiram 19%, Fezandipiti ex 19% | N's Zorua 97%, N's Zoroark ex 79%, N's Zekrom 66%, Pecharunt ex 38%, Tatsugiri 29%, N's Reshiram 29% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Lillie's Determination | 19% | 22% | 52% | 88% |
| Buddy-Buddy Poffin | 19% | 19% | 73% | 87% |
| Secret Box | 14% | 19% | 26% | 70% |
| Cyrano | 8% | 14% | 37% | 65% |
| Binding Mochi | 8% | 14% | 0% | 0% |
| Janine's Secret Art | 3% | 11% | 5% | 39% |
| Transformation Tome | 5% | 11% | 0% | 0% |
| N's PP Up | 8% | 8% | 22% | 95% |

## Slowking Seek Inspiration

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 39 (5.3) | 224 (6.0) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.2 / 4.1 / 4.5 | 3.8 / 5.1 / 5.6 |
| Benched, end of own turn 1 / 2 | 2.2 / 3.1 | 2.8 / 4.1 |
| Slowking in play by own turn 2 / 3 / 4 | 44% / 72% / 83% | 83% / 94% / 98% |
| First Prize by own turn 2 / 3 / 4 | 15% / 49% / 66% | 41% / 67% / 82% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.1 / 1.6 / 2.2 | 1.7 / 2.5 / 3.0 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.4 / 21% | 5.6 / 72% |
| Pokémon in play by own turn 2 (share of games) | Slowpoke 92%, Latias ex 87%, Mega Kangaskhan ex 69%, Slowking 44%, Meowth ex 23%, Lillie's Clefairy ex 21% | Slowpoke 99%, Latias ex 86%, Slowking 83%, Mega Kangaskhan ex 78%, Lillie's Clefairy ex 30%, Fezandipiti ex 28% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Secret Box | 13% | 18% | 30% | 68% |
| Ultra Ball | 8% | 13% | 58% | 83% |
| Wondrous Patch | 5% | 13% | 18% | 81% |
| Academy at Night | 5% | 13% | 71% | 92% |
| Lucky Helmet | 8% | 10% | 0% | 0% |
| Lillie's Determination | 0% | 8% | 82% | 95% |
| Ciphermaniac's Codebreaking | 5% | 8% | 32% | 84% |
| Dawn | 5% | 5% | 0% | 0% |
