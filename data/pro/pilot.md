# How the pros pilot each deck, next to the bot

Pros: 184 games read off 16 broadcasts of the major events (`scripts/pro/streams.ts`, `trace.ts`) with both players named, read from
their first turn and 6 turns or more. Bot: the game's bot without look-ahead (each deck's expert), 8 games per deck pair, both seats.
Both: the board at the end of each own turn. The reader merges some turns (a turn whose panel light it missed joins the
ones around it: the pros' games read have fewer own turns than they had), so their "by own turn k" runs early, about a
turn; it misses about 0.1 Benched Pokémon per side; their Trainers are only those the stream showed big (lower bounds).
A difference is listed below only when the reader's errors would shrink it, not make it: fewer Pokémon in play or the
main Pokémon later for the pros, a Trainer the pros are shown playing more than the bot plays it.

## Where the bot parts from the pros

- Alakazam Powerful Hand: Pokémon in play over the game: pros 4.8, bot 5.4; a full Bench in 34% of the pros' own turns, 66% of the bot's.
- Basic Box: Pokémon in play over the game: pros 5.1, bot 5.6; a full Bench in 46% of the pros' own turns, 61% of the bot's.
- N's Zoroark ex: Pokémon in play after own turn 2: pros 3.5, bot 4.7 (the pros fewer).
- N's Zoroark ex: Pokémon in play over the game: pros 4.4, bot 5.3; a full Bench in 28% of the pros' own turns, 57% of the bot's.
- Slowking Seek Inspiration: Slowking in play by own turn 2: pros 30%, bot 83% (the pros later).
- Slowking Seek Inspiration: Slowking in play by own turn 3: pros 59%, bot 94% (the pros later).
- Slowking Seek Inspiration: Pokémon in play after own turn 2: pros 4.0, bot 5.1 (the pros fewer).
- Slowking Seek Inspiration: Pokémon in play after own turn 3: pros 4.5, bot 5.6 (the pros fewer).
- Slowking Seek Inspiration: Pokémon in play over the game: pros 4.4, bot 5.6; a full Bench in 21% of the pros' own turns, 72% of the bot's.

## The pros' decks read

| Deck | Sides |
|---|---|
| Dragapult | 95 |
| Basic Box | 32 |
| Slowking | 27 |
| N's Zoroark | 23 |
| Dhelmise | 19 |
| Dragapult Dusknoir | 16 |
| Dragapult Blaziken | 16 |
| Alakazam Dudunsparce | 12 |
| Alakazam Dusknoir | 12 |
| Sharpedo Toxtricity | 12 |
| Hydrapple | 11 |
| Dragapult Dudunsparce | 10 |
| Festival Lead | 10 |
| Talonflame Dusknoir | 10 |
| Rocket's Honchkrow | 9 |
| Hop's Trevenant | 8 |
| Crustle | 7 |
| Lucario Hariyama | 5 |
| Lopunny Dusknoir | 4 |
| Raging Bolt Ogerpon | 3 |
| Mega Excadrill | 3 |
| Seaking Festival Lead | 3 |
| Rocket's Mewtwo | 3 |
| Starmie Froslass | 3 |
| Kangaskhan Bouffalant | 2 |
| Absol Audino | 2 |
| Okidogi Barbaracle | 2 |
| Ethan's Typhlosion | 2 |
| Greninja | 2 |
| Lillie's Clefairy | 2 |
| Cynthia's Garchomp | 1 |
| ? | 1 |
| Toucannon | 1 |

## Alakazam Powerful Hand

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 24 (4.9) | 224 (6.4) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.7 / 4.3 / 5.0 | 4.2 / 5.3 / 5.6 |
| Benched, end of own turn 1 / 2 | 2.7 / 3.3 | 3.2 / 4.3 |
| Alakazam in play by own turn 2 / 3 / 4 | 42% / 71% / 95% | 22% / 82% / 91% |
| First Prize by own turn 2 / 3 / 4 | 38% / 79% / 80% | 21% / 73% / 88% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.5 / 2.2 / 2.9 | 1.3 / 2.5 / 3.4 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.8 / 34% | 5.4 / 66% |
| Pokémon in play by own turn 2 (share of games) | Abra 92%, Kadabra 67%, Duskull 46%, Dunsparce 42%, Alakazam 42%, Fezandipiti ex 33% | Abra 98%, Kadabra 87%, Dunsparce 84%, Fezandipiti ex 42%, Lillie's Clefairy ex 37%, Alakazam 22% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Dawn | 17% | 21% | 57% | 95% |
| Hilda | 17% | 21% | 43% | 86% |
| Boss's Orders | 8% | 13% | 9% | 67% |
| Gwynn | 13% | 13% | 0% | 0% |
| Nighttime Mine | 8% | 8% | 0% | 0% |
| Night Stretcher | 0% | 8% | 0% | 0% |
| Buddy-Buddy Poffin | 8% | 8% | 68% | 85% |
| Sacred Ash | 4% | 4% | 2% | 63% |

## Basic Box

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 32 (5.4) | 224 (5.7) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.1 / 4.3 / 5.3 | 2.9 / 4.2 / 5.5 |
| Benched, end of own turn 1 / 2 | 2.1 / 3.3 | 1.9 / 3.2 |
| Mega Kangaskhan ex in play by own turn 2 / 3 / 4 | 81% / 88% / 85% | 94% / 95% / 97% |
| First Prize by own turn 2 / 3 / 4 | 31% / 78% / 96% | 44% / 79% / 89% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.6 / 2.2 / 3.0 | 1.5 / 2.4 / 3.6 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 5.1 / 46% | 5.6 / 61% |
| Pokémon in play by own turn 2 (share of games) | Mega Kangaskhan ex 81%, Latias ex 81%, Teal Mask Ogerpon ex 59%, Meowth ex 53%, Lillie's Clefairy ex 44%, Wellspring Mask Ogerpon ex 31% | Mega Kangaskhan ex 94%, Teal Mask Ogerpon ex 75%, Latias ex 62%, Meowth ex 62%, Lillie's Clefairy ex 30%, Fezandipiti ex 22% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Ultra Ball | 0% | 16% | 49% | 87% |
| Cyrano | 6% | 9% | 51% | 80% |
| Crispin | 9% | 9% | 62% | 95% |
| Glass Trumpet | 0% | 9% | 1% | 41% |
| Area Zero Underdepths | 3% | 9% | 30% | 77% |
| Energy Switch | 3% | 6% | 26% | 64% |
| Night Stretcher | 0% | 6% | 10% | 63% |
| Boss's Orders | 3% | 6% | 12% | 54% |

## Dragapult ex

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 137 (5.5) | 224 (6.4) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.5 / 4.5 / 4.9 | 3.7 / 5.0 / 5.3 |
| Benched, end of own turn 1 / 2 | 2.5 / 3.5 | 2.7 / 4.0 |
| Dragapult ex in play by own turn 2 / 3 / 4 | 12% / 49% / 68% | 0% / 66% / 85% |
| First Prize by own turn 2 / 3 / 4 | 10% / 23% / 52% | 2% / 24% / 52% |
| Prize cards taken by own turn 3 / 4 / 5 | 0.4 / 1.0 / 1.2 | 0.4 / 1.3 / 2.6 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.7 / 33% | 5.2 / 55% |
| Pokémon in play by own turn 2 (share of games) | Dreepy 90%, Drakloak 82%, Budew 71%, Munkidori 36%, Dunsparce 32%, Meowth ex 25% | Dreepy 100%, Drakloak 86%, Budew 62%, Munkidori 47%, Dunsparce 43%, Fezandipiti ex 35% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Crispin | 4% | 8% | 15% | 82% |
| Lillie's Determination | 3% | 7% | 70% | 96% |
| Buddy-Buddy Poffin | 6% | 7% | 73% | 91% |
| Judge | 4% | 7% | 9% | 32% |
| Crushing Hammer | 5% | 7% | 58% | 94% |
| Poké Pad | 5% | 7% | 72% | 97% |
| Night Stretcher | 4% | 5% | 18% | 87% |
| Dawn | 3% | 5% | 0% | 0% |

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
| Sides (own turns read per game) | 9 (5.4) | 224 (5.6) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 4.3 / 5.6 / 4.7 | 3.7 / 5.0 / 5.3 |
| Benched, end of own turn 1 / 2 | 3.3 / 4.6 | 2.7 / 4.0 |
| Seaking in play by own turn 2 / 3 / 4 | 44% / 67% / 75% | 40% / 57% / 69% |
| First Prize by own turn 2 / 3 / 4 | 0% / 44% / 75% | 40% / 64% / 78% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.1 / 1.4 / 2.6 | 1.3 / 2.4 / 3.3 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 5.1 / 43% | 5.4 / 69% |
| Pokémon in play by own turn 2 (share of games) | Thwackey 78%, Grookey 78%, Goldeen 78%, Applin 67%, Dipplin 56%, Seaking 44% | Grookey 96%, Applin 92%, Goldeen 73%, Thwackey 68%, Dipplin 54%, Seaking 40% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Gladion's Final Battle | 0% | 44% | 0% | 1% |
| Fighting Gong | 0% | 22% | 0% | 0% |
| Sacred Ash | 0% | 11% | 4% | 55% |
| Buddy-Buddy Poffin | 11% | 11% | 74% | 88% |
| Festival Grounds | 0% | 11% | 60% | 79% |
| Boss's Orders | 0% | 11% | 10% | 61% |
| Lillie's Determination | 0% | 0% | 74% | 86% |
| Poké Pad | 0% | 0% | 65% | 89% |
| Ultra Ball | 0% | 0% | 35% | 66% |

## N's Zoroark ex

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 23 (5.7) | 224 (6.3) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.4 / 3.5 / 4.3 | 3.7 / 4.7 / 5.3 |
| Benched, end of own turn 1 / 2 | 2.4 / 2.5 | 2.7 / 3.7 |
| N's Zoroark ex in play by own turn 2 / 3 / 4 | 74% / 83% / 90% | 79% / 89% / 94% |
| First Prize by own turn 2 / 3 / 4 | 26% / 43% / 67% | 11% / 40% / 68% |
| Prize cards taken by own turn 3 / 4 / 5 | 0.7 / 1.1 / 1.6 | 0.6 / 1.4 / 2.4 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.4 / 28% | 5.3 / 57% |
| Pokémon in play by own turn 2 (share of games) | N's Zoroark ex 74%, N's Zorua 70%, Pecharunt ex 39%, N's Reshiram 22%, Fezandipiti ex 22%, N's Zekrom 22% | N's Zorua 97%, N's Zoroark ex 79%, N's Zekrom 66%, Pecharunt ex 38%, Tatsugiri 29%, N's Reshiram 29% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Lillie's Determination | 13% | 17% | 52% | 88% |
| N's PP Up | 13% | 13% | 22% | 95% |
| Cyrano | 9% | 13% | 37% | 65% |
| Binding Mochi | 4% | 13% | 0% | 0% |
| Janine's Secret Art | 0% | 9% | 5% | 39% |
| Buddy-Buddy Poffin | 9% | 9% | 73% | 87% |
| Black Belt's Training | 0% | 9% | 0% | 19% |
| Secret Box | 4% | 9% | 26% | 70% |
| Team Rocket's Watchtower | 0% | 0% | 47% | 89% |

## Slowking Seek Inspiration

| | Pros | Bot |
|---|---|---|
| Sides (own turns read per game) | 27 (5.2) | 224 (6.0) |
| Pokémon in play, end of own turn 1 / 2 / 3 | 3.0 / 4.0 / 4.5 | 3.8 / 5.1 / 5.6 |
| Benched, end of own turn 1 / 2 | 2.0 / 3.0 | 2.8 / 4.1 |
| Slowking in play by own turn 2 / 3 / 4 | 30% / 59% / 76% | 83% / 94% / 98% |
| First Prize by own turn 2 / 3 / 4 | 7% / 48% / 64% | 41% / 67% / 82% |
| Prize cards taken by own turn 3 / 4 / 5 | 1.0 / 1.8 / 2.2 | 1.7 / 2.5 / 3.0 |
| Pokémon in play over the game (own turns 2 on): mean / share of turns with a full Bench | 4.4 / 21% | 5.6 / 72% |
| Pokémon in play by own turn 2 (share of games) | Slowpoke 89%, Latias ex 81%, Mega Kangaskhan ex 67%, Slowking 30%, Fezandipiti ex 22%, Meowth ex 19% | Slowpoke 99%, Latias ex 86%, Slowking 83%, Mega Kangaskhan ex 78%, Lillie's Clefairy ex 30%, Fezandipiti ex 28% |

| Trainer | Pros: by own turn 2 | Pros: in the game | Bot: by own turn 2 | Bot: in the game |
|---|---|---|---|---|
| Ultra Ball | 7% | 15% | 58% | 83% |
| Secret Box | 7% | 11% | 30% | 68% |
| Lillie's Determination | 0% | 11% | 82% | 95% |
| Wondrous Patch | 4% | 11% | 18% | 81% |
| Academy at Night | 4% | 11% | 71% | 92% |
| Dawn | 7% | 7% | 0% | 0% |
| Lucky Helmet | 4% | 7% | 0% | 0% |
| Ciphermaniac's Codebreaking | 4% | 7% | 32% | 84% |
