import type {
  Ability,
  Attack,
  CardDef,
  EnergyType,
  PokemonCard,
  TrainerCard,
  TypeValue,
} from '../../src/data/cards';

// Raw API shapes — only the fields we read.
export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  category: 'Pokemon' | 'Trainer' | 'Energy';
  image?: string;
  rarity?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  evolveFrom?: string;
  suffix?: string;
  abilities?: { type?: string; name: string; effect: string }[];
  attacks?: { cost?: string[]; name: string; effect?: string; damage?: string | number }[];
  weaknesses?: { type: string; value?: string }[];
  resistances?: { type: string; value?: string }[];
  retreat?: number;
  effect?: string;
  trainerType?: string;
  energyType?: string;
  regulationMark?: string;
}

export interface PtcgCard {
  id: string;
  name: string;
  number?: string;
  supertype?: string;
  subtypes?: string[];
  rules?: string[];
  hp?: string;
  abilities?: { name: string; text: string; type: string }[];
  attacks?: { name: string; cost?: string[]; damage?: string; text?: string }[];
  weaknesses?: { type: string; value: string }[];
  retreatCost?: string[];
  images?: { small?: string; large?: string };
}

const ENERGY_TYPES: readonly EnergyType[] = [
  'Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting',
  'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless',
];

// Omit per union member; plain Omit on a union keeps only the keys all members share.
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NormalizedCard = OmitEach<CardDef, 'key' | 'prints'>;

export function fromTcgdex(raw: TcgdexCard, ptcg?: PtcgCard): NormalizedCard {
  const subtypes = ptcg?.subtypes ?? [];
  const common = {
    name: raw.name,
    subtypes,
    regulationMark: raw.regulationMark,
  };

  if (raw.category === 'Pokemon') {
    const isMega = subtypes.includes('MEGA') || /^Mega /.test(raw.name);
    const isEx = raw.suffix === 'ex' || subtypes.includes('ex') || / ex$/.test(raw.name);
    const card: Omit<PokemonCard, 'key' | 'prints'> = {
      ...common,
      category: 'pokemon',
      rules: dedupeRules(ptcg?.rules ?? []),
      hp: required(raw.hp, raw, 'hp'),
      types: (raw.types ?? []).map(energyType),
      stage: stageOf(raw, subtypes),
      evolvesFrom: raw.evolveFrom,
      abilities: (raw.abilities ?? []).map((a): Ability => ({ name: a.name, effect: clean(a.effect) })),
      attacks: (raw.attacks ?? []).map(
        (a): Attack => ({
          name: a.name,
          cost: (a.cost ?? []).map(energyType),
          damage: damageOf(a.damage),
          effect: clean(a.effect ?? ''),
        }),
      ),
      weaknesses: (raw.weaknesses ?? []).map(typeValue),
      resistances: (raw.resistances ?? []).map(typeValue),
      retreat: raw.retreat ?? 0,
      prizes: isEx ? (isMega ? 3 : 2) : 1,
      tera: subtypes.includes('Tera'),
    };
    return card;
  }

  const effect = clean(raw.effect ?? '');
  const aceSpec = subtypes.includes('ACE SPEC') || /ace spec/i.test(raw.rarity ?? '');
  const rules = (ptcg?.rules ?? []).filter((r) => !sameText(r, effect));

  if (raw.category === 'Trainer') {
    return { ...common, category: 'trainer', rules, trainerType: trainerTypeOf(raw), aceSpec, effect };
  }

  // Decided by name: TCGdex labels some Special Energy (e.g. Telepathic Psychic Energy) "Normal".
  const basic = raw.name.match(BASIC_ENERGY_RE);
  const provides = basic ? energyType(basic[1]!) : undefined;
  return {
    ...common,
    name: provides ? `${provides} Energy` : raw.name,
    category: 'energy',
    rules,
    energyType: basic ? 'Basic' : 'Special',
    provides,
    aceSpec,
    effect,
  };
}

// MEE prints both "Grass Energy" (1–8) and "Basic Grass Energy" (9–16); they are the same card.
const BASIC_ENERGY_RE = /^(?:Basic )?(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/i;

// Text that decides how a card plays. Two prints with the same signature are the same card.
export function gameplaySignature(card: NormalizedCard): string {
  const { subtypes: _s, rules: _r, regulationMark: _m, ...rest } = card;
  const play: Record<string, unknown> = { ...rest, name: normName(card.name) };
  delete play.tera;
  delete play.aceSpec;
  return stableStringify(play);
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// Cross-check TCGdex against pokemontcg.io; returns human-readable differences.
export function compareSources(card: NormalizedCard, ptcg: PtcgCard): string[] {
  const diffs: string[] = [];
  if (!sameCardName(card.name, ptcg.name)) diffs.push(`name: tcgdex ${card.name} vs pokemontcg.io ${ptcg.name}`);
  if (card.category !== 'pokemon') return diffs;

  if (ptcg.hp !== undefined && Number(ptcg.hp) !== card.hp) {
    diffs.push(`hp: tcgdex ${card.hp} vs pokemontcg.io ${ptcg.hp}`);
  }
  const theirAttacks = new Map((ptcg.attacks ?? []).map((a) => [normName(a.name), a]));
  for (const a of card.attacks) {
    const theirs = theirAttacks.get(normName(a.name));
    if (!theirs) diffs.push(`attack ${a.name}: missing on pokemontcg.io`);
    else if (damageOf(theirs.damage) !== a.damage) {
      diffs.push(`attack ${a.name} damage: tcgdex ${a.damage} vs pokemontcg.io ${damageOf(theirs.damage)}`);
    }
    theirAttacks.delete(normName(a.name));
  }
  for (const a of theirAttacks.values()) diffs.push(`attack ${a.name}: missing on tcgdex`);

  const ours = card.abilities.map((a) => normName(a.name)).sort().join('|');
  const theirs = (ptcg.abilities ?? []).map((a) => normName(a.name)).sort().join('|');
  if (ours !== theirs) diffs.push(`abilities: tcgdex [${ours}] vs pokemontcg.io [${theirs}]`);

  if (ptcg.retreatCost && ptcg.retreatCost.length !== card.retreat) {
    diffs.push(`retreat: tcgdex ${card.retreat} vs pokemontcg.io ${ptcg.retreatCost.length}`);
  }
  return diffs;
}

export function sameCardName(a: string, b: string): boolean {
  return normName(a) === normName(b);
}

export function cardSlug(name: string): string {
  return normName(name)
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(BASIC_ENERGY_PREFIX_RE, '');
}

const BASIC_ENERGY_PREFIX_RE = /^basic (?=\w+ energy$)/;

// Prints of one card differ in paragraph spacing (Ultra Ball MEG vs ASC), so blank lines collapse.
function clean(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

function sameText(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
  return n(a) === n(b);
}

// pokemontcg.io repeats the Tera rule twice, once with a "Tera:" label.
function dedupeRules(rules: string[]): string[] {
  const unlabeled = (r: string) => r.replace(/^[A-Za-zé ]+:\s*/, '');
  return rules.filter(
    (r) => !rules.some((other) => other !== r && other.length > r.length && unlabeled(other) === r),
  );
}

function energyType(t: string): EnergyType {
  const found = ENERGY_TYPES.find((e) => e.toLowerCase() === t.toLowerCase());
  if (!found) throw new Error(`unknown energy type "${t}"`);
  return found;
}

function typeValue(w: { type: string; value?: string }): TypeValue {
  return { type: energyType(w.type), value: (w.value ?? '×2').replace(/^x/i, '×') };
}

function damageOf(d: string | number | undefined): string {
  return String(d ?? '').trim().replace(/x$/i, '×');
}

function stageOf(raw: TcgdexCard, subtypes: string[]): PokemonCard['stage'] {
  // pokemontcg.io's subtypes win when they name a stage: TCGdex has Talonflame ex (Stage 2) as Basic.
  if (subtypes.includes('Stage 2')) return 'Stage2';
  if (subtypes.includes('Stage 1')) return 'Stage1';
  const s = (raw.stage ?? '').replace(/\s+/g, '');
  if (s === 'Basic' || s === 'Stage1' || s === 'Stage2') return s;
  throw new Error(`${raw.id}: unknown stage "${raw.stage}"`);
}

function trainerTypeOf(raw: TcgdexCard): TrainerCard['trainerType'] {
  const t = raw.trainerType ?? '';
  if (/tool/i.test(t)) return 'Tool';
  if (t === 'Item' || t === 'Supporter' || t === 'Stadium') return t;
  throw new Error(`${raw.id}: unknown trainer type "${t}"`);
}

function required<T>(v: T | undefined, raw: TcgdexCard, field: string): T {
  if (v === undefined) throw new Error(`${raw.id}: missing ${field}`);
  return v;
}
