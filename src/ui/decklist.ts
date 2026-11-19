// Validate a decklist pasted in the browser (your own decks, my-decks.ts).
// Only cards the engine implements can be played; another print of a supported card is matched by name.
import manifestJson from '../../data/cards.manifest.json';
import type { CardDef, CardManifest } from '../data/cards';
import { parseDecklist, printKey } from '../data/decklist';

const manifest = manifestJson as CardManifest;

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .trim();

const byName = new Map<string, CardDef[]>();
for (const c of Object.values(manifest.cards)) {
  const list = byName.get(norm(c.name)) ?? [];
  list.push(c);
  byName.set(norm(c.name), list);
}

export interface ListCheck {
  cards?: string[];
  errors: string[];
  /** Names of the cards the engine doesn't implement yet. */
  unsupported: string[];
}

/** Every card the engine can play, by name (the decks page lists them for building a list). */
export const SUPPORTED: readonly CardDef[] = Object.values(manifest.cards).sort((a, b) => a.name.localeCompare(b.name));

/** The parser's message (data/decklist.ts) in Thai. */
function thai(message: string, shift: number): string {
  const m = message.replace(/^decklist:? ?/, '');
  const line = m.match(/^line (\d+): cannot read "(.*)"$/);
  if (line) return `บรรทัด ${Number(line[1]) - shift} อ่านไม่ออก: "${line[2]}" (รูปแบบ: จำนวน ชื่อการ์ด ชุด เลข เช่น 4 Dreepy TWM 128)`;
  const total = m.match(/^has (\d+) cards, expected (\d+)$/);
  if (total) return `มี ${total[1]} ใบ (ต้องมี ${total[2]} ใบ)`;
  return m;
}

export function checkList(text: string): ListCheck {
  let entries;
  let shift = 0;
  try {
    // Heading counts ("Trainer: 26") are easy to forget when editing; only the 60 total matters. A list
    // without headings at all is read as one section (only the cards matter here).
    let loose = text.replace(/^\s*(Pok[eé]mon|Trainer|Energy)\s*(?::\s*\d+|\(\d+\))\s*$/gim, '$1');
    if (!/^\s*(Pok[eé]mon|Trainer|Energy)\s*$/im.test(loose)) {
      loose = `Pokémon\n${loose}`;
      shift = 1;
    }
    entries = parseDecklist(loose).entries;
  } catch (e) {
    return { errors: [thai((e as Error).message, shift)], unsupported: [] };
  }
  const errors: string[] = [];
  const unsupported: string[] = [];
  const cards: string[] = [];
  for (const e of entries) {
    const print = manifest.prints[printKey(e)];
    const sameName = byName.get(norm(e.name)) ?? [];
    // An exact print, else the only card with this name (prints of one card share text).
    const card = print ? manifest.cards[print.card] : sameName.length === 1 ? sameName[0] : undefined;
    if (!card) {
      if (sameName.length > 1) errors.push(`${e.name} ${e.set} ${e.number}: มีหลายแบบที่ข้อความต่างกัน ให้ระบุชุดและเลขการ์ด`);
      else {
        unsupported.push(e.name);
        errors.push(`${e.name}: ยังไม่รองรับ`);
      }
      continue;
    }
    for (let i = 0; i < e.count; i++) cards.push(card.key);
  }
  if (errors.length) return { errors, unsupported };

  const counts = new Map<string, number>();
  for (const k of cards) {
    const c = manifest.cards[k]!;
    if (c.category === 'energy' && c.energyType === 'Basic') continue;
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  for (const [name, n] of counts) if (n > 4) errors.push(`${name} มี ${n} ใบ (ชื่อเดียวกันได้ไม่เกิน 4)`);
  const ace = cards.filter((k) => {
    const c = manifest.cards[k]!;
    return c.category !== 'pokemon' && c.aceSpec;
  }).length;
  if (ace > 1) errors.push(`มี ACE SPEC ${ace} ใบ (ได้ไม่เกิน 1)`);
  if (!cards.some((k) => {
    const c = manifest.cards[k]!;
    return c.category === 'pokemon' && c.stage === 'Basic';
  })) {
    errors.push('ต้องมี Basic Pokémon อย่างน้อย 1 ใบ');
  }
  return errors.length ? { errors, unsupported } : { cards, errors: [], unsupported };
}
