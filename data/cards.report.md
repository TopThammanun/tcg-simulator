# รายงานข้อมูลการ์ด (เฟส 0)

สร้างเมื่อ 2026-11-18T17:48:56.792Z ด้วย `npm run cards` · ข้อมูลอยู่ที่ `data/cards.manifest.json`

## ด่านเฟส 0

- ✅ ข้อความการ์ดครบทุกใบ: 129 การ์ด จาก 143 print
- ✅ ทุกใบมีรูปหรือมีทางสำรอง: รูปจริง 142/143 print, ที่เหลือ 1 ใบแสดงเป็นกรอบข้อความ
- ✅ decklist ถูกกฎ (60 ใบ, ชื่อเดียวกันไม่เกิน 4, ACE SPEC ไม่เกิน 1, มี Basic)

## แหล่งรูป

| แหล่ง | จำนวน print |
| --- | --- |
| TCGdex | 128 |
| pokemontcg.io | 14 |
| รูปจาก print อื่นที่ข้อความเหมือนกัน | 0 |
| ไม่มีรูป (กรอบข้อความ) | 1 |

print ที่ไม่ได้ใช้รูปจาก TCGdex ของ print ตัวเอง:

- DLR-88 Talonflame ex: pokemontcg.io
- MEE-1 Grass Energy: pokemontcg.io (sve-1)
- MEE-9 Grass Energy: pokemontcg.io (sve-1)
- MEE-10 Fire Energy: pokemontcg.io (sve-2)
- MEE-2 Fire Energy: pokemontcg.io (sve-2)
- MEE-11 Water Energy: pokemontcg.io (sve-3)
- MEE-3 Water Energy: pokemontcg.io (sve-3)
- MEE-12 Lightning Energy: pokemontcg.io (sve-4)
- MEE-4 Lightning Energy: pokemontcg.io (sve-4)
- MEE-13 Psychic Energy: pokemontcg.io (sve-5)
- MEE-5 Psychic Energy: pokemontcg.io (sve-5)
- MEE-14 Fighting Energy: pokemontcg.io (sve-6)
- MEE-6 Fighting Energy: pokemontcg.io (sve-6)
- MEE-15 Darkness Energy: pokemontcg.io (sve-7)
- MEP-52 Grookey: ไม่มีรูป (กรอบข้อความ)

## จำนวนการ์ดที่ต้องเขียน

นับการ์ดไม่ซ้ำ (ชื่อเดียวกัน ข้อความเดียวกัน = ใบเดียว) ตามลำดับ milestones ในแผน "ใหม่" คือการ์ดที่ยังไม่มีในเด็คก่อนหน้า

| เด็ค | การ์ดไม่ซ้ำ | ใหม่ | ใหม่ที่ต้องเขียนเอฟเฟกต์ | สะสม |
| --- | --- | --- | --- | --- |
| Mega Kangaskhan / Ogerpon / Raging Bolt | 31 | 31 | 25 | 31 |
| Basic Box | 29 | 2 | 2 | 33 |
| Dragapult ex | 24 | 15 | 13 | 48 |
| Slowking Seek Inspiration | 24 | 13 | 13 | 61 |
| N's Zoroark ex | 27 | 14 | 13 | 75 |
| Alakazam Powerful Hand | 25 | 15 | 15 | 90 |
| Festival Lead (Seaking) | 27 | 16 | 15 | 106 |
| Festival Lead (Dipplin) | 27 | 2 | 2 | 108 |

รวม 129 การ์ด ต้องเขียนเอฟเฟกต์ 116 ใบ ที่เหลือเป็นพลังงานพื้นฐานหรือ Pokémon ที่มีแต่ท่าดาเมจตรง ๆ

## การ์ดที่แผนขอให้เช็คข้อความ

### Grookey (MEP-52)

Basic · 70 HP · Grass

- **[GG] Branch Poke** 40
- Weakness Fire ×2 · Resistance — · Retreat 1

### Grookey (TWM-14)

Basic · 70 HP · Grass

- **[G] Smash Kick** 10
- **[GG] Branch Poke** 30
- Weakness Fire ×2 · Resistance — · Retreat 1

### Applin (SCR-12)

Basic · 40 HP · Grass

- **[G] Spray Fluid** 20
- Weakness Fire ×2 · Resistance — · Retreat 1

### Applin (TWM-126)

Basic · 40 HP · Dragon

- **[C] Find a Friend**  — Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.
- **[GR] Rolling Tackle** 30
- Weakness — · Resistance — · Retreat 1

### Applin (TWM-17)

Basic · 40 HP · Grass

- **[G] Tumbling Attack** 10+ — Flip a coin. If heads, this attack does 20 more damage.
- Weakness Fire ×2 · Resistance — · Retreat 1

### Poké Pad (POR-81)

Item

> Search your deck for a Pokémon that doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)

### Growing Grass Energy (POR-86)

Special Energy

> As long as this card is attached to a Pokémon, it provides {G} Energy.
> The {G} Pokémon this card is attached to gets +20 HP.

### Slowking (SCR-58)

Stage1 (จาก Slowpoke) · 120 HP · Psychic

- **[PC] Seek Inspiration**  — Discard the top card of your deck, and if that card is a Pokémon that doesn't have a Rule Box, choose 1 of its attacks and use it as this attack. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)
- **[PPC] Super Psy Bolt** 120
- Weakness Darkness ×2 · Resistance Fighting -30 · Retreat 3

### Dragapult ex (TWM-130)

Stage2 (จาก Drakloak) · 320 HP · Dragon · Tera · 2 prize

- **[C] Jet Headbutt** 70
- **[RP] Phantom Dive** 200 — Put 6 damage counters on your opponent's Benched Pokémon in any way you like.
- Weakness — · Resistance — · Retreat 1

### N's Zoroark ex (JTG-98)

Stage1 (จาก N's Zorua) · 280 HP · Darkness · 2 prize

- **Ability: Trade** — You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.
- **[DD] Night Joker**  — Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.
- Weakness Grass ×2 · Resistance — · Retreat 2

### Alakazam (MEG-56)

Stage2 (จาก Kadabra) · 140 HP · Psychic

- **Ability: Psychic Draw** — Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. Draw 3 cards.
- **[P] Powerful Hand**  — Place 2 damage counters on your opponent's Active Pokémon for each card in your hand.
- Weakness Darkness ×2 · Resistance Fighting -30 · Retreat 1

### Seaking (PRE-21)

Stage1 (จาก Goldeen) · 110 HP · Water

- **Ability: Festival Lead** — If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon.
- **[C] Rapid Draw** 60 — Draw 2 cards.
- Weakness Lightning ×2 · Resistance — · Retreat 1

### Dipplin (TWM-18)

Stage1 (จาก Applin) · 80 HP · Grass

- **Ability: Festival Lead** — If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon.
- **[G] Do the Wave** 20× — This attack does 20 damage for each of your Benched Pokémon.
- Weakness Fire ×2 · Resistance — · Retreat 2

### Thwackey (TWM-15)

Stage1 (จาก Grookey) · 100 HP · Grass

- **Ability: Boom Boom Groove** — Once during your turn, if your Active Pokémon has the Festival Lead Ability, you may search your deck for a card and put it into your hand. Then, shuffle your deck.
- **[GG] Beat** 50
- Weakness Fire ×2 · Resistance — · Retreat 2

### Festival Grounds (TWM-149)

Stadium

> Each Pokémon that has any Energy attached (both yours and your opponent's) recovers from all Special Conditions and can't be affected by any Special Conditions.

## ชื่อเดียวกันแต่ข้อความต่างกัน

- **Dunsparce**: `dunsparce-jtg-120` (JTG-120) / `dunsparce-tef-128` (TEF-128)
- **Grookey**: `grookey-mep-52` (MEP-52) / `grookey-twm-14` (TWM-14)
- **Annihilape**: `annihilape-pbl-41` (PBL-41) / `annihilape-ssp-100` (SSP-100)
- **Applin**: `applin-scr-12` (SCR-12) / `applin-twm-126` (TWM-126) / `applin-twm-17` (TWM-17)

## TCGdex กับ pokemontcg.io ไม่ตรงกัน

ไม่มี

## ไม่มีใน pokemontcg.io

ข้อความยังมาจาก TCGdex ครบ แต่ subtypes (Tera, ACE SPEC) กับ rule box เช็คกับแหล่งที่สองไม่ได้

- MEE-13 Psychic Energy
- MEE-9 Grass Energy
- MEE-12 Lightning Energy
- MEE-14 Fighting Energy
- MEE-11 Water Energy
- MEE-10 Fire Energy
- MEE-15 Darkness Energy
- MEE-1 Grass Energy
- MEE-2 Fire Energy
- MEE-3 Water Energy
- MEE-4 Lightning Energy
- MEE-6 Fighting Energy
- MEE-5 Psychic Energy
- MEP-52 Grookey

## รหัสชุด → id ใน API

| Limitless | TCGdex | pokemontcg.io |
| --- | --- | --- |
| 30C | 30th-c (30th Classic Collection), 30th (30th Celebration) | me55 (30th Celebration), me55c (30th Celebration: Classic Collection) |
| ASC | me02.5 (Ascended Heroes) | me2pt5 (Ascended Heroes) |
| BLK | sv10.5b (Black Bolt) | zsv10pt5 (Black Bolt) |
| CRI | me04 (Chaos Rising) | me4 (Chaos Rising) |
| DLR | me06 (Delta Reign) | me6 (Delta Reign) |
| DRI | sv10 (Destined Rivals) | sv10 (Destined Rivals) |
| JTG | sv09 (Journey Together) | sv9 (Journey Together) |
| MEE | mee (Mega Evolution Energy) | — |
| MEG | me01 (Mega Evolution) | me1 (Mega Evolution) |
| MEP | mep (MEP Black Star Promos) | — |
| PBL | me05 (Pitch Black) | me5 (Pitch Black) |
| PFL | me02 (Phantasmal Flames) | me2 (Phantasmal Flames) |
| POR | me03 (Perfect Order) | me3 (Perfect Order) |
| PRE | sv08.5 (Prismatic Evolutions) | sv8pt5 (Prismatic Evolutions) |
| SCR | sv07 (Stellar Crown) | sv7 (Stellar Crown) |
| SFA | sv06.5 (Shrouded Fable) | sv6pt5 (Shrouded Fable) |
| SSP | sv08 (Surging Sparks) | sv8 (Surging Sparks) |
| TEF | sv05 (Temporal Forces) | sv5 (Temporal Forces) |
| TWM | sv06 (Twilight Masquerade) | sv6 (Twilight Masquerade) |
| WHT | sv10.5w (White Flare) | rsv10pt5 (White Flare) |
