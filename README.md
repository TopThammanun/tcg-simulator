# TCG Simulator

เว็บซ้อม matchup Pokémon TCG: เลือกเด็คของคุณ (เด็ค meta หรือวาง list เอง) แล้วเล่นกับบอทที่ใช้เด็คอันดับต้นของ meta
ตามกฎ Standard ในเบราว์เซอร์ ไม่มี backend ไม่ต้องสมัครสมาชิก เล่นจบแล้วทบทวนได้ว่าเทิร์นไหนเกมพลิก

หน้าเว็บมีสองภาษา: ไทยที่ `/` และอังกฤษที่ `/en/` ชื่อการ์ดและข้อความบนการ์ดเป็นภาษาอังกฤษทั้งสองแบบ

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
   ฝึกด้วย machine learning: เลียนแบบบอทแบบกฎ แล้ว self-play PPO บน GPU เด็คบอทแต่ละเด็คมี network ของตัวเอง (ตัวเชี่ยวชาญ,
   `learn/experts/<deck>.json`) ส่วนเด็คที่ไม่มีใช้ตัวทั่วไป ขั้นตอนการฝึกอยู่ในหัวข้อ "บอทเรียนเล่นอย่างไร" ด้านล่าง
2. **look-ahead** (`learn/search.ts`) เอาท่าที่ policy ชอบที่สุดไม่กี่ท่า กับทาง KO ที่ตัววางแผนโจมตีหาเจอ เล่นต่อบนการ์ดที่ซ่อนซึ่งสุ่มใหม่หลายแบบ
   แล้วให้ value head ตัดสิน
3. บอทแบบกฎ (`core.ts`, `finisher.ts`, `plans/<deck>.ts`, `hard.ts`) ยังอยู่ ใช้เป็นครู คู่ซ้อม และตัววางแผน KO

บอทวางแผนบนการ์ดที่สุ่มใหม่จากข้อมูลสาธารณะเท่านั้น (`determinize()`) จึงไม่เห็นมือหรือเด็คของคุณ บนหน้าเล่นบอทคิดใน Web Worker

ผลการวัดและแผนพัฒนาบอทอยู่ใน [`BOT-RESEARCH.md`](BOT-RESEARCH.md), [`BOT-LEAP.md`](BOT-LEAP.md) และแผนรอบถัดไป [`BOT-NEXT.md`](BOT-NEXT.md)
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

## บอทเรียนเล่นอย่างไร: การฝึก model (ไม่บังคับ)

ไม่ต้องฝึกเองก่อนเล่น network ที่ฝึกแล้วอยู่ใน repo หัวข้อนี้อธิบายว่ามันมาจากไหน และถ้าจะฝึกใหม่ต้องทำอะไร

### นี่เรียกว่าการทำ model ไหม

ส่วนที่เป็นสมองของบอทใช่ เป็น machine learning แบบเดียวกับ AlphaZero (AI โกะและหมากรุก): neural network ตัวหนึ่ง (policy/value network)
ที่ฝึกขึ้นเองตั้งแต่ศูนย์ ขั้นแรกด้วย **imitation learning** (เลียนแบบบอทแบบกฎ) แล้วต่อด้วย **reinforcement learning** (เล่นกับตัวเองหลายล้านเกม
แล้วเรียนจากผลแพ้ชนะ ด้วยวิธี PPO) ไม่ใช่ LLM แบบ ChatGPT และไม่ได้ fine-tune model สำเร็จรูปของใคร network เล็ก (~840,000 parameter
ไฟล์ 4.5 MB) ฝึกด้วย PyTorch บน GPU ของเครื่องนี้ แล้วรันในเบราว์เซอร์ด้วยโค้ด TypeScript ของโปรเจกต์เอง (`model.ts`) ไม่ต้องมี server

ส่วนอื่นของโปรเจกต์เป็นซอฟต์แวร์ธรรมดาที่ไม่ได้เรียนอะไร: engine ที่บังคับกฎ (`src/engine/`) หน้าเว็บ บอทแบบกฎที่เป็นครู และตัววิเคราะห์ในหน้าทบทวน
(ซึ่งเรียกใช้ network ตัวเดียวกันเพื่อประเมิน win%)

| คำ | ในโปรเจกต์นี้ |
| --- | --- |
| model / network | ไฟล์ weights (`src/bots/learn/weights.json`, `experts/<deck>.json`) + โค้ดที่คำนวณ (`model.ts` ในเว็บ = `ml/common.py` ตอนฝึก) |
| policy (หัวเลือกท่า) | ให้คะแนนทุกท่าที่เล่นได้ในตอนนั้น บอทเล่นท่าที่ได้คะแนนสูงสุด |
| value (หัวประเมิน) | ทายโอกาสชนะของฝั่งที่กำลังเล่น ใช้ใน look-ahead และกราฟ win% ของหน้าทบทวน |
| ครู (teacher) | บอทแบบกฎ (`hard.ts`) หรือ network รุ่นก่อน ที่ให้ network ใหม่เลียนแบบ |
| self-play | network เล่นกับตัวเองและคู่ซ้อมอื่น เพื่อเก็บข้อมูลฝึกชุดใหม่ทุกรอบ |
| รอบ (iteration) | หนึ่งรอบของ PPO: เล่นเกมชุดหนึ่ง (960–9,600 เกม) แล้ว update network หนึ่งครั้ง |
| checkpoint | weights ที่บันทึกระหว่างฝึก (`eval-<รอบ>.json`) |
| ตัวเชี่ยวชาญ (expert) | network ที่ฝึกต่อให้เล่นเด็คเดียว |
| look-ahead | ตอนเล่นบนเว็บ ลองท่าที่ policy ชอบที่สุดไม่กี่ท่าบนการ์ดที่ซ่อนซึ่งสุ่มใหม่ แล้วให้ value ตัดสิน (ไม่ได้ฝึก ใช้ network ที่ฝึกแล้ว) |

### network เห็นอะไร และตอบอะไร

ทุกครั้งที่บอทต้องตัดสินใจ `encode.ts` แปลงสนามเป็นตัวเลขจากมุมของฝั่งที่เล่น:

- Pokémon ในสนามตัวละหนึ่ง token: การ์ด, HP, ดาเมจ, พลังงาน, สภาวะ, ตีได้แรงแค่ไหน, KO ตัวหน้าได้ไหม ฯลฯ
- การ์ดนอกสนามเป็นจำนวนต่อใบในแต่ละกอง การ์ดที่มองไม่เห็นเป็นยอดรวมเท่านั้น (มือ + เด็ค + Prize ของอีกฝ่ายเป็นกองเดียว)
  network จึงแอบดูไม่ได้ มี test ตรวจว่าสลับการ์ดที่ซ่อนแล้ว input เหมือนเดิม
- ค่าของทั้งเกม: เทิร์น, Prize ที่เหลือ, ใช้ Supporter หรือติดพลังงานไปแล้วหรือยัง ฯลฯ
- ท่าที่เล่นได้ท่าละหนึ่งแถว รวมการเลือกการ์ดกลางเอฟเฟกต์ (ทีละใบ)

network ตอบเป็นคะแนนต่อแถว (policy) กับโอกาสชนะ (value) จำนวนท่าเปลี่ยนทุกตา จึงให้คะแนนทีละแถวแทน output ขนาดตายตัว
รุ่น 2 (ตัวที่ใช้อยู่) สร้าง vector ของการ์ดจากคุณสมบัติที่พิมพ์บนการ์ด (`card-features.ts`) การ์ดใหม่หรือ list ที่เปลี่ยนจึงไม่ทำให้ขนาด network เปลี่ยน
(รุ่น 1–2 เป็น MLP: `model.ts` = `ml/common.py`; รุ่น 3 เป็น transformer: `model3.ts` = `ml/net3.py` ยังไม่ได้ใช้ในเว็บ)

### ภาพรวมขั้นตอน

```
 บอทแบบกฎ (ครู)
     │  1. เล่นกันเอง เก็บทุกการตัดสินใจ               scripts/learn/gen.ts
     ▼
 ข้อมูลฝึก (shard)
     │  2. เลียนแบบ: ทายท่าของครู และใครชนะ            ml/train_bc.py
     ▼
 network ตั้งต้น (เก่งพอ ๆ กับครู)
     │  3. self-play PPO: เล่น → เรียนจากผล → วน        ml/ppo.py
     ▼
 network ทั่วไป (เล่นได้ทุกเด็ค)                       → src/bots/learn/weights.json
     │  4. ฝึกต่อเด็คละตัว                              ml/ppo.py --focus
     │  5. ลีก: ตัวเชี่ยวชาญซ้อมกันเอง                   ml/league.py
     ▼
 ชุดตัวเชี่ยวชาญ (expert set)
     │  6. วัดกับตัวเดิมบนการแจกไพ่ชุดเดียวกัน            ml/match.py, ml/decks.py, ml/ladder.py
     │  7. ส่งเข้าเว็บ (float16)                         ml/experts.py ship
     ▼
 src/bots/learn/experts/<deck>.json
```

ทุกคำสั่งรันจากโฟลเดอร์หลักของ repo ผลระหว่างทางอยู่ใน `.cache/learn/` (ไม่อยู่ใน git) ผลวัดที่ต้องเก็บไว้อยู่ใน `data/learn/*.jsonl`

### 0. เตรียมเครื่อง

ต้องมี GPU ของ NVIDIA (เครื่องที่ใช้ฝึกคือ RTX 5060 Ti) กับ Python ใน `ml/.venv` และ PyTorch แบบ CUDA
ส่วนที่เล่นเกมใช้ CPU ทุก thread (ค่าเริ่ม 15 thread)

```sh
python -m venv ml/.venv
ml/.venv/Scripts/pip install numpy torch --index-url https://download.pytorch.org/whl/cu130
```

### 1. ให้ครูเล่นเกม เก็บเป็นข้อมูลฝึก

```sh
npx tsx scripts/learn/gen.ts ml/bc-config.json
```

`ml/bc-config.json` สั่งให้บอทยาก (`hard.ts`) เล่นกันเอง 12,000 เกม ครบทุกคู่เด็ค (รวม mirror) ทั้งสองฝั่งด้วยการแจกไพ่ชุดเดียวกัน
ทุกการตัดสินใจของผู้เล่นที่ตั้ง `"record": true` ถูกเขียนเป็นแถวใน `.cache/learn/bc/` (รูปแบบใน `scripts/learn/shard.ts`):
input ของ network, ท่าที่ครูเลือก และผลแพ้ชนะตอนจบเกม รอบแรกได้ 1.5 ล้านการตัดสินใจใน 17 นาที

ครูเป็นผู้เล่นแบบไหนก็ได้ที่ `gen.ts` รู้จัก (`hard`, `normal`, `net`, `search`, `bot`) รูปแบบ config อยู่ที่หัวไฟล์ `gen.ts`
รอบหลัง ๆ ใช้ network รุ่นก่อนเป็นครู และให้แต่ละฝั่งเล่น list จริงจากทัวร์นาเมนต์ 70% (`variants`) บอทจะได้ไม่เก่งแค่ list เดียว

### 2. เลียนแบบ (imitation learning)

```sh
ml/.venv/Scripts/python ml/train_bc.py --data .cache/learn/bc --out .cache/learn/bc.json
```

เป็น supervised learning ธรรมดา: policy ทายว่าครูเล่นท่าไหน value ทายว่าฝั่งนี้ชนะไหม แยกเกม 5% ไว้ตรวจ แล้วพิมพ์ % ที่ทายท่าตรงกับครูทุก epoch
รอบแรกทายตรง 83.9% ของการตัดสินใจที่ไม่เคยเห็น network ที่ได้เก่งพอ ๆ กับครูแต่ยังไม่เก่งกว่า (ชนะบอทยาก 43.6%) ขั้นนี้มีไว้ให้ self-play
เริ่มจากตัวที่เล่นเป็นแล้ว ไม่ต้องเริ่มจากสุ่มท่า (`--v2` / `--v3` เลือกรุ่นของ network)

### 3. self-play PPO (reinforcement learning)

```sh
ml/.venv/Scripts/python ml/ppo.py --init .cache/learn/bc.json --dir .cache/learn/ppo
```

แต่ละรอบมี 4 ขั้น:

1. **เล่น:** network เล่น 960–9,600 เกม โดยสุ่มท่าตามคะแนนของ policy (จึงได้ลองท่าใหม่ ๆ) กับคู่ซ้อมตามสัดส่วนใน `--mix`
   เช่น `self:0.5,old:0.15,normal:0.1,hard:0.25` = ตัวเอง 50%, checkpoint เก่าของตัวเอง 15% (กันลืมวิธีชนะแบบเก่า), บอทปกติ 10%, บอทยาก 25%
   ท่าของ network คำนวณเป็น batch บน GPU (`ml/serve.py` ← `scripts/learn/batched.ts`) ได้ราว 150–200 เกมต่อวินาที
2. **ให้คะแนนท่า:** ท่าในเกมที่ชนะได้เครดิตบวก เกมที่แพ้ได้ลบ แล้วปรับด้วย value ว่าท่านั้นดีกว่าที่คาดไว้แค่ไหน (advantage, GAE λ=0.95)
3. **update:** PPO ขยับ policy ไปทางท่าที่ดีกว่าที่คาด แต่ไม่ให้เปลี่ยนมากเกินในรอบเดียว (clip 0.2) และช่วง 60 รอบแรกมี KL ดึงไว้ใกล้ตัวที่เลียนแบบ
   value เรียนทายผลแพ้ชนะไปพร้อมกัน
4. **วัด:** ทุก 10 รอบ (`--eval-every`) network แบบเลือกท่าดีสุดเล่นกับคู่วัด (`--eval-vs`: บอทยาก หรือ network แช่แข็งที่ให้ผ่าน `--frozen`)
   แล้วบันทึก `eval-<รอบ>.json` กับผลใน `log.jsonl`

หยุดกลางทางได้ สั่งคำสั่งเดิมอีกครั้งก็รันต่อจาก `state.json` รุ่น 1 จากการเลียนแบบถึงรอบ 130 ใช้ราว 1.5 ชั่วโมง ชนะบอทยากจาก 43.6% เป็น 63.3%
(72.2% เมื่อมี look-ahead) ตัวเลือกที่ใช้บ่อย: `--overlap` เล่นเกมรอบถัดไประหว่างที่รอบนี้ฝึก, `--resign 0.03` ให้ฝั่งที่แพ้แน่ยอมแพ้ (เกมสั้นลง),
`--variants 0.7` เล่น list จริง, `--patience 50` หยุดเองเมื่อ eval ไม่ดีขึ้น 50 รอบ ดูทั้งหมดด้วย `--help`

### 4. ตัวเชี่ยวชาญรายเด็ค

network ทั่วไปเล่นได้ทุกเด็คแต่ไม่เก่งที่สุดสักเด็ค จึงฝึกต่อเด็คละตัว: network เล่นเด็คนั้นเสมอ (`--focus`) เจอคู่แข่งตาม meta share ของทัวร์นาเมนต์จริง

```sh
ml/.venv/Scripts/python ml/ppo.py --init src/bots/learn/weights.json --dir .cache/learn/x-<deck> --focus <deck> \
  --iters 300 --games 1920 --mix self:0.3,old:0.2,frozen:0.45,normal:0.05 --frozen src/bots/learn/weights.json \
  --vs-meta 0.4 --vs-weights player=0.1 --variants 0.7 --variants-a 0.2 --overlap --resign 0.03 --patience 50 \
  --eval-every 10 --eval-games 1920 --eval-vs frozen
ml/.venv/Scripts/python ml/experts.py best .cache/learn/x-<deck>      # checkpoint ที่ eval ดีสุด
ml/.venv/Scripts/python ml/experts.py assemble --out .cache/learn/experts --default src/bots/learn/weights.json \
  <deck>=<checkpoint> ...
```

ราว 2 ชั่วโมงต่อเด็ค ได้เพิ่ม +2 ถึง +32 จุดต่อเด็ค (Slowking จาก 32% เป็น 64%) ชุดตัวเชี่ยวชาญ (expert set) คือโฟลเดอร์ของ `<deck>.json`
กับ `default.json` สำหรับเด็คที่ไม่มีตัวเชี่ยวชาญและ list ที่ผู้เล่นวางเอง ทุกคำสั่งที่รับไฟล์ weights รับโฟลเดอร์นี้ได้ด้วย

### 5. ลีก

```sh
ml/.venv/Scripts/python ml/league.py --start .cache/learn/experts --root .cache/learn/league --rounds 2 --iters 120 \
  -- --epochs 2 --mb 4096 --lr 1e-4
```

ตัวเชี่ยวชาญแต่ละเด็คฝึกต่อกับชุดตัวเชี่ยวชาญของรอบก่อน (แช่แข็ง 60%) แทน network ทั่วไป ถ้าซ้อมกับคนขับเด็คที่อ่อน ก็จะเก่งแค่กับคนขับที่อ่อน
เด็คที่แพ้บ่อยถูกสุ่มมาเจอบ่อยขึ้น (PFSP) จบแต่ละรอบได้ชุดใหม่ใน `<root>/r<รอบ>/` ราว 5 ชั่วโมงต่อรอบ สองรอบได้เพิ่มเฉลี่ย +4.3 จุดต่อเด็ค

### 6. วัดผลก่อนรับ

เกมการ์ดมีดวงมาก ตัวใหม่ต้องชนะตัวเดิม**อย่างมีนัยสำคัญ**จึงจะรับ: เล่น 960–1,920 เกม ทุกคู่เด็ค ทั้งสองฝั่ง ด้วยการแจกไพ่ชุดเดียวกัน
ดูช่วงความเชื่อมั่น 95% (Wilson) และตั้งเกณฑ์ไว้ก่อนวัดทุกครั้ง

| คำสั่ง | วัดอะไร |
| --- | --- |
| `ml/match.py --a <A> --b <B>` | A vs B ทุกคู่เด็ค (ผู้เล่นเช่น `net:<ไฟล์>` network เดี่ยว, `search:<ไฟล์>` แบบหน้าเว็บ, `hard`) |
| `ml/decks.py --a net:<expert> --b net:<ชุด> --decks <deck>` | ตัวเชี่ยวชาญเล่นเด็คนั้นกับทุกเด็ค → `data/learn/decks.jsonl` |
| `ml/ladder.py play <A> <B>` / `ml/ladder.py table` | เก็บทุกแมตช์ใน `data/learn/ladder.jsonl` แล้วคำนวณ Elo ของทุกตัว |
| `npx tsx scripts/meta/compare.ts --weights <ชุด>` | matchup ของบอทห่างจากผลทัวร์นาเมนต์จริงแค่ไหน → `data/meta/compare.md` |
| `npx tsx scripts/learn/blunders.ts` | ทางชนะแน่และ KO ที่บอทพลาด |
| `npx tsx scripts/learn/deck-skills.ts` | บอทขับแต่ละเด็คอย่างไร: เทิร์นที่ได้โจมตี, Prize ต่อเทิร์น, คอมโบของ Slowking |

### 7. ส่งเข้าเว็บ

```sh
ml/.venv/Scripts/python ml/experts.py ship --set .cache/learn/league/r2   # → src/bots/learn/experts/*.json (float16)
cp <network ทั่วไปตัวใหม่> src/bots/learn/weights.json                    # เฉพาะเมื่อเปลี่ยนตัวทั่วไปด้วย
```

float16 ทำให้ไฟล์เหลือครึ่งเดียว (2.2 MB ต่อเด็ค) และเลือกท่าเดียวกับ float32 ตั้งแต่ 99.96% ขึ้นไป (`scripts/learn/half-check.ts`)
หน้าเล่นโหลดเฉพาะตัวเชี่ยวชาญของเด็คที่บอทใช้ใน Web Worker (`src/bots/experts.ts`) `--no-look-ahead <deck>` ให้เด็คนั้นเล่นโดยไม่คิดล่วงหน้า
(ใช้เมื่อ look-ahead ช่วยเด็คนั้นไม่ถึง 3 จุด และไม่ทำให้พลาด KO มากขึ้น) ก่อน commit ตรวจ:

- `npx tsx scripts/learn/parity.ts <net.json> <dir> && ml/.venv/Scripts/python ml/parity.py <net.json> <dir>`: TypeScript คำนวณตรงกับ PyTorch
  ถ้าไม่ตรง บอทในเว็บจะเล่นต่างจากตัวที่วัดไว้
- `npm test` และ `npm run test:e2e`
- `npx tsx scripts/review-gate.ts --games 600 --stability 120`: win% ในหน้าทบทวนยังตรงกับผลจริง

### เมื่อ list ของเด็คหรือกฎเปลี่ยน

```sh
ml/.venv/Scripts/python ml/refresh.py --set <ชุดเดิม> --decks <เด็คที่เปลี่ยน> --out <ชุดใหม่> [--ship]
```

ตัวเชี่ยวชาญของเด็คนั้นฝึกต่อจากตัวในชุด แล้ววัดคู่กับตัวเดิมบนการแจกไพ่ชุดเดียวกัน ตัวที่ดีกว่าเข้าชุดใหม่ ไม่ต้องฝึกใหม่ทั้งหมด
ถ้าเปลี่ยนสิ่งที่ network เห็น (`encode.ts`) `ml/common.py` ต้องตรงกับ `model.ts` และ network เก่าอ่าน input ใหม่ได้ด้วย `ppo.py --widen`
(input ใหม่เริ่มที่น้ำหนักศูนย์ จึงเล่นเหมือนเดิมก่อนแล้วค่อยเรียน)

### ตัวที่อยู่ในเว็บตอนนี้มาจากไหน

1. รุ่น 1: เลียนแบบบอทยาก 12,000 เกม แล้ว PPO ราว 540 รอบ (16–18 พ.ย. 2026)
2. รุ่น 2: เลียนแบบบอทในเกมตอนนั้น 12,000 เกมบน list จริง แล้ว PPO 600 รอบ และต่ออีก 60 รอบ (รอบละ 9,600 เกม) ด้วยเครื่องฝึกแบบ batch บน GPU
   ได้ "L2 รอบ 60" คือ `src/bots/learn/weights.json` (19–20 พ.ย.)
3. ตัวเชี่ยวชาญ 7 เด็ค: ฝึกจาก L2 รอบ 60 แล้วผ่านลีก 2 รอบ คือ `src/bots/learn/experts/` (21–24 พ.ย.) แบบหน้าเล่นชนะ L2 รอบ 60 ได้ 62.1%

ผลวัดของทุกขั้นและสิ่งที่ลองแล้วไม่ได้ผลอยู่ใน [`BOT-RESEARCH.md`](BOT-RESEARCH.md) (รุ่น 1), [`BOT-LEAP.md`](BOT-LEAP.md)
(เครื่องฝึกเร็ว, รุ่น 2–3) และ [`BOT-NEXT.md`](BOT-NEXT.md) (ตัวเชี่ยวชาญ, ลีก)

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
| [`BOT-NEXT.md`](BOT-NEXT.md) | แผนรอบถัดไป (N0–N6): ตัวเชี่ยวชาญรายเด็ค, input ที่บอทยังไม่เห็น, writeup ของทีม Kaggle ฉบับเต็ม |
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
รูปการ์ด สัญลักษณ์พลังงาน และเหรียญเป็นของเจ้าของลิขสิทธิ์ หน้าเว็บใช้สไตล์ของตัวเอง ไม่ใช้โลโก้หรือ trade dress ทางการ
