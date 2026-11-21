# TCG Simulator

เว็บซ้อม matchup Pokémon TCG: เลือกเด็คของคุณ (เด็ค meta หรือวาง list เอง) แล้วเล่นกับบอทที่ใช้เด็คอันดับต้นของ meta
ตามกฎ Standard ในเบราว์เซอร์ ไม่มี backend ไม่ต้องสมัครสมาชิก เล่นจบแล้วทบทวนได้ว่าเทิร์นไหนเกมพลิก

หน้าเว็บเป็นภาษาไทย ชื่อการ์ดและข้อความบนการ์ดเป็นภาษาอังกฤษ

## ทำอะไรได้บ้าง

- **เล่นกับบอท** (`/play/`): เลือกเด็คของคุณกับคู่แข่ง หรือให้สุ่มคู่แข่งตามสัดส่วนที่เจอในทัวร์นาเมนต์จริง
  เล่นบนโต๊ะเหมือนของจริง: ลากการ์ดลงสนาม ค้นเด็คแล้วเห็นทั้งเด็ค เลือก Prize เอง ไม่มีตัวช่วยและไม่มีย้อน
  มีแอนิเมชัน เสียง (Web Audio) และคีย์ลัด (`E` จบเทิร์น, `A` ท่าโจมตีของ Active, `1`–`9` การ์ดในมือ, `Enter` ยืนยัน, `Esc` ปิด)
- **ทบทวนเกม** (`/review/`): ทุกเกมที่เล่นจบถูกเก็บไว้ในเครื่อง (IndexedDB) ดูกราฟ win% ทีละเทิร์น ความผิดพลาดที่ชัด
  บอทจะเล่นต่างจากคุณตรงไหนและเพราะอะไร แล้วเล่นต่อจากตำแหน่งนั้นใหม่ได้ export / import เกมเป็นไฟล์ได้
- **เด็ค** (`/decks/`): ดู list ของเด็ค meta ทุกเด็ค และเก็บ list ของคุณเอง (วางแบบ Limitless export) ระบบบอกว่าใบไหน engine ยังไม่รองรับ
- **บอทเล่นกันเองหลายพันเกม** (สคริปต์): ตาราง matchup พร้อม Wilson CI และ win rate ถ่วงตาม meta share

## เด็คของบอท

list มาจากทัวร์นาเมนต์ล่าสุดบน Limitless (`src/content/decks/*.md` แต่ละไฟล์บอกที่มาของ list ไว้ใน frontmatter)

| อันดับ | เด็ค | meta share |
| --- | --- | --- |
| 1 | Dragapult ex | 36.5% |
| 2 | Basic Box | 8.86% |
| 3 | Slowking Seek Inspiration | 7.62% |
| 4 | N's Zoroark ex | 7.29% |
| 5 | Alakazam Powerful Hand | 6.39% |
| 6 | Festival Lead (Dipplin / Seaking) | 5.7% |

`player.md` คือ list ที่สคริปต์ใช้เป็นฝั่งผู้เล่น (Mega Kangaskhan / Ogerpon / Raging Bolt) ไม่แสดงบนเว็บ

## บอท

มีบอทตัวเดียว ไม่มีระดับความยาก และเป็นเวอร์ชันที่วัดแล้วว่าเก่งที่สุดเสมอ (`src/bots/index.ts` `createBot()`):

1. **policy/value network** (`src/bots/learn/weights.json`) เห็นเฉพาะสิ่งที่ผู้เล่นฝั่งนั้นรู้ ให้คะแนนทุกท่าที่เล่นได้และประเมินว่าใครกำลังได้เปรียบ
   ฝึกสองขั้น: เลียนแบบบอทแบบกฎ แล้ว self-play PPO บน GPU
2. **look-ahead** (`learn/search.ts`) เอาท่าที่ policy ชอบที่สุดไม่กี่ท่า กับทาง KO ที่ตัววางแผนโจมตีหาเจอ เล่นต่อบนการ์ดที่ซ่อนซึ่งสุ่มใหม่หลายแบบ
   แล้วให้ value head ตัดสิน
3. บอทแบบกฎ (`core.ts`, `finisher.ts`, `plans/<deck>.ts`, `hard.ts`) ยังอยู่ ใช้เป็นครู คู่ซ้อม และตัววางแผน KO

บอทวางแผนบนการ์ดที่สุ่มใหม่จากข้อมูลสาธารณะเท่านั้น (`determinize()`) จึงไม่เห็นมือหรือเด็คของคุณ บนหน้าเล่นบอทคิดใน Web Worker

ผลการวัดและแผนพัฒนาบอทอยู่ใน [`BOT-RESEARCH.md`](BOT-RESEARCH.md) และ [`BOT-LEAP.md`](BOT-LEAP.md)
ส่วนระยะห่างระหว่างผล matchup ของบอทกับผลการแข่งจริงอยู่ใน [`data/meta/compare.md`](data/meta/compare.md)

## เริ่มใช้งาน

ต้องมี Node.js ≥ 22.12

```sh
npm install
npm run dev        # http://localhost:4321
```

ข้อมูลการ์ด (`data/cards.manifest.json`) กับ network ของบอทอยู่ใน repo แล้ว ไม่ต้องสร้างใหม่ก่อนเล่น

### คำสั่งหลัก

| คำสั่ง | ทำอะไร |
| --- | --- |
| `npm run dev` | dev server ที่ :4321 |
| `npm run build` | สร้างเว็บแบบ static ใน `dist/` |
| `npm test` | Vitest: manifest, กฎ, ทุกการ์ด, fuzz สั้น, บอท, สถิติ |
| `npm run test:e2e` | Playwright บน production build เล่นเกมตาม seed จนจบ |
| `npm run check` | `astro check` + `svelte-check` |
| `npm run cards` | สร้าง manifest การ์ดใหม่จาก decklist (`-- --refresh` = โหลดจาก API ใหม่) |
| `npm run fuzz -- --games 10000` | สุ่มท่าที่ถูกกฎเล่นกัน ตรวจ invariant หลังทุก action |
| `npm run sim -- --games 1000` | บอทเล่นกันเอง: list ของคุณกับทุกเด็คบอท (`--exp all` = การทดลองทั้ง 5 ข้อ) |
| `npx tsx scripts/show-game.ts <deckA> <deckB> [seed]` | อ่าน log ของเกมบอทหนึ่งเกม |
| `npx tsx scripts/meta/limitless.ts` | ดึงผลทัวร์นาเมนต์จริงจาก Limitless |
| `npx tsx scripts/meta/compare.ts` | เทียบ matchup ของบอทกับผลจริง → `data/meta/compare.md` |

คำสั่งทั้งหมด (gate ของแต่ละเฟส, การจูน, ตัววิเคราะห์) อยู่ใน [`AGENTS.md`](AGENTS.md)

### URL ที่ช่วยตอนพัฒนา

- `/play/?me=<slug>&opp=<slug>` เลือกเด็คไว้ล่วงหน้า, `&seed=<n>` ล็อกการแจกไพ่
- `/play/?watch=1&...` ให้บอทแบบกฎเล่นฝั่งคุณ (ใช้ใน e2e)
- `/play/?test=1` เปิด `window.__tcg` (`state()`, `history()`, `load(state)`)
- `/play/?resume=<id>&at=<index>` เล่นเกมที่บันทึกไว้ต่อจากตำแหน่งนั้น

## ฝึก network ของบอท (ไม่บังคับ)

ใช้ Python ใน `ml/.venv` กับ PyTorch แบบ CUDA (เครื่องที่ใช้ฝึกคือ RTX 5060 Ti) รันจากโฟลเดอร์หลักของ repo

```sh
python -m venv ml/.venv
ml/.venv/Scripts/pip install numpy torch --index-url https://download.pytorch.org/whl/cu130
```

ขั้นตอนหลัก:

```sh
npx tsx scripts/learn/gen.ts <config.json>                      # เล่นเกมบอททุก thread → shard ข้อมูลฝึก
ml/.venv/Scripts/python ml/train_bc.py --data .cache/learn/bc --out .cache/learn/bc.json   # เลียนแบบ
ml/.venv/Scripts/python ml/ppo.py --init .cache/learn/bc.json --dir .cache/learn/ppo       # self-play PPO (รันต่อได้)
ml/.venv/Scripts/python ml/match.py --a search:src/bots/learn/weights.json --b hard       # วัด A vs B ทุกคู่เด็ค ทั้งสองฝั่ง
npx tsx scripts/learn/parity.ts <net.json> <dir> && ml/.venv/Scripts/python ml/parity.py <net.json> <dir>   # TS = PyTorch
```

ระหว่าง self-play ท่าของ network คำนวณเป็น batch บน GPU (`ml/serve.py` ← `scripts/learn/batched.ts`)
network มี 3 รุ่นที่อ่าน input ชุดเดียวกัน: รุ่น 1–2 เป็น MLP (`model.ts` = `ml/common.py`) รุ่น 3 เป็น transformer (`model3.ts` = `ml/net3.py`)

## โครงสร้าง

```
src/
  engine/       กฎของเกม: apply(state, action) คืน state ใหม่; เอฟเฟกต์การ์ดใน effects/
  bots/         บอท: network + look-ahead (learn/), บอทแบบกฎ, Web Worker
  analysis/     ตัววิเคราะห์: win% ต่อเทิร์น, ทบทวนเทิร์น, ภัยเทิร์นหน้า
  review/       บันทึกเกม, replay, IndexedDB
  sim/          ตัวรันบอทเล่นกันเองและสถิติ
  ui/           helper ของหน้าเล่น, แอนิเมชัน (ui/anim/)
  components/   Svelte components
  pages/        /, /play/, /review/, /decks/
  content/decks decklist (Limitless export) + frontmatter
  data/         TypeScript ที่สคริปต์ หน้าเว็บ และ engine ใช้ร่วมกัน
scripts/        สคริปต์ Node (tsx): manifest การ์ด, fuzz, sim, gate, ข้อมูลฝึก, ข้อมูล meta
ml/             การฝึก network (PyTorch)
data/           manifest การ์ด (สร้างอัตโนมัติ), ผลทัวร์นาเมนต์จริง, บันทึกการฝึก
tests/          Vitest และ Playwright (tests/e2e/)
```

**Engine:** การเลือกกลางเอฟเฟกต์ throw `NeedChoice` กลายเป็น `state.pending` แล้ว action เดิมถูกรันใหม่จาก `pending.base` พร้อมคำตอบ
เอฟเฟกต์การ์ดอยู่ใน `effects/attacks.ts`, `abilities.ts`, `trainers.ts`, `energy.ts` ส่วน Ability แบบติดตัว, Tool และ Stadium
อ่านในจุดที่มีผลใน `rules.ts` / `combat.ts` ถ้าการ์ดที่มีข้อความเอฟเฟกต์ยังไม่มีโค้ดรองรับ `tests/engine/coverage.test.ts` จะไม่ผ่าน

### เพิ่มหรือแก้เด็ค

1. แก้หรือเพิ่มไฟล์ใน `src/content/decks/` (รูปแบบ Limitless export + frontmatter ตาม `src/data/deck-meta.ts`)
   การ์ดที่ list จริงเล่นแต่ยังไม่มีในไฟล์เด็คไหนใส่ใน `data/card-pool.txt`
2. `npm run cards` สร้าง manifest และ `data/cards.report.md` ใหม่
3. เขียนเอฟเฟกต์ของการ์ดใหม่ใน `src/engine/effects/` แล้ว `npm test` (coverage test จะบอกใบที่ยังขาด)

## ข้อมูลการ์ดและรูป

ข้อความและรูปการ์ดมาจาก [TCGdex](https://tcgdex.dev) เป็นหลัก และ [pokemontcg.io](https://pokemontcg.io) เป็นทางสำรอง
(`npm run cards` เก็บ response ไว้ใน `.cache/http`) หน้าเว็บโหลดรูปจากโฮสต์ของ API โดยตรง ถ้ารูปไหนโหลดไม่ได้จะแสดงเป็นกรอบข้อความแทน

## เอกสาร

| ไฟล์ | เนื้อหา |
| --- | --- |
| [`PLAN.md`](PLAN.md) | แผน เฟส และด่านของโปรเจกต์ |
| [`BOT-RESEARCH.md`](BOT-RESEARCH.md) | งานวิจัยและการสร้างบอทตัวเดียวที่เก่งที่สุด (network + look-ahead) |
| [`BOT-LEAP.md`](BOT-LEAP.md) | แผนทำให้บอทเก่งขึ้นแบบก้าวกระโดด (L0–L6) และบันทึกผล |
| [`BATTLE-UX.md`](BATTLE-UX.md) | backlog หน้าเล่น: ให้เหมือนเล่นบนโต๊ะจริง |
| [`ANIMATION-PLAN.md`](ANIMATION-PLAN.md) | แผนและงานวิจัยแอนิเมชัน |
| [`AGENTS.md`](AGENTS.md) | คำสั่งทั้งหมด โครงสร้างโค้ดโดยละเอียด และข้อตกลงของโปรเจกต์ |
| [`data/cards.report.md`](data/cards.report.md) | รายงานข้อมูลการ์ด: ใบไหนมาจากแหล่งไหน ใบไหนไม่มีรูป |
| [`data/training-log.md`](data/training-log.md) | บันทึกการทดลองฝึกบอทแบบกฎ |

## เวอร์ชัน

Astro ล็อกไว้ที่ 6.x เพราะเครื่องที่พัฒนาใช้ Node 22.16 แต่ Astro 7 ต้องการ Node ≥ 22.23.4 Astro 6 มี advisory ที่แก้เฉพาะใน 7.x
ก่อนโฮสต์สาธารณะให้อัปเกรด Node แล้ว `npm i astro@latest @astrojs/svelte@latest`

## หมายเหตุ

โปรเจกต์ส่วนตัวที่ไม่เกี่ยวข้องกับ The Pokémon Company, Nintendo, Creatures หรือ GAME FREAK ชื่อ Pokémon ชื่อการ์ด
และรูปการ์ดเป็นของเจ้าของลิขสิทธิ์ หน้าเว็บใช้สไตล์ของตัวเอง ไม่ใช้โลโก้หรือ trade dress ทางการ
