// Validate a decklist pasted in the browser (PLAN.md v3: แก้ decklist ในหน้าเว็บ).
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
}

export function checkList(text: string): ListCheck {
  let entries;
  try {
    // Heading counts ("Trainer: 26") are easy to forget when editing; only the 60 total matters.
    const loose = text.replace(/^\s*(Pok[eé]mon|Trainer|Energy)\s*(?::\s*\d+|\(\d+\))\s*$/gim, '$1');
    entries = parseDecklist(loose).entries;
  } catch (e) {
    return { errors: [(e as Error).message.replace('decklist: ', '').replace(/expected 60/, 'ต้องมี 60 ใบ')] };
  }
  const errors: string[] = [];
  const cards: string[] = [];
  for (const e of entries) {
    const print = manifest.prints[printKey(e)];
    const sameName = byName.get(norm(e.name)) ?? [];
    // An exact print, else the only card with this name (prints of one card share text).
    const card = print ? manifest.cards[print.card] : sameName.length === 1 ? sameName[0] : undefined;
    if (!card) {
      errors.push(
        sameName.length > 1
          ? `${e.name} ${e.set} ${e.number}: มีหลายแบบที่ข้อความต่างกัน ให้ระบุชุด/เลขตามเด็คที่มีอยู่`
          : `${e.name}: ยังไม่รองรับ (v1 รองรับเฉพาะการ์ดในเด็คที่มีอยู่)`,
      );
      continue;
    }
    for (let i = 0; i < e.count; i++) cards.push(card.key);
  }
  if (errors.length) return { errors };

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
  return errors.length ? { errors } : { cards, errors: [] };
}
