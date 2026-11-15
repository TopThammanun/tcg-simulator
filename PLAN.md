# แผนพัฒนา: เว็บจำลอง Matchup PTCG vs Top 5 Meta

Nov 14, 2026 · @Thammanun

> ฉบับนี้ export จาก Claude Docs เมื่อ 15 พ.ย. 2026 ฉบับที่แก้ล่าสุดอยู่ที่ https://claude.ai/artifact/YSAzuvDeHkWcaN7cfLKncJ แผนภาพในเอกสารต้นฉบับถูกแปลงเป็น Mermaid และตารางในไฟล์นี้

## เป้าหมายและขอบเขต

v1 คือเว็บที่คุณเล่น list ที่ให้ไว้ (Mega Kangaskhan / Ogerpon / Raging Bolt) กับบอทที่เล่นเด็ค top 5 ของ meta ตอนนี้ได้ครบตามกฎ พร้อมรูปการ์ดจริง หน้าเว็บทำด้วย Astro + Svelte v2 จะเพิ่มปุ่มแนะนำกับโหมดรันหลายพันเกมเพื่อดู win rate กับทั้ง meta

**ทำ**

- **ฝั่งคุณ:** list 60 ใบที่ให้ไว้ตามเดิม บน Limitless เด็คแบบนี้ใกล้กับ archetype ที่เรียกว่า Basic Box
- **ฝั่งบอท:** 5 เด็คแรกตาม meta share ในตารางข้างล่าง และใส่ Festival Lead (อันดับ 6) เป็นเด็คที่ 6 ได้ถ้าต้องการ
- โหมดที่ 1: คุณเล่นเองกับบอท / โหมดที่ 2: บอทเล่นกับบอทหลายพันเกม
- รูปการ์ดจริงจาก API ฟรี ถ้ารูปไหนโหลดไม่ได้จะแสดงเป็นกรอบข้อความแทน
- หน้าเว็บเป็นภาษาไทย ชื่อการ์ดและข้อความบนการ์ดเป็นภาษาอังกฤษ

**เด็คฝั่งบอท** (meta share จาก[หน้า meta ของ Limitless](https://limitlesstcg.com/decks) ณ 15 พ.ย. 2026 หน้าเว็บไม่ได้บอกช่วงเวลาชัด list อ้างอิงมาจาก Regional Gdańsk 31 ต.ค. ยกเว้น Festival)

| อันดับ | เด็ค | meta share | กลไกหลัก | list อ้างอิง |
| --- | --- | --- | --- | --- |
| 1 | [Dragapult ex](https://limitlesstcg.com/decks/284) | 36.50% | Phantom Dive ตีตัวหลักแล้วกระจายตัวนับดาเมจไป bench | [อันดับ 3](https://limitlesstcg.com/decks/list/29678) |
| 2 | [Basic Box](https://limitlesstcg.com/decks/339) | 8.86% | Ogerpon / Clefairy ใกล้เคียงเด็คคุณ เล่นเป็น mirror | [อันดับ 19](https://limitlesstcg.com/decks/list/31093) |
| 3 | [Slowking Seek Inspiration](https://limitlesstcg.com/decks/322) | 7.62% | Slowking ยืมท่าของการ์ดอื่นมาใช้ | [อันดับ 1](https://limitlesstcg.com/decks/list/30165) |
| 4 | [N's Zoroark ex](https://limitlesstcg.com/decks/320) | 7.29% | ยืมท่าของ N's Pokemon ตัวอื่น + ability จั่วการ์ด | [อันดับ 38](https://limitlesstcg.com/decks/list/31102) |
| 5 | [Alakazam Powerful Hand](https://limitlesstcg.com/decks/350) | 6.39% | ดาเมจตามจำนวนการ์ดในมือ | [อันดับ 9](https://limitlesstcg.com/decks/list/31085) |
| 6 (เสริม) | [Festival Lead](https://limitlesstcg.com/decks/336) | 5.70% | ตี 2 ครั้งต่อเทิร์น | [Nice อันดับ 1](https://www.limitlesstcg.com/decks/list/30783) |

กลไกในตารางเป็นภาพรวม ข้อความการ์ดจริงจะดึงมาตรวจในเฟส 0 ก่อนเขียนโค้ด

**ไม่ทำใน v1**

- ไม่รองรับการ์ดนอกเด็คในตารางข้างบน และยังไม่มีหน้าจัดเด็คแบบทั่วไป
- ไม่มีโหมดเล่นออนไลน์กับคนอื่น ไม่มีระบบบัญชี และไม่มี backend
- บอทไม่ได้เก่งระดับแข่ง เล่นตามกฎที่เขียนไว้เท่านั้น

**เกณฑ์ว่าเสร็จ (เป้าหมาย)**

- บอทเล่นกันเองจบ 1,000 เกมติดต่อกันได้โดย invariant ไม่พังเลยสักครั้ง
- บอทคิดเทิร์นละไม่เกิน 200 ms
- รัน 1,000 เกมเสร็จภายในประมาณ 1 นาทีบนโน้ตบุ๊ก

## รูปการ์ดจริง

มี API ฟรี 2 ตัวที่ให้รูปการ์ด คือ TCGdex ที่ไม่ต้องใช้ key กับ pokemontcg.io ที่ต้องขอ key ฟรี ข้อจำกัดคือหน้า artifact ของ Claude บล็อกรูปและ fetch จากเว็บภายนอก เวอร์ชันที่มีรูปจริงเลยต้องรันบนเครื่องคุณเอง หรือโฮสต์ฟรีบน GitHub Pages / Cloudflare Pages

| แหล่ง | ค่าใช้จ่าย / key | รูป | หมายเหตุ |
| --- | --- | --- | --- |
| [TCGdex](https://tcgdex.dev/faq) (ตัวหลัก) | ฟรี ไม่ต้องใช้ key | แยกโฮสต์ที่ assets.tcgdex.net มีไฟล์ความละเอียด high (webp) และ low | ชุมชนช่วยกันดูแลข้อมูล บางใบอาจยังไม่มีรูป |
| [pokemontcg.io](https://cardgrader.ai/blog/tcgplayer-api-alternatives) (สำรอง) | ฟรี ต้องขอ key | มี | ทีมงานหันไปทำ Scrydex แล้ว ชุดใหม่อาจอัปเดตช้า |
| [Scrydex](https://www.scrapingbee.com/blog/pokemon-card-api/) | เริ่ม $29 ต่อเดือน | มี | ไม่ใช้ เพราะไม่ฟรี |

**ยังไม่ได้เช็คจริง:** คำสั่งเรียก API ตรงจากที่นี่โดนบล็อก เลยยังยืนยันไม่ได้ว่ามีรูปครบทุกชุดที่ใช้หรือเปล่า ของทั้ง 7 เด็ค (ชุดตั้งแต่ TWM, TEF, SCR, SFA, JTG ไปจนถึง POR, CRI, PBL) เฟส 0 จะเช็คเรื่องนี้ก่อนเริ่มทำอย่างอื่น

**วิธีดึงรูป**

1. เขียนสคริปต์ `build-card-manifest` อ่าน decklist รูปแบบ Limitless แล้วหาการ์ดทีละใบจากรหัสชุดและเลขการ์ด
2. รหัสชุดของ Limitless (เช่น POR) ไม่ตรงกับ id ใน API จะสร้างตารางจับคู่จาก endpoint รายชื่อชุดของ API เอง ไม่เดาเอา
3. หาใน TCGdex ก่อน ถ้าไม่เจอค่อยไป pokemontcg.io ถ้ายังไม่เจออีก ให้ใช้รูปจากการ์ดชื่อเดียวกันที่พิมพ์ชุดอื่น (เช่น Night Stretcher ที่มีหลายชุด ข้อความเหมือนกัน)
4. บันทึกผลเป็น `cards.manifest.json` (ชื่อการ์ด, URL รูป high/low, ได้มาจากแหล่งไหน) พร้อมรายงานว่าการ์ดไหนไม่มีรูป
5. ตอนเล่นจะโหลดรูปจาก URL ตรง ๆ: รูป low ในมือและบนสนาม รูป high ตอนกดดูการ์ด ใช้ `loading="lazy"` แล้วปล่อยให้เบราว์เซอร์เก็บ cache เอง
6. รูปไหนโหลดไม่ได้ (ออฟไลน์ หรือเปิดใน artifact) จะสลับไปแสดงเป็นกรอบข้อความที่มีชื่อ HP และท่า เกมยังเล่นต่อได้

**ลิขสิทธิ์:** รูปการ์ดเป็นของ The Pokemon Company ใช้เป็นเครื่องมือส่วนตัวแบบไม่หากำไร ไม่เอาไฟล์รูปใส่ไว้ใน repo ให้เก็บแค่ URL แล้วโหลดตอนเปิดใช้ ส่วน CDN รูปของ Limitless ไม่ใช่ API สาธารณะ ไม่ควรดึงรูปจากตรงนั้น

## สถาปัตยกรรมและ tech stack

กฎทั้งหมดอยู่ใน engine ที่เดียว หน้าเว็บ บอท และโหมดรันหลายเกมเรียก engine ตัวเดียวกัน ผลเลยไม่มีทางขัดกัน ตัวเว็บไม่มี backend เป็นไฟล์ static ทั้งหมด

```mermaid
flowchart LR
  subgraph build["ตอน build (สคริปต์บนเครื่องคุณ)"]
    decks["Decklist 7 เด็ค<br/>ข้อความแบบ Limitless"] --> script["build-card-manifest<br/>หาข้อความ + URL รูป"]
  end
  api["TCGdex API<br/>สำรอง: pokemontcg.io"] -->|ข้อมูลการ์ด| script
  script -->|cards.manifest.json| engine
  subgraph browser["ในเบราว์เซอร์ ไม่มี backend"]
    engine["Engine (TypeScript)<br/>กฎ + เอฟเฟกต์การ์ด<br/>ดาเมจ, RNG มี seed"]
    ui["UI (Astro + Svelte)<br/>สนาม มือ log<br/>ปุ่มแนะนำ"]
    bots["บอท<br/>แผนประจำเด็ค / ฝั่งคุณ<br/>ใช้กับปุ่มแนะนำด้วย"]
    sim["Sim Workers<br/>รันหลายพันเกม<br/>สรุป win rate"]
    ui <-->|action / state| engine
    bots -->|เลือก move| engine
    sim -->|คุมทั้งสองฝั่ง| bots
    sim --> engine
  end
  api -->|โหลดรูปตอนเล่น| ui
```

โฮสต์เอง = มีรูปจริง · artifact ของ Claude = กรอบข้อความ

สคริปต์ตอน build ดึงข้อมูลการ์ดครั้งเดียวเก็บเป็น manifest ส่วนรูปจริงเบราว์เซอร์โหลดตรงจาก API ตอนเล่น

- **หน้าเว็บ: Astro + Svelte 5:** แต่ละหน้าเป็นไฟล์ static ส่วนที่ต้องโต้ตอบ (สนามเกม และโหมดรันหลายเกม) เป็น Svelte component ที่ฝังเป็น island
- **เครื่องมือ:** Node + npm, Vitest สำหรับ test (Astro build ด้วย Vite อยู่แล้ว ใช้ config เดียวกันได้) และ Playwright สำหรับ test หน้าเว็บ
- **engine ไม่ import อะไรจาก UI:** เป็น TypeScript ธรรมดา รันได้ทั้งใน Node (test และ sim จาก command line), ใน Svelte และใน Web Worker
- **state:** engine คืน state ใหม่ทุกครั้ง (ใช้ Immer ช่วยได้) ฝั่ง Svelte เก็บด้วย `$state.raw` เพื่อไม่ให้ Svelte ห่อ proxy ทั้ง object ใหญ่ แล้ว UI อัปเดตตามเอง undo และย้อนดู log ทำได้ง่าย

**แต่ละเครื่องมือใช้ตรงไหน**

| งาน | ใช้อะไร | หมายเหตุ |
| --- | --- | --- |
| ตั้งโปรเจกต์ | `npm create astro@latest` แล้ว `npx astro add svelte` | [integration ของ Astro รองรับ Svelte 5](https://docs.astro.build/de/guides/integrations-guide/svelte/) |
| dev / build | `npm run dev` / `npm run build` | build ออกมาเป็นไฟล์ static ใน `dist/` ไปวาง GitHub Pages ได้ |
| หน้าเกม | `<Game client:only="svelte" />` ใน `play.astro` | [ไม่ render ฝั่ง server ทำงานในเบราว์เซอร์อย่างเดียว](https://fitech101.aalto.fi/en/courses/designing-and-building-scalable-web-applications/part-4/7-astro-and-svelte) |
| decklist | Astro content collection (`src/content/decks/`) | หน้า /decks สร้างจากไฟล์ decklist ตอน build |
| test engine | Vitest | ใช้ config ของ Astro ผ่าน `getViteConfig()` |
| test หน้าเว็บ | Playwright | เล่นตาม seed จนจบเกมในเบราว์เซอร์จริง |
| สคริปต์ | `npx tsx scripts/build-card-manifest.ts`, `npx tsx scripts/sim.ts` | sim แบบ command line กระจายงานด้วย `worker_threads` ของ Node |
| ตรวจ type | `npx astro check` + `npx svelte-check` | ตรวจไฟล์ .astro และ .svelte |

**ข้อควรรู้:** ตัวแปร context ของ Svelte ส่งข้าม island ไม่ได้ ([ตัวอย่างปัญหานี้](https://github.com/ikikaiku/AstroJS-SvelteQuery)) เลยรวมสนาม มือ และ log ไว้ใน island เดียว ส่วน Web Worker ใช้รูปแบบ `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` ที่ Vite รองรับอยู่แล้ว

```text
astro.config.mjs            integrations: [svelte()]
src/pages/                  index.astro, play.astro, sim.astro, decks/[slug].astro
src/content/decks/          decklist ของคุณ + 6 เด็คบอท
src/components/             Game, Board, Hand, Log, CoachPanel, SimRunner (.svelte)
src/engine/                 core, damage, rng, cards/<ชื่อการ์ด>.ts
src/bots/                   core, plans/<เด็ค>.ts, player-policy, coach
src/sim/                    worker.ts, stats.ts
data/cards.manifest.json
scripts/build-card-manifest.ts
scripts/sim.ts              รันหลายพันเกมด้วย Node ไม่ต้องเปิดเบราว์เซอร์
tests/                      engine (Vitest), e2e (Playwright)
```

## โมเดลข้อมูลของ engine

engine เป็นฟังก์ชันบริสุทธิ์ `apply(state, action)` ที่คืน state ใหม่ ไม่รู้จัก UI เลย ส่วนที่ต้องสุ่ม (สับเด็ค โยนเหรียญ) ใช้ RNG ที่กำหนด seed เก็บไว้ใน state เลยเล่นเกมเดิมซ้ำและ undo ได้

```ts
type PlayerId = 'me' | 'bot';

interface PokemonSlot {
  stack: CardInst[];        // Basic อยู่ล่าง ตัวบนสุดคือร่างปัจจุบัน
  energy: CardInst[];
  tool?: CardInst;
  damage: number;
  playedOnTurn: number;     // ใช้เช็คกฎ evolve และ ability ที่ทำงานตอนลงจากมือ
  flags: { cantAttackNextTurn?: boolean; usedAbilities: string[] };
}

interface PlayerState {
  deck: CardInst[]; hand: CardInst[]; discard: CardInst[]; prizes: CardInst[];
  active?: PokemonSlot; bench: PokemonSlot[];
  turnFlags: { supporter: boolean; energyAttached: boolean; retreated: boolean };
}

interface GameState {
  turn: number; current: PlayerId;
  phase: 'setup' | 'main' | 'pending' | 'between' | 'over';
  players: Record<PlayerId, PlayerState>;
  stadium?: { card: CardInst; owner: PlayerId };
  pending?: PendingChoice;  // การเลือกที่ค้างอยู่กลางเอฟเฟกต์
  rng: number; log: LogEntry[]; winner?: PlayerId;
}

type Action =
  | { t: 'attachEnergy'; card: number; target: SlotRef }
  | { t: 'playTrainer'; card: number }
  | { t: 'evolve'; card: number; target: SlotRef }
  | { t: 'useAbility'; slot: SlotRef; ability: string }
  | { t: 'retreat'; to: number; discard: number[] }
  | { t: 'attack'; index: number }
  | { t: 'choose'; picks: number[] }
  | { t: 'endTurn' };
```

- **ลำดับเทิร์น:** จั่ว → ทำ action หลักสลับลำดับได้ → โจมตี (จบเทิร์น) → เช็คระหว่างเทิร์น → จัดการ KO และ prize → สลับฝั่ง
- **การเลือกกลางเอฟเฟกต์** (เช่น Ultra Ball ทิ้ง 2 ใบ, ค้นเด็ค, เป้า Boss, Festival Lead จะตีซ้ำไหม, KO แล้วเลือกตัวใหม่) เก็บเป็น `pending` พร้อมตัวเลือกที่ถูกกฎ แล้วคนหรือบอทตอบด้วย action `choose`
- **`legalActions(state)`** ใช้ร่วมกันระหว่าง UI (เปิด/ปิดปุ่ม) กับบอท (เลือก move) กฎจะอยู่ที่เดียว
- **ข้อมูลที่ซ่อน:** บอทได้เห็น `viewFor('bot', state)` ซึ่งซ่อนมือ เด็ค และ prize ของคุณ บอทจะไม่โกง
- **undo / replay:** เก็บ seed กับรายการ action ไว้ ถ้าอยากย้อนก็เล่นซ้ำจาก seed เดิมถึง action ก่อนหน้า ส่งให้เพื่อนดูเป็นไฟล์ JSON เล็ก ๆ ได้

## เอฟเฟกต์การ์ดที่ต้องเขียน

เด็คคุณกับ Festival รวมกันมีการ์ดไม่ซ้ำประมาณ 55 ชนิด เพิ่มเด็ค meta อีก 5 เด็คน่าจะเกิน 100 ชนิด แต่การ์ดหลักหลายใบใช้ซ้ำกันหลายเด็ค เช่น Lillie's Determination, Buddy-Buddy Poffin, Poke Pad และ Boss's Orders จำนวนจริงจะนับในเฟส 0 ข้อความการ์ดดึงจาก API ส่วนเอฟเฟกต์ต้องเขียนโค้ดทีละใบ ตารางแรกคือการ์ดยากจากเด็คคุณกับ Festival ตารางที่สองคือกลไกใหม่จากเด็ค meta

| ระดับ | การ์ด | สิ่งที่ต้องระวัง |
| --- | --- | --- |
| ยาก | Festival Lead (Goldeen, Seaking, Dipplin) | ตี 2 ครั้ง ถ้าครั้งแรก KO ต้องให้อีกฝั่งเลือก Active ใหม่ก่อนตีครั้งที่สอง และคิด prize ทีละครั้ง |
| ยาก | Area Zero Underdepths | bench สูงสุด 8 เมื่อมี Tera ในสนาม พอออกจากสนาม (หรือ Tera หมด) ทุกคนทิ้ง bench เหลือ 5 โดยเจ้าของเลือกเอง |
| ยาก | Rabsca, Shaymin, Tera Ogerpon, Mist Energy | การกันดาเมจหรือเอฟเฟกต์คนละแบบ ซ้อนกันได้ ต้องเช็คในขั้น "กันดาเมจ" ของลำดับคำนวณดาเมจ |
| ยาก | Wellspring Ogerpon, Fezandipiti, Iron Crown | ยิง bench (ต้องเจอการกันข้างบน) และ Twin Shotels ที่ไม่คิด weakness |
| ยาก | Mega Kangaskhan ex | กฎ Mega ex ให้ 3 prize, โยนเหรียญจนกว่าจะออกก้อย, Run Errand ใช้ได้เฉพาะตอนอยู่ Active และทั้งฝั่งใช้ได้ 1 ครั้งต่อเทิร์น |
| กลาง | Meowth ex, Chien-Pao, Iron Leaves | ability ที่ทำงานตอนลงจากมือไป bench เท่านั้น (ไม่ทำงานถ้าลงด้วย Poffin) |
| กลาง | Latias, Iron Crown, Bloodmoon Ursaluna, Lillie's Clefairy | ตัวปรับค่าตลอดเวลา: ค่า retreat, +20 ให้ Future, ลดค่าตีตาม prize, เปลี่ยน weakness |
| กลาง | Fezandipiti (Flip the Script), Thwackey, Gladion's Final Battle | ต้องจำว่าเทิร์นก่อนมี KO ไหม, ต้องเช็คว่า Active มี Festival Lead, ต้องเช็คว่าเป็นใบสุดท้ายในมือ |
| กลาง | Brave Bangle, Hero's Cape, Air Balloon, Glass Trumpet | Tool และ ACE SPEC (จำกัด 1 ใบต่อเด็ค) บางใบมีเงื่อนไขประเภทเป้าหมาย |
| ง่าย | Ultra Ball, Poffin, Poke Pad, Night Stretcher, Boss, Judge, Lillie's Determination, Crispin, Cyrano, Energy Switch, Secret Box, Tool Scrapper ฯลฯ | ค้นหา จั่ว สลับ ทิ้ง ตามข้อความตรง ๆ |

**กลไกใหม่จากเด็ค meta**

| เด็ค | กลไก | สิ่งที่ engine ต้องรองรับ |
| --- | --- | --- |
| Dragapult ex | ตีตัวหลักแล้ววางตัวนับดาเมจบน bench | แยก "ดาเมจ" กับ "การวางตัวนับดาเมจ" ออกจากกัน เพราะ weakness และตัวกันแต่ละแบบมีผลไม่เหมือนกัน |
| Slowking | ใช้ท่าของการ์ดอื่นแทนท่าตัวเอง | ท่าต้องเขียนเป็นฟังก์ชันที่ไม่ผูกกับตัวเจ้าของ เรียกจากตัวอื่นได้ |
| N's Zoroark ex | ยืมท่าของ N's Pokemon ตัวอื่น + ability จั่วการ์ด | ใช้ระบบยืมท่าเดียวกับ Slowking |
| Alakazam | ดาเมจขึ้นกับจำนวนการ์ดในมือ + ability จั่วของสายวิวัฒนาการ | การวางตัวนับดาเมจ + ability ที่ทำงานตอน evolve |
| Basic Box | การ์ดหลายใบตรงกับเด็คคุณ (Ogerpon, Clefairy, Latias ex, Energy Switch) | เขียนการ์ดใหม่น้อย เหมาะเป็นบอทตัวแรก |

ระบบยืมท่า (Slowking, Zoroark) และการวางตัวนับดาเมจ (Dragapult, Alakazam) ต้องออกแบบใส่ไว้ตั้งแต่เฟส 1 ไม่อย่างนั้นต้องรื้อ engine ทีหลัง

**ลำดับคำนวณดาเมจ** (ทำเป็นฟังก์ชันเดียวที่ทุกท่าใช้ร่วมกัน):

1. ดาเมจฐานของท่า รวมส่วน "+" หรือ "×" ของท่าเอง
2. ตัวเพิ่มดาเมจฝั่งตี (Bangle, Gladion, Cobalt Command, Kieran) เฉพาะตอนตี Active
3. weakness ×2 แล้ว resistance (ข้ามทั้งคู่ถ้าตี bench หรือท่าบอกให้ข้าม)
4. การกันดาเมจฝั่งรับ (Rabsca, Shaymin, Tera บน bench)
5. ใส่ตัวนับดาเมจ เทียบกับ HP (รวม Hero's Cape +100) แล้วเช็ค KO ตอนจบท่า

**สวิตช์ ruling:** เรื่องที่ไม่ชัดทำเป็นตัวเลือกในหน้าตั้งค่า เริ่มจาก "Twin Shotels ทะลุ Rabsca/Shaymin" (ค่าเริ่มต้น: ไม่ทะลุ จนกว่าจะได้คำตอบจาก judge)

**ต้องดึงข้อความก่อนเขียน:** Grookey (MEP 52), Applin, Poke Pad, Growing Grass Energy ยังไม่ได้เช็คข้อความจริง เฟส 0 จะดึงมาพร้อมกับรูป

## การออกแบบบอท

บอท v1 ทำงานตามลำดับความสำคัญที่เขียนไว้ในแต่ละเทิร์น และใช้ฟังก์ชันคำนวณดาเมจตัวเดียวกับ engine คำนวณล่วงหน้าว่าตัวเลือกไหน KO ได้ ใน v3 ค่อยเพิ่มการสุ่มเล่นล่วงหน้า (Monte Carlo) เฉพาะตอนตัดสินใจสำคัญ

**บอท Festival: ลำดับใน 1 เทิร์น**

1. ตั้งบอร์ด: ใช้ Poffin, Poke Pad, Ultra Ball หา Goldeen, Grookey, Applin, Rellor, Shaymin จน bench เกือบเต็ม
2. evolve เป็น Thwackey ให้เร็ว พอ Active มี Festival Lead ก็ใช้ Boom Boom Groove ค้นการ์ดที่ขาดมากที่สุด ลำดับ: Festival Grounds (ถ้ายังไม่มีในสนาม) → Gladion (ถ้าทำให้ KO ได้) → Boss (ถ้าได้ 2 prize) → Brave Bangle → พลังงาน
3. ลง Festival Grounds ทับ Area Zero ทุกครั้งที่ทำได้
4. คำนวณทุกทางเลือก (ตี Active ตรง ๆ / Boss ดึงตัวไหน / ใช้ Gladion ไหม) เลือกทางที่ได้ prize มากสุด ถ้าเท่ากันเลือกทางที่เหลือการ์ดในมือและเด็คมากกว่า
5. ถ้า Gladion ทำให้ KO ได้ ให้เล่นการ์ดอื่นออกจนมือเหลือ Gladion ใบเดียว (ใช้ Hand Trimmer ช่วย)
6. ถ้าไม่มีทาง KO ให้ตีวางดาเมจและใช้ Seaking จั่ว เก็บ Gladion ไว้เทิร์นหน้า

บอททุกเด็คใช้แกนเดียวกัน คือคำนวณดาเมจล่วงหน้าแล้วเลือกทางที่ได้ prize คุ้มที่สุด ส่วน "แผนประจำเด็ค" แยกเป็นไฟล์ละเด็ค (`src/bots/plans/<เด็ค>.ts`) ลำดับข้างบนคือแผนของ Festival ส่วนเด็คอื่นมีจุดสำคัญดังนี้

| เด็คบอท | สิ่งที่แผนต้องทำ |
| --- | --- |
| Dragapult ex | evolve Dreepy → Drakloak → Dragapult ให้ทันหลายตัว แล้ววางตัวนับดาเมจบน bench เพื่อเก็บ prize หลายตัวในเทิร์นต่อ ๆ ไป |
| Basic Box | เลือกตัวตีให้เข้ากับเป้าตรงหน้า และย้ายพลังงานด้วย Energy Switch |
| Slowking | เตรียมให้มีท่าแรงให้ยืมก่อนตี (เช็คข้อความ Seek Inspiration ในเฟส 0 ก่อนออกแบบ) |
| N's Zoroark ex | วาง N's Pokemon หลายแบบบน bench ไว้ให้ยืมท่า และใช้ ability จั่วทุกเทิร์น |
| Alakazam | สะสมการ์ดในมือให้มากก่อนเทิร์นที่ตี |
| Festival Lead | ตามลำดับข้างบน เลือก list Seaking หรือ Dipplin ได้ |

ตั้งค่าให้บอทสุ่มเด็คตาม meta share ได้ จะได้เจอ Dragapult บ่อยที่สุดเหมือนในทัวร์จริง

**บอทฝั่งคุณ** (ใช้ในโหมดรันหลายพันเกมและปุ่มแนะนำ) ตั้งค่าได้ตามแผนที่คุยกันไว้:

| ตัวเลือก | ค่าที่เลือกได้ |
| --- | --- |
| การใช้ Area Zero | เก็บไว้ทับ Grounds / ลงตั้งแต่แรก |
| จำนวนตัวบน bench สูงสุด | 5 / 8 |
| Meowth ex | ใช้ ability แล้วทิ้งตอน Area Zero ออก / เก็บไว้บน bench |
| ตัวตีหลัก | Teal Ogerpon / Tauros / Raging Bolt / เลือกอัตโนมัติ |
| Kangaskhan + Hero's Cape เป็นกำแพง | เปิด / ปิด |

**ระดับความยาก:** ง่าย (สุ่ม move ที่ถูกกฎบวกกฎพื้นฐาน), ปกติ (ลำดับข้างบน), ยาก (ลำดับข้างบน + สุ่มเล่นล่วงหน้าตอนเลือกเป้าหมายหรือเลือก Supporter โดยสุ่มมือที่มองไม่เห็นของคุณหลายแบบ)

## UI/UX

ทั้งเกมอยู่ในหน้าเดียว แบ่งเป็นสนาม (บนเป็นบอท ล่างเป็นคุณ), แถบมือด้านล่าง และแผงด้านขวาสำหรับ log กับคำแนะนำ

- **สนาม:** Active ใหญ่, bench 5–8 ช่อง, ตัวนับดาเมจ, พลังงานเป็นไอคอนสี, ป้าย Tool, Stadium อยู่กลางสนาม, prize และจำนวนใบในเด็ค/กองทิ้งของทั้งสองฝั่ง กดกองทิ้งเพื่อดูรายการได้
- **มือ:** แสดงรูป low กดการ์ดแล้วเลือกเป้าหมาย (บนคอมลากวางได้ด้วย) การ์ดที่ใช้ไม่ได้ในตอนนั้นจะจางลงตาม `legalActions`
- **หน้าต่างเลือกการ์ด:** ตอนค้นเด็คหรือเลือกทิ้ง แสดงการ์ดเรียงตามประเภท บอกจำนวนที่ต้องเลือก
- **ดูการ์ด:** กดค้างหรือคลิกขวา เปิดรูป high พร้อมข้อความภาษาอังกฤษและหมายเหตุภาษาไทย
- **Log:** ทุก action เป็นภาษาไทย เช่น "บอทใช้ Gladion's Final Battle — Seaking ตี 170 สองครั้ง" กดที่บรรทัดไหนก็ย้อนดูสนามตอนนั้นได้
- **แผงข้อมูลคู่แข่ง:** นับ Festival Grounds, Boss และ Gladion ที่เขาใช้ไปแล้ว พร้อมจำนวนการ์ดในมือเขา ใช้แค่ข้อมูลที่เปิดเผยอยู่แล้วในกองทิ้ง ไม่แอบดูมือ
- **ปุ่มแนะนำ (v2):** แสดง 3 ทางเลือกพร้อมเหตุผล เช่น "เขาเหลือ 2 ใบในมือ เสี่ยงโดน Gladion → เอา Tauros ขึ้น Active"
- **ตั้งค่า:** seed, ความเร็วบอท, list บอท, สวิตช์ ruling
- **มือถือ:** เลย์เอาต์แนวตั้ง การ์ดเล็กลง แตะแทนการลาก

**เลือกคู่แข่ง:** เลือกเด็คบอทจาก 6 เด็ค หรือ "สุ่มตาม meta share" ระหว่างเกมแสดงแค่ชื่อ archetype เหมือนเจอในทัวร์จริง จบเกมแล้วค่อยเปิดดู list เต็มที่บอทใช้

## โหมดรันหลายพันเกม

เลือกกลยุทธ์ A กับ B (หรือ list A กับ B) แล้วรันทั้งสองแบบด้วยชุด seed เดียวกัน แต่ละคู่ได้มือเริ่มและลำดับเด็คเหมือนกัน ผลต่างที่เห็นจะมาจากกลยุทธ์ ไม่ใช่ดวง แยก RNG เป็นหลายสาย (สับเด็คแต่ละฝั่ง และโยนเหรียญ) การตัดสินใจที่ต่างกันจะได้ไม่ทำให้ลำดับการ์ดที่จั่วเพี้ยน

**ตาราง matchup:** ทุกการทดลองรันกับเด็คบอทครบ 6 เด็ค ได้ win rate แยกต่อเด็ค แล้วถ่วงน้ำหนักด้วย meta share เป็น "win rate คาดหวังใน meta" ตัวเลขนี้สำคัญกว่าผลรายเด็ค เช่น list ที่ชนะ Festival มากขึ้นแต่แพ้ Dragapult มากขึ้น อาจแย่ลงโดยรวม เพราะ Dragapult มี share 36.50%

**ค่าที่รายงาน**

- win rate พร้อมช่วงความเชื่อมั่น 95% (รัน 1,000 เกม ช่วงกว้างประมาณ ±3 จุดเปอร์เซ็นต์)
- เกมจบเทิร์นที่เท่าไรโดยเฉลี่ย
- prize ที่บอทได้ไป แยกตามตัวที่โดน KO (Meowth ex, Kangaskhan, Ogerpon ฯลฯ)
- จำนวนเทิร์นที่บอทตีได้ 2 ครั้ง และสัดส่วนเกมที่ Festival Grounds ของเขาหมดก่อนจบเกม
- สัดส่วนเกมที่บอทใช้ Gladion ได้ และสัดส่วน mulligan ของทั้งสองฝั่ง

**การทดลองชุดแรก** (มาจากคำแนะนำเรื่อง matchup ที่คุยกัน):

1. Area Zero เก็บไว้ทับ Grounds เทียบกับลงตั้งแต่แรก
2. list เดิม เทียบกับ +1 Fire Energy −1 Grass Energy
3. list เดิม เทียบกับ −1 Lillie's Clefairy ex +1 Paldean Tauros
4. ใช้ Kangaskhan + Hero's Cape เป็นกำแพง เทียบกับไม่ใช้
5. bench สูงสุด 5 เทียบกับ 8

**การทำงาน:** กระจายเกมไป Web Worker หลายตัวตามจำนวนคอร์ CPU มีแถบความคืบหน้า ผลดาวน์โหลดเป็น CSV ได้ (ใน artifact ใช้ปุ่มคัดลอกแทน เพราะดาวน์โหลดไม่ได้) แต่ละเกมที่น่าสนใจกดเปิด replay ดูทีละเทิร์นได้จาก seed

## Milestones

คุณจะเล่นกับบอทได้จริงหลังผ่านด่านเฟส 2 (v1) จากนั้นเพิ่มเด็คบอททีละเด็คจนครบ top 5 แล้วค่อยทำปุ่มแนะนำกับโหมดรันหลายพันเกม แต่ละเฟสเริ่มได้เมื่อเฟสก่อนหน้าผ่านด่านแล้ว

| เฟส | สิ่งที่สร้าง | ด่านที่ต้องผ่านก่อนไปเฟสถัดไป |
| --- | --- | --- |
| 0 · ข้อมูลการ์ด | manifest รูป + ข้อความการ์ดทั้ง 7 เด็ค, รายงานว่าใบไหนไม่มีรูป | ทุกใบมีรูปหรือมีทางสำรอง, ข้อความการ์ดครบทุกใบ |
| 1 · Engine: กฎ + การ์ดเด็คคุณ | กฎพื้นฐาน + ระบบยืมท่า + ตัวนับดาเมจ, Vitest: scenario + invariant + fuzz | scenario test ผ่านทั้งหมด, fuzz 10,000 เกม invariant ไม่พัง |
| 2 · หน้าเล่นเอง + บอท Basic Box | สนาม มือ log รูปการ์ดจริง, บอทตัวแรกเป็น mirror ใช้การ์ดร่วมกับเด็คคุณ | **v1:** เล่นจบเกมกับบอทได้, บอทคิดเทิร์นละไม่เกิน 200 ms |
| 3 · บอท Dragapult ex | 36.50% ของ meta จึงทำเป็นเด็คที่สอง, Phantom Dive + วางตัวนับดาเมจ | **v1.1:** เล่นได้ 2 เด็ค, เด็คละ 1,000 เกม invariant ไม่พัง |
| 4 · Slowking, N's Zoroark, Alakazam | เพิ่มทีละเด็ค ผ่านด่านเดียวกันทุกเด็ค, Festival Lead เป็นเด็คที่ 6 ถ้าเลือกไว้ | **v1.2:** ครบ top 5, เด็คละ 1,000 เกม invariant ไม่พัง |
| 5 · ปุ่มแนะนำ + รันหลายพันเกม | บอทฝั่งคุณที่ตั้งค่ากลยุทธ์ได้, ตาราง matchup + win rate ถ่วงตาม meta | **v2:** 1,000 เกมเสร็จในราว 1 นาที, ได้ผลการทดลองครบ 5 ข้อ |
| 6 · บอทเก่งขึ้น + แก้ list | Monte Carlo ตอนตัดสินใจสำคัญ, แก้ decklist ในหน้าเว็บ | **v3:** บอทยากชนะบอทปกติเกิน 50% ใน 1,000 เกม |

บอท Basic Box มาก่อนเพราะใช้การ์ดหลายใบร่วมกับเด็คคุณ ทำให้ได้เกมที่เล่นได้จริงเร็วที่สุด Dragapult ตามมาเพราะเจอบ่อยที่สุด เฟส 1 กับ 4 ใหญ่ที่สุดเพราะต้องเขียนการ์ดจำนวนมาก แผนนี้ไม่ได้ใส่วันที่เพราะขึ้นกับเวลาที่คุณมี ถ้าให้ผมทำด้วย ผมจะส่งงานให้คุณเช็คทีละเฟส

## การทดสอบ

ทุกการ์ดมี unit test อย่างน้อย 1 ชุด ตัวเลขในตารางดาเมจ matchup ที่คุยกันไว้ก็เป็น scenario test ด้วย ถ้า engine คำนวณไม่ตรง test จะพังทันที รันด้วย Vitest ส่วนหน้าเว็บทดสอบด้วย Playwright โดยเล่นตาม seed ที่กำหนดจนจบเกม แล้วเช็คว่าหน้าจอตรงกับ state ของ engine

**Scenario test ชุดแรก**

- Seaking + Brave Bangle ตี ex ได้ 180 ต่อเทิร์น ถ้าใช้ Gladion ด้วยได้ 340
- Dipplin ที่ bench เต็ม 5 ตัว + Bangle ตีได้ 260 ต่อเทิร์น
- Kangaskhan + Hero's Cape (400) รอด Seaking + Gladion (340)
- Paldean Tauros ตี Stage 1 ได้ 180 แต่ตี Basic ได้ 90
- Festival Lead: ตีครั้งแรก KO → อีกฝั่งเลือก Active ใหม่ → ครั้งที่สองตีตัวใหม่ และไม่มี Festival Grounds = ตีได้ครั้งเดียว
- Thwackey ค้นการ์ดได้แม้ไม่มี Festival Grounds ขอแค่ Active มี Festival Lead
- Gladion เล่นไม่ได้ถ้าไม่ใช่ใบสุดท้ายในมือ และใช้ Boss กับ Gladion ในเทิร์นเดียวกันไม่ได้
- Area Zero ออกจากสนาม → ฝั่งที่มี bench เกิน 5 เลือกทิ้งเองจนเหลือ 5
- Rabsca หรือ Shaymin อยู่ในสนาม → Wellspring Ogerpon และ Fezandipiti ยิง bench ไม่เข้า

**เพิ่มทุกครั้งที่เพิ่มเด็คบอท:** Phantom Dive วางตัวนับดาเมจบน bench ครบตามที่การ์ดบอก, ท่าที่ยืมมา (Slowking, Zoroark) คิด weakness ตามตัวที่ใช้ท่า ไม่ใช่ตัวเจ้าของท่า, ดาเมจของ Alakazam เปลี่ยนตามจำนวนการ์ดในมือตอนตี แต่ละเด็คต้องผ่าน fuzz 1,000 เกมก่อนเปิดให้เล่น

**Invariant ที่เช็คหลังทุก action** (เปิดในโหมดทดสอบและรันหลายเกม): การ์ดแต่ละฝั่งรวมกันต้องได้ 60 ใบ, ไม่มีการ์ดใบเดียวอยู่ 2 ที่, bench ไม่เกินขีดจำกัด, Supporter และการติดพลังงานไม่เกิน 1 ครั้งต่อเทิร์น, ดาเมจไม่ติดลบ, ตัวที่ HP หมดต้องออกจากสนาม

**Fuzz test:** ให้บอทสุ่ม move ที่ถูกกฎเล่นกัน 10,000 เกม ถ้า invariant ไหนพังให้เก็บ seed กับรายการ action ไว้เป็น regression test ทันที

## ความเสี่ยงและเรื่องที่ต้องตัดสินใจ

ความเสี่ยงใหญ่สุดตอนนี้คืองานที่ใหญ่ขึ้นเพราะมีเด็คบอท 6 เด็ค รองลงมาคือรูปชุดใหม่ที่อาจยังไม่มีใน API กับ ruling ที่เขียนผิด ทุกเรื่องมีทางสำรองแล้ว

| ความเสี่ยง | ผลกระทบ | ทางสำรอง |
| --- | --- | --- |
| งานใหญ่ขึ้นเพราะมีเด็คบอท 6 เด็ค | การ์ดที่ต้องเขียนน่าจะมากกว่าเดิม 2 เท่าขึ้นไป | เพิ่มทีละเด็ค ทุกเด็คผ่านด่านก่อนเริ่มเด็คถัดไป v1 ใช้ได้ตั้งแต่มีบอทเด็คเดียว |
| API ยังไม่มีรูปชุดใหม่ (เช่น CRI, PBL) | บางใบไม่มีรูป | ลอง pokemontcg.io → ใช้รูปพิมพ์ชุดอื่นของการ์ดเดียวกัน → แสดงเป็นกรอบข้อความ |
| เขียน ruling ผิด | ผลจำลองผิดทั้งเกม | scenario test ตามตัวเลขที่รู้แน่, สวิตช์ ruling, เทียบกับการเล่นจริงใน Pokemon TCG Live เมื่อสงสัย |
| บอทเล่นไม่เก่งจน win rate เพี้ยน | ตัวเลขดูดีเกินจริง | ดูเฉพาะส่วนต่างระหว่างแผน, เปิด replay เกมที่ผลแปลก แล้วปรับแผนประจำเด็ค |
| meta เปลี่ยนทุกครั้งที่มีชุดใหม่ | top 5 ที่ทำไว้ไม่ตรงกับทัวร์จริง | เก็บ decklist เป็นข้อความแก้ได้, meta share เป็นค่าตั้งค่า, การ์ดใหม่เพิ่มได้ทีละไฟล์ |
| Astro เก่งเรื่องเว็บเนื้อหา แต่หน้าเกมต้องโต้ตอบเกือบทั้งหน้า | หน้าเกมแทบทั้งหน้าเป็น Svelte ส่วน Astro ช่วยแค่หน้ารอบ ๆ | ให้ Astro ดูแลหน้า static (หน้าแรก, decklist) กับ routing ส่วนเกมเป็น island แบบ client:only ก้อนเดียว engine เป็น TypeScript ธรรมดา ย้ายไป framework อื่นได้ถ้าจำเป็น |
| หน้า artifact บล็อกรูปภายนอก | ใน artifact ไม่มีรูปจริง | เวอร์ชันมีรูปรันบนเครื่องหรือโฮสต์เอง artifact ใช้เป็นตัวอย่างแบบกรอบข้อความ |

**เรื่องที่คุณต้องตัดสินก่อนเริ่ม**

- [ ] ที่โฮสต์: GitHub Pages / Cloudflare Pages / รันบนเครื่องอย่างเดียว
- [ ] เด็คบอทตัวแรก: Basic Box (mirror ทำได้เร็วสุด) หรือ Dragapult (เจอบ่อยสุด)
- [ ] เริ่มจากโหมดเล่นเอง หรือโหมดรันหลายพันเกมก่อน
- [ ] รวม Festival Lead (อันดับ 6) เป็นเด็คบอทที่ 6 ไหม
- [ ] ค่าเริ่มต้น ruling Twin Shotels กับ Rabsca/Shaymin

## ภาคผนวก: decklist ฝั่งคุณ

ใช้ list นี้เป็นเด็คฝั่งผู้เล่น (รูปแบบเดียวกับที่ Limitless export)

```text
Pokémon: 20
3 Mega Kangaskhan ex MEG 104
3 Meowth ex POR 62
2 Teal Mask Ogerpon ex TWM 25
2 Latias ex SSP 76
2 Lillie's Clefairy ex ASC 76
1 Raging Bolt ex TEF 123
1 Fezandipiti ex ASC 142
1 Chien-Pao SSP 56
1 Iron Leaves ex TEF 25
1 Wellspring Mask Ogerpon ex PRE 27
1 Iron Crown ex TEF 81
1 Paldean Tauros SSP 18
1 Bloodmoon Ursaluna ex TWM 141

Trainer: 26
4 Crispin PRE 105
2 Cyrano SSP 170
2 Boss's Orders ASC 183
1 Ciphermaniac's Codebreaking PRE 104
1 Judge POR 76
4 Ultra Ball ASC 213
4 Energy Switch MEG 115
1 Special Red Card CRI 82
2 Night Stretcher ASC 196
1 Hero's Cape TEF 152
1 Glass Trumpet ASC 189
3 Area Zero Underdepths PRE 94

Energy: 14
6 Grass Energy MEE 1
1 Fire Energy MEE 2
1 Water Energy MEE 3
2 Lightning Energy MEE 4
2 Fighting Energy MEE 6
2 Psychic Energy MEE 5
```

## Sources

- [Limitless: meta share แยกตาม archetype](https://limitlesstcg.com/decks)
- [Festival Lead (Seaking) — Regional Nice รุ่น Senior อันดับ 1](https://www.limitlesstcg.com/decks/list/30783)
- [Festival Lead (Dipplin) — Regional Puebla อันดับ 29](https://www.limitlesstcg.com/decks/list/30813)
- [TCGdex FAQ: ฟรี ไม่ต้องใช้ key และรูปโฮสต์แยกที่ assets.tcgdex.net](https://tcgdex.dev/faq)
- [TCGplayer API Alternatives (2026): pokemontcg.io, Scrydex, TCGdex](https://cardgrader.ai/blog/tcgplayer-api-alternatives)
- [Best Pokemon Card APIs in 2026: ราคา Scrydex](https://www.scrapingbee.com/blog/pokemon-card-api/)
- [@astrojs/svelte: integration สำหรับ Svelte 5](https://docs.astro.build/de/guides/integrations-guide/svelte/)
- [Astro + Svelte: client directive แต่ละแบบ รวม client:only](https://fitech101.aalto.fi/en/courses/designing-and-building-scalable-web-applications/part-4/7-astro-and-svelte)
- [ตัวอย่าง: context ของ Svelte ข้าม island ใน Astro ไม่ได้](https://github.com/ikikaiku/AstroJS-SvelteQuery)

## บันทึกจากการทำจริง (15 พ.ย. 2026)

ส่วนนี้เพิ่มทีหลัง ข้อความข้างบนยังเป็นแผนเดิม

**ด่านทุกเฟสผ่านแล้ว**

| เฟส | ผล |
| --- | --- |
| 0 | ข้อความครบ 117 การ์ด, รูปจริง 128/129 print (Grookey MEP 52 ไม่มีรูปในทั้งสอง API แสดงเป็นกรอบข้อความ) |
| 1 | scenario test ตามแผนผ่านทั้งหมด, fuzz 10,000 เกม invariant ไม่พัง (ราว 10 วินาที) |
| 2 | เล่นจบเกมในเบราว์เซอร์ได้ (Playwright), บอทคิดเทิร์นละไม่ถึง 20 ms |
| 3–4 | เด็คบอททั้ง 7 list เล่นเด็คละ 1,000 เกม เช็ค invariant ทุก action ไม่พัง |
| 5 | 600 เกมในเบราว์เซอร์ 2.5 วินาที, การทดลองครบ 5 ข้อ |
| 6 | บอทยากชนะบอทปกติ 598/1,000 (59.8%, 95% CI 56.7–62.8) ใน mirror match |

**ข้อมูลที่ต่างจากแผน**

- ลิงก์ list ของ Dragapult (29678) คืออันดับ 104 Regional Frankfurt และ Slowking (30165) คืออันดับ 13 Regional Louisville ไม่ใช่ Gdańsk ตามตาราง ใช้ list ตามลิงก์
- Slowking ไม่ได้ยืมท่าจาก bench: Seek Inspiration ทิ้งการ์ดบนสุดของเด็ค แล้วใช้ท่าได้ถ้าเป็น Pokémon ไม่มี Rule Box บอทจึงจัดการ์ดบนเด็คด้วย Ciphermaniac's Codebreaking / Academy at Night ในเทิร์นที่จะตี
- Dragapult ex เป็น Tera (bench ไม่โดนดาเมจจากท่า, ได้ bench 8 จาก Area Zero) และ Lillie's Clefairy ex ทำให้ Dragapult ex แพ้ทาง Psychic
- Shaymin กันเฉพาะตัวที่ไม่มี Rule Box (Meowth ex บน bench ของ Festival ยังโดนยิง) Rabsca กันทุกตัว รวมถึงตัวนับดาเมจจากท่า
- TCGdex ระบุ Special Energy บางใบ (Telepathic Psychic, Growing Grass) เป็น "Normal" engine จึงตัดสินจากชื่อการ์ดแทน

**ผลการทดลองชุดแรก** (500 เกมต่อ matchup ต่อฝั่ง, seed ชุดเดียวกัน) ทุกข้อต่างกันไม่เกิน 2 จุดเปอร์เซ็นต์ และยังแยกไม่ออกจากความบังเอิญ:
+1 Fire −1 Grass −1.7, −1 Clefairy +1 Tauros −1.8, Area Zero ลงตั้งแต่แรก +0.9, Bench 8 +0.5, กำแพง Cape −0.2
ตัวจำกัดคือฝีมือบอท ให้ดูเป็นทิศทาง แล้วยืนยันกับการเล่นจริง

**ต่างจากแผนด้านเทคนิค:** ใช้ Astro 6 แทน 7 เพราะเครื่องนี้เป็น Node 22.16 (Astro 7 ต้องการ 22.23.4 ขึ้นไป) ควรอัปเกรด Node แล้วย้ายไป Astro 7 ก่อนโฮสต์จริง
