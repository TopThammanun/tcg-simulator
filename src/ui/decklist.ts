// Validate a decklist pasted in the browser (your own decks, my-decks.ts).
// Only cards the engine implements can be played; another print of a supported card is matched by name.
import { tx } from '../i18n';
import manifestJson from '../../data/cards.manifest.json';
import type { CardDef, CardManifest } from '../data/cards';
import { parseDecklist, printKey } from '../data/decklist';

const manifest = manifestJson as CardManifest;

export const norm = (s: string) =>
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

/**
 * The supported card a list line names: its exact print, else the only card with that name (prints of one card share
 * text); 'ambiguous' when several cards with different text have that name.
 */
export function cardFor(e: { name: string; set?: string; number?: string }): CardDef | 'ambiguous' | undefined {
  const print = e.set && e.number ? manifest.prints[printKey({ set: e.set, number: e.number })] : undefined;
  if (print) return manifest.cards[print.card];
  const sameName = byName.get(norm(e.name)) ?? [];
  return sameName.length === 1 ? sameName[0] : sameName.length > 1 ? 'ambiguous' : undefined;
}

/** The parser's message (data/decklist.ts) in the page's language. */
function thai(message: string, shift: number): string {
  const m = message.replace(/^decklist:? ?/, '');
  const line = m.match(/^line (\d+): cannot read "(.*)"$/);
  if (line) return tx(`บรรทัด ${Number(line[1]) - shift} อ่านไม่ออก: "${line[2]}" (รูปแบบที่ถูกคือ จำนวน ชื่อการ์ด ชุด เลข เช่น 4 Dreepy TWM 128)`, `Line ${Number(line[1]) - shift} can't be read: "${line[2]}" (format: count, card name, set, number, e.g. 4 Dreepy TWM 128)`);
  const total = m.match(/^has (\d+) cards, expected (\d+)$/);
  if (total) return tx(`มี ${total[1]} ใบ (ต้องมี ${total[2]} ใบ)`, `${total[1]} cards (${total[2]} needed)`);
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
    const card = cardFor(e);
    if (!card || card === 'ambiguous') {
      if (card === 'ambiguous') errors.push(tx(`${e.name} ${e.set} ${e.number}: มีหลายเวอร์ชันที่ข้อความต่างกัน ใส่ชื่อชุดและเลขการ์ดด้วย`, `${e.name} ${e.set} ${e.number}: several versions with different text; give the set and card number`));
      else {
        unsupported.push(e.name);
        errors.push(tx(`${e.name}: ยังไม่รองรับ`, `${e.name}: not supported yet`));
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
  for (const [name, n] of counts) if (n > 4) errors.push(tx(`${name} มี ${n} ใบ (การ์ดชื่อเดียวกันใส่ได้ไม่เกิน 4 ใบ)`, `${n} copies of ${name} (4 at most with the same name)`));
  const ace = cards.filter((k) => {
    const c = manifest.cards[k]!;
    return c.category !== 'pokemon' && c.aceSpec;
  }).length;
  if (ace > 1) errors.push(tx(`มี ACE SPEC ${ace} ใบ (ใส่ได้แค่ 1 ใบ)`, `${ace} ACE SPEC cards (1 at most)`));
  if (!cards.some((k) => {
    const c = manifest.cards[k]!;
    return c.category === 'pokemon' && c.stage === 'Basic';
  })) {
    errors.push(tx('ต้องมี Basic Pokémon อย่างน้อย 1 ใบ', 'At least 1 Basic Pokémon is needed'));
  }
  return errors.length ? { errors, unsupported } : { cards, errors: [], unsupported };
}
