import type { CardDef, CardManifest, EnergyType, ImageSource } from '../../src/data/cards';
import { printKey } from '../../src/data/decklist';
import type { DeckFile } from './decks';

export interface PrintIssue {
  key: string;
  kind: 'error' | 'diff' | 'no-ptcgio';
  text: string;
}

interface ReportInput {
  decks: DeckFile[];
  manifest: CardManifest;
  issues: PrintIssue[];
  variants: { name: string; keys: string[] }[];
  deckChecks: { slug: string; problems: string[] }[];
  setMap: { code: string; tcgdex: string[]; ptcgio: string[] }[];
}

// Milestone order from PLAN.md: player deck + Basic Box first, then Dragapult, then the rest.
const MILESTONE_ORDER = [
  'player',
  'basic-box',
  'dragapult-ex',
  'slowking',
  'ns-zoroark-ex',
  'alakazam',
  'festival-lead-seaking',
  'festival-lead-dipplin',
];

// Cards whose text PLAN.md asks to check in Phase 0 before designing their effects or bots.
const PLAN_CHECKS = [
  'Grookey', 'Applin', 'Poké Pad', 'Growing Grass Energy', 'Slowking', 'Dragapult ex',
  "N's Zoroark ex", 'Alakazam', 'Seaking', 'Dipplin', 'Thwackey', 'Festival Grounds',
];

const SYMBOL: Record<EnergyType, string> = {
  Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F',
  Darkness: 'D', Metal: 'M', Dragon: 'N', Fairy: 'Y', Colorless: 'C',
};

export function buildReport(input: ReportInput): { markdown: string; summary: string; gatePassed: boolean } {
  const { decks, manifest, issues, variants, deckChecks, setMap } = input;
  const cards = Object.values(manifest.cards);
  const prints = Object.values(manifest.prints);

  const errors = issues.filter((i) => i.kind === 'error');
  const missingPrints = decks.flatMap((d) =>
    d.list.entries.filter((e) => !manifest.prints[printKey(e)]).map((e) => `${d.slug}: ${printKey(e)} ${e.name}`),
  );
  const noText = cards.filter((c) => !hasText(c));
  const deckFailures = deckChecks.filter((d) => d.problems.length > 0);
  const bySource = countBy(prints.map((p) => p.image.source));
  const realImages = prints.length - (bySource.get('none') ?? 0);

  const textOk = errors.length === 0 && missingPrints.length === 0 && noText.length === 0;
  const gatePassed = textOk && deckFailures.length === 0;

  const L: string[] = [];
  L.push('# รายงานข้อมูลการ์ด (เฟส 0)', '');
  L.push(`สร้างเมื่อ ${manifest.generatedAt} ด้วย \`npm run cards\` · ข้อมูลอยู่ที่ \`data/cards.manifest.json\``, '');

  L.push('## ด่านเฟส 0', '');
  L.push(`- ${mark(textOk)} ข้อความการ์ดครบทุกใบ: ${cards.length} การ์ด จาก ${prints.length} print` +
    (textOk ? '' : ` (error ${errors.length}, หา print ไม่เจอ ${missingPrints.length}, ไม่มีข้อความ ${noText.length})`));
  L.push(`- ${mark(true)} ทุกใบมีรูปหรือมีทางสำรอง: รูปจริง ${realImages}/${prints.length} print` +
    `, ที่เหลือ ${bySource.get('none') ?? 0} ใบแสดงเป็นกรอบข้อความ`);
  L.push(`- ${mark(deckFailures.length === 0)} decklist ถูกกฎ (60 ใบ, ชื่อเดียวกันไม่เกิน 4, ACE SPEC ไม่เกิน 1, มี Basic)`);
  L.push('');

  L.push('## แหล่งรูป', '');
  L.push('| แหล่ง | จำนวน print |', '| --- | --- |');
  for (const s of ['tcgdex', 'pokemontcg.io', 'alt-print', 'none'] as ImageSource[]) {
    L.push(`| ${SOURCE_LABEL[s]} | ${bySource.get(s) ?? 0} |`);
  }
  const notTcgdex = prints.filter((p) => p.image.source !== 'tcgdex');
  if (notTcgdex.length > 0) {
    L.push('', 'print ที่ไม่ได้ใช้รูปจาก TCGdex ของ print ตัวเอง:', '');
    for (const p of notTcgdex) {
      L.push(`- ${p.key} ${p.name}: ${SOURCE_LABEL[p.image.source]}${p.image.altOf ? ` (${p.image.altOf})` : ''}`);
    }
  }
  L.push('');

  L.push('## จำนวนการ์ดที่ต้องเขียน', '');
  L.push('นับการ์ดไม่ซ้ำ (ชื่อเดียวกัน ข้อความเดียวกัน = ใบเดียว) ตามลำดับ milestones ในแผน "ใหม่" คือการ์ดที่ยังไม่มีในเด็คก่อนหน้า', '');
  L.push('| เด็ค | การ์ดไม่ซ้ำ | ใหม่ | ใหม่ที่ต้องเขียนเอฟเฟกต์ | สะสม |', '| --- | --- | --- | --- | --- |');
  const seen = new Set<string>();
  for (const slug of MILESTONE_ORDER) {
    const deck = decks.find((d) => d.slug === slug);
    if (!deck) continue;
    const keys = deckCardKeys(deck, manifest);
    const fresh = keys.filter((k) => !seen.has(k));
    fresh.forEach((k) => seen.add(k));
    const withEffects = fresh.filter((k) => needsEffectCode(manifest.cards[k]!));
    L.push(`| ${deck.meta.name} | ${keys.length} | ${fresh.length} | ${withEffects.length} | ${seen.size} |`);
  }
  const effectful = cards.filter(needsEffectCode).length;
  L.push('', `รวม ${cards.length} การ์ด ต้องเขียนเอฟเฟกต์ ${effectful} ใบ ` +
    `ที่เหลือเป็นพลังงานพื้นฐานหรือ Pokémon ที่มีแต่ท่าดาเมจตรง ๆ`, '');

  L.push('## การ์ดที่แผนขอให้เช็คข้อความ', '');
  for (const name of PLAN_CHECKS) {
    const matches = cards.filter((c) => c.name === name);
    if (matches.length === 0) L.push(`### ${name}`, '', '_ไม่มีในเด็คไหน_', '');
    for (const c of matches) L.push(...formatCard(c), '');
  }

  L.push('## ชื่อเดียวกันแต่ข้อความต่างกัน', '');
  if (variants.length === 0) L.push('ไม่มี');
  for (const v of variants) {
    L.push(`- **${v.name}**: ${v.keys.map((k) => `\`${k}\` (${manifest.cards[k]!.prints.join(', ')})`).join(' / ')}`);
  }
  L.push('');

  L.push('## TCGdex กับ pokemontcg.io ไม่ตรงกัน', '');
  const diffs = issues.filter((i) => i.kind === 'diff');
  if (diffs.length === 0) L.push('ไม่มี');
  for (const d of diffs) L.push(`- ${d.key} ${manifest.prints[d.key]?.name ?? ''}: ${d.text}`);
  L.push('');

  const noPtcg = issues.filter((i) => i.kind === 'no-ptcgio');
  L.push('## ไม่มีใน pokemontcg.io', '');
  L.push('ข้อความยังมาจาก TCGdex ครบ แต่ subtypes (Tera, ACE SPEC) กับ rule box เช็คกับแหล่งที่สองไม่ได้', '');
  if (noPtcg.length === 0) L.push('ไม่มี');
  for (const i of noPtcg) L.push(`- ${i.key} ${manifest.prints[i.key]?.name ?? ''}`);
  L.push('');

  if (errors.length || missingPrints.length || noText.length || deckFailures.length) {
    L.push('## ปัญหาที่ต้องแก้', '');
    for (const e of errors) L.push(`- ${e.key}: ${e.text}`);
    for (const m of missingPrints) L.push(`- หา print ไม่เจอ: ${m}`);
    for (const c of noText) L.push(`- ไม่มีข้อความ: ${c.key}`);
    for (const d of deckFailures) L.push(`- ${d.slug}: ${d.problems.join('; ')}`);
    L.push('');
  }

  L.push('## รหัสชุด → id ใน API', '');
  L.push('| Limitless | TCGdex | pokemontcg.io |', '| --- | --- | --- |');
  for (const s of setMap) L.push(`| ${s.code} | ${s.tcgdex.join(', ') || '—'} | ${s.ptcgio.join(', ') || '—'} |`);
  L.push('');

  const summary = [
    `gate: ${gatePassed ? 'PASS' : 'FAIL'}`,
    `cards ${cards.length}, prints ${prints.length}, images ${realImages}/${prints.length}`,
    `errors ${errors.length}, source diffs ${diffs.length}, no pokemontcg.io ${noPtcg.length}`,
    ...deckFailures.map((d) => `deck ${d.slug}: ${d.problems.join('; ')}`),
  ].join('\n');
  return { markdown: L.join('\n'), summary, gatePassed };
}

const SOURCE_LABEL: Record<ImageSource, string> = {
  tcgdex: 'TCGdex',
  'pokemontcg.io': 'pokemontcg.io',
  'alt-print': 'รูปจาก print อื่นที่ข้อความเหมือนกัน',
  none: 'ไม่มีรูป (กรอบข้อความ)',
};

function formatCard(c: CardDef): string[] {
  const head = `### ${c.name} (${c.prints.join(', ')})`;
  if (c.category === 'pokemon') {
    const L = [head, '', `${c.stage}${c.evolvesFrom ? ` (จาก ${c.evolvesFrom})` : ''} · ${c.hp} HP · ${c.types.join('/')}` +
      `${c.tera ? ' · Tera' : ''}${c.prizes > 1 ? ` · ${c.prizes} prize` : ''}`, ''];
    for (const a of c.abilities) L.push(`- **Ability: ${a.name}** — ${a.effect}`);
    for (const a of c.attacks) {
      const cost = a.cost.map((t) => SYMBOL[t]).join('') || '0';
      L.push(`- **[${cost}] ${a.name}** ${a.damage}${a.effect ? ` — ${a.effect}` : ''}`);
    }
    const weak = c.weaknesses.map((w) => `${w.type} ${w.value}`).join(', ') || '—';
    const resist = c.resistances.map((w) => `${w.type} ${w.value}`).join(', ') || '—';
    L.push(`- Weakness ${weak} · Resistance ${resist} · Retreat ${c.retreat}`);
    return L;
  }
  const kind = c.category === 'trainer' ? c.trainerType : `${c.energyType} Energy`;
  return [head, '', `${kind}${c.aceSpec ? ' · ACE SPEC' : ''}`, '', `> ${c.effect.replace(/\n+/g, '\n> ')}`];
}

function hasText(c: CardDef): boolean {
  if (c.category === 'pokemon') return c.hp > 0 && c.attacks.length + c.abilities.length > 0;
  if (c.category === 'energy' && c.energyType === 'Basic') return c.provides !== undefined;
  return c.effect.length > 0;
}

function needsEffectCode(c: CardDef): boolean {
  if (c.category === 'energy') return c.energyType === 'Special';
  if (c.category === 'trainer') return true;
  return c.abilities.length > 0 || c.tera || c.attacks.some((a) => a.effect.length > 0);
}

function deckCardKeys(deck: DeckFile, manifest: CardManifest): string[] {
  const keys = deck.list.entries.map((e) => manifest.prints[printKey(e)]?.card).filter((k): k is string => !!k);
  return [...new Set(keys)];
}

function countBy<T>(xs: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

function mark(ok: boolean): string {
  return ok ? '✅' : '❌';
}
