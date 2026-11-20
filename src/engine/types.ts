// Core game types. The engine is plain TypeScript: no UI imports, runs in Node, Svelte and Web Workers.
// State is never mutated after it is returned from apply(); each action works on a fresh clone.

export type PlayerId = 0 | 1;
export type CardId = number;
export type SlotId = number;

export interface CardInst {
  id: CardId;
  key: string;
  owner: PlayerId;
}

export type Condition = 'poisoned' | 'confused';

/** Effects from attacks that last until a given turn; cleared when the Pokémon leaves the Active Spot. */
export type Mark =
  | { kind: 'cant-attack'; turn: number }
  | { kind: 'cant-use'; attack: string; turn: number }
  | { kind: 'cant-retreat'; turn: number }
  | { kind: 'protected'; turn: number };

export interface Slot {
  uid: SlotId;
  /** Basic at index 0, current form last. */
  stack: CardId[];
  energy: CardId[];
  tool: CardId | null;
  damage: number;
  enteredTurn: number;
  evolvedTurn: number;
  conditions: Condition[];
  marks: Mark[];
  /** Ability name -> turn it was last used (once-per-turn abilities of this Pokémon). */
  usedAbility: Record<string, number>;
}

export type Buff = 'gladion' | 'black-belt' | 'kieran';

export interface PlayerState {
  deck: CardId[];
  hand: CardId[];
  discard: CardId[];
  prizes: CardId[];
  active: Slot | null;
  bench: Slot[];
  supporterPlayed: boolean;
  energyAttached: boolean;
  retreated: boolean;
  stadiumPlayed: boolean;
  /** Once-per-turn limits shared by name across Pokémon ("Run Errand", "Last-Ditch", …). */
  namedUsed: string[];
  buffs: Buff[];
  /** Can't play Item cards during this turn number (Budew's Itchy Pollen). */
  itemLockTurn: number;
  koLastTurn: boolean;
  koByAttackLastTurn: boolean;
  koThisTurn: boolean;
  koByAttackThisTurn: boolean;
  mulligans: number;
  /**
   * Cards this player put on top of their own deck in a known order, top first (Ciphermaniac's Codebreaking,
   * Academy at Night). Only the part still on top counts (knownTopCards() in state.ts); a shuffle clears it.
   */
  knownTop: CardId[];
}

export interface Rules {
  /** Twin Shotels ignores "effects on those Pokémon"; whether that includes Rabsca/Shaymin is unsettled. */
  twinShotelsPiercesBenchShields: boolean;
  /**
   * Player 0 (the play screen's player) picks which face-down Prize cards to take, by position, as at a real table.
   * Off for bots: they take them in order, and their look-ahead turns it off (engine/view.ts determinize()).
   */
  pickPrizes?: boolean;
}

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
  /** Number of actions applied before this entry was written; lets the UI rebuild the board at that point. */
  step: number;
}

export interface ChoiceOption {
  value: number;
  label: string;
  card?: CardId;
  slot?: SlotId;
}

export type Purpose =
  | 'first'
  | 'mulligan-draw'
  | 'setup-active'
  | 'setup-bench'
  | 'promote'
  | 'search'
  | 'take'
  | 'discard'
  | 'discard-cost'
  | 'gust'
  | 'switch'
  | 'target'
  | 'attach'
  | 'counters'
  | 'energy'
  | 'yesno'
  | 'option'
  | 'order'
  | 'attack'
  | 'bench-trim';

export interface ChoiceRequest {
  player: PlayerId;
  purpose: Purpose;
  prompt: string;
  options: ChoiceOption[];
  min: number;
  max: number;
  /** The same option may be picked more than once (placing damage counters one at a time). */
  repeat?: boolean;
  /** Pick order matters (cards put on top of the deck). */
  ordered?: boolean;
  /** Options show cards only the chooser may see (deck search). */
  secret?: boolean;
  /**
   * The cards the chooser is looking at, of which `options` are the ones it may take: the whole deck for a deck
   * search, the top cards for "look at the top N". The play screen shows them all, as at a real table.
   */
  view?: CardId[];
  /** Card key whose effect asked. */
  source?: string;
  /** Free-form hint for bots, e.g. what the chosen thing will be used for. */
  hint?: string;
}

export type Action =
  | { t: 'setup' }
  | { t: 'bench'; card: CardId }
  | { t: 'evolve'; card: CardId; target: SlotId }
  | { t: 'energy'; card: CardId; target: SlotId }
  | { t: 'tool'; card: CardId; target: SlotId }
  | { t: 'trainer'; card: CardId }
  | { t: 'ability'; slot: SlotId; name: string }
  | { t: 'stadium' }
  | { t: 'retreat'; to: SlotId }
  | { t: 'attack'; name: string; from?: SlotId }
  | { t: 'end' }
  | { t: 'choose'; picks: number[] };

export interface Pending {
  /** State before the action started; the action is re-run from here with the answers so far. */
  base: GameState;
  action: Action;
  answers: number[][];
  request: ChoiceRequest;
}

export interface GameState {
  seed: number;
  turn: number;
  current: PlayerId;
  first: PlayerId;
  phase: 'setup' | 'main' | 'over';
  players: [PlayerState, PlayerState];
  stadium: { card: CardId; owner: PlayerId } | null;
  cards: readonly CardInst[];
  rng: { shuffle: [number, number]; coin: number };
  nextUid: number;
  pending: Pending | null;
  winner: PlayerId | 'draw' | null;
  winReason: string;
  log: LogEntry[];
  /** Skip log writes (bot look-ahead). */
  quiet: boolean;
  /** Actions applied so far (for log steps and replay). */
  steps: number;
  rules: Rules;
  names: [string, string];
}

export interface DeckSpec {
  /** Card keys, one per card (60). */
  cards: string[];
  name: string;
}
