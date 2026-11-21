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
  // What a player can know without seeing hidden cards (BOT-NEXT.md N4): kept here so the bots, their look-ahead
  // (determinize) and the review read it alike. Optional: states built before these existed lack them.
  /** This player has looked through their whole deck since the Prize cards were set, so knows which cards are Prizes. */
  prizesKnown?: boolean;
  /** Cards in this player's hand the opponent saw go there: revealed by a search, or taken from the discard pile or play (revealedHand()). */
  revealed?: CardId[];
  /** Cards this player played from the hand this turn (Bench, evolution, attached, Trainers), and in their turn before. */
  played?: CardId[];
  lastPlayed?: CardId[];
  /** The attack this player used this turn and the damage it did to the opponent's Pokémon; the same for their turn before. */
  attacked?: { name: string; damage: number } | null;
  lastAttack?: { name: string; damage: number } | null;
  /** Prize cards left when this player's turn began, and the Prize cards they took in their turn before. */
  turnPrizes?: number;
  lastPrizes?: number;
}

export interface Rules {
  /** Twin Shotels ignores "effects on those Pokémon"; whether that includes Rabsca/Shaymin is unsettled. */
  twinShotelsPiercesBenchShields: boolean;
  /**
   * Player 0 (the play screen's player) picks which face-down Prize cards to take, by position, as at a real table.
   * Off for bots: they take them in order, and their look-ahead turns it off (engine/view.ts determinize()).
   */
  pickPrizes?: boolean;
  /**
   * The rules a saved game was played under (state.ts RULES_VERSION now; review/record.ts replay() gives games saved
   * without one 1): what has been fixed since is kept as it was for older games, so they replay. Version 1, until
   * 21 Nov 2026: the extra cards for mulligans were drawn before setting up, and Metallic Hammer's 150 more needed
   * 3 {M} Energy to discard.
   */
  version?: number;
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
