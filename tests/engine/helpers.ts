import { loadDeckFiles } from '../../scripts/lib/decks';
import { apply } from '../../src/engine/actions';
import { deckKeys } from '../../src/engine/db';
import { DEFAULT_RULES } from '../../src/engine/state';
import type { CardInst, DeckSpec, GameState, PlayerId, PlayerState, Slot } from '../../src/engine/types';

export interface SlotSpec {
  card: string;
  /** Lower stages under `card`, Basic first. */
  under?: string[];
  energy?: string[];
  tool?: string;
  damage?: number;
}

export interface SideSpec {
  active?: SlotSpec | string;
  bench?: (SlotSpec | string)[];
  hand?: string[];
  deck?: string[];
  discard?: string[];
  prizes?: number;
}

const FILLER = 'psychic-energy';

/** A mid-game state built directly from card keys (no setup, not 60 cards). */
export function scenario(spec: {
  p0: SideSpec;
  p1: SideSpec;
  stadium?: { card: string; owner: PlayerId };
  turn?: number;
  current?: PlayerId;
}): GameState {
  const cards: CardInst[] = [];
  const make = (key: string, owner: PlayerId) => {
    const id = cards.length;
    cards.push({ id, key, owner });
    return id;
  };
  let uid = 1;
  const slot = (sp: SlotSpec | string, owner: PlayerId): Slot => {
    const o = typeof sp === 'string' ? { card: sp } : sp;
    return {
      uid: uid++,
      stack: [...(o.under ?? []), o.card].map((k) => make(k, owner)),
      energy: (o.energy ?? []).map((k) => make(k, owner)),
      tool: o.tool ? make(o.tool, owner) : null,
      damage: o.damage ?? 0,
      enteredTurn: 0,
      evolvedTurn: -1,
      conditions: [],
      marks: [],
      usedAbility: {},
    };
  };
  const side = (sp: SideSpec, p: PlayerId): PlayerState => ({
    active: sp.active ? slot(sp.active, p) : null,
    bench: (sp.bench ?? []).map((b) => slot(b, p)),
    hand: (sp.hand ?? []).map((k) => make(k, p)),
    deck: (sp.deck ?? Array(20).fill(FILLER)).map((k: string) => make(k, p)),
    discard: (sp.discard ?? []).map((k) => make(k, p)),
    prizes: Array.from({ length: sp.prizes ?? 6 }, () => make(FILLER, p)),
    supporterPlayed: false,
    energyAttached: false,
    retreated: false,
    stadiumPlayed: false,
    namedUsed: [],
    buffs: [],
    itemLockTurn: -1,
    koLastTurn: false,
    koByAttackLastTurn: false,
    koThisTurn: false,
    koByAttackThisTurn: false,
    mulligans: 0,
    knownTop: [],
  });
  const players: [PlayerState, PlayerState] = [side(spec.p0, 0), side(spec.p1, 1)];
  const stadium = spec.stadium ? { card: make(spec.stadium.card, spec.stadium.owner), owner: spec.stadium.owner } : null;
  return {
    seed: 1,
    turn: spec.turn ?? 5,
    current: spec.current ?? 0,
    first: 0,
    phase: 'main',
    players,
    stadium,
    cards,
    rng: { shuffle: [11, 22], coin: 33 },
    nextUid: uid,
    pending: null,
    winner: null,
    winReason: '',
    log: [],
    quiet: false,
    steps: 0,
    rules: { ...DEFAULT_RULES },
    names: ['คุณ', 'บอท'],
  };
}

/** Answer the pending choice. */
export const choose = (s: GameState, ...picks: number[]) => apply(s, { t: 'choose', picks });

/** Answer every pending choice of `purpose` (or any) by taking the first options until none is pending. */
export function chooseFirst(s: GameState): GameState {
  let cur = s;
  while (cur.pending) {
    const r = cur.pending.request;
    cur = choose(cur, ...r.options.slice(0, Math.max(r.min, 1)).map((o) => o.value));
  }
  return cur;
}

export const active = (s: GameState, p: PlayerId) => s.players[p].active!;
export const bench = (s: GameState, p: PlayerId, i: number) => s.players[p].bench[i]!;
export const handCard = (s: GameState, p: PlayerId, key: string) => {
  const c = s.players[p].hand.find((id) => s.cards[id]!.key === key);
  if (c === undefined) throw new Error(`${key} not in hand`);
  return c;
};
/** Option value whose label (card or Pokémon name) matches. */
export const optionFor = (s: GameState, label: string) => {
  const o = s.pending?.request.options.find((x) => x.label === label);
  if (!o) throw new Error(`no option "${label}" in ${JSON.stringify(s.pending?.request.options.map((x) => x.label))}`);
  return o.value;
};

const files = loadDeckFiles('src/content/decks');
export function deck(slug: string): DeckSpec {
  const f = files.find((d) => d.slug === slug);
  if (!f) throw new Error(`no deck ${slug}`);
  return { name: f.meta.name, cards: deckKeys(f.list.entries) };
}
export const DECK_SLUGS = files.map((f) => f.slug);
