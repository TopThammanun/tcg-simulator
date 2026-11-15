// Play one bot-vs-bot game and collect the statistics PLAN.md asks for.
import { actor, apply, createGame } from '../engine/actions';
import { checkInvariants } from '../engine/invariants';
import { keyOf, slotsOf, topDef } from '../engine/state';
import type { Action, DeckSpec, GameState, PlayerId, Rules } from '../engine/types';
import type { Bot } from '../bots/types';

export interface GameStats {
  winner: PlayerId | 'draw' | null;
  reason: string;
  turns: number;
  first: PlayerId;
  /** Prizes each side took, keyed by the name of the Knocked Out Pokémon. */
  prizesBy: [Record<string, number>, Record<string, number>];
  doubleAttacks: [number, number];
  gladion: [boolean, boolean];
  festivalGroundsOut: [boolean, boolean];
  mulligan: [boolean, boolean];
  /** Slowest single decision in ms (PLAN.md: under 200 ms per turn). */
  maxThinkMs: number;
  thinkMsByTurn: number[];
  actions: number;
}

export interface PlayOptions {
  seed: number;
  decks: [DeckSpec, DeckSpec];
  bots: [Bot, Bot];
  rules?: Partial<Rules>;
  checkInvariants?: boolean;
  maxActions?: number;
  /** Keep the action list (for replays). */
  record?: boolean;
}

export function playGame(o: PlayOptions): GameStats & { history?: Action[]; final: GameState } {
  let s = createGame({ seed: o.seed, decks: o.decks, rules: o.rules, quiet: !o.record });
  const stats: GameStats = {
    winner: null,
    reason: '',
    turns: 0,
    first: s.first,
    prizesBy: [{}, {}],
    doubleAttacks: [0, 0],
    gladion: [false, false],
    festivalGroundsOut: [false, false],
    mulligan: [false, false],
    maxThinkMs: 0,
    thinkMsByTurn: [],
    actions: 0,
  };
  const history: Action[] = [];
  const max = o.maxActions ?? 4000;
  let turnThink = 0;
  let turnOf = s.turn;

  while (s.winner === null && stats.actions < max) {
    const p = actor(s);
    const t0 = performance.now();
    const a = o.bots[p]!.act(s);
    const dt = performance.now() - t0;
    if (s.turn !== turnOf) {
      stats.thinkMsByTurn.push(turnThink);
      turnThink = 0;
      turnOf = s.turn;
    }
    if (!s.pending) turnThink += dt;
    stats.maxThinkMs = Math.max(stats.maxThinkMs, dt);

    if (s.pending && a.t === 'choose' && s.pending.request.prompt.startsWith('Festival Lead')) {
      const last = s.pending.request.options[s.pending.request.options.length - 1]!.value;
      if (a.picks[0] !== last) stats.doubleAttacks[p]++;
    }
    if (a.t === 'trainer' && keyOf(s, a.card) === 'gladions-final-battle') stats.gladion[p] = true;

    const before = s;
    s = apply(s, a);
    history.push(a);
    stats.actions++;
    if (!s.pending) recordKOs(before, s, stats);
    if (o.checkInvariants && !s.pending) {
      const problems = checkInvariants(s);
      if (problems.length) throw new Error(`seed ${o.seed}: ${problems.join('; ')}`);
    }
  }
  stats.thinkMsByTurn.push(turnThink);
  // Mulligans happen inside setup, after the first choice; read them at the end.
  stats.mulligan = [s.players[0].mulligans > 0, s.players[1].mulligans > 0];
  stats.winner = s.winner;
  stats.reason = s.winner === null ? 'action limit' : s.winReason;
  stats.turns = s.turn;
  for (const p of [0, 1] as const) {
    const ps = s.players[p];
    const left = [...ps.deck, ...ps.hand, ...ps.prizes].filter((c) => keyOf(s, c) === 'festival-grounds').length;
    const owned = s.cards.some((c) => c.owner === p && c.key === 'festival-grounds');
    const inPlay = s.stadium && keyOf(s, s.stadium.card) === 'festival-grounds' && s.stadium.owner === p;
    stats.festivalGroundsOut[p] = owned && left === 0 && !inPlay;
  }
  return { ...stats, history: o.record ? history : undefined, final: s };
}

/** Attribute prizes taken between two settled states to the Pokémon that left play. */
function recordKOs(before: GameState, after: GameState, stats: GameStats): void {
  for (const p of [0, 1] as const) {
    const taker = p === 0 ? 1 : 0;
    const took = before.players[taker].prizes.length - after.players[taker].prizes.length;
    if (took <= 0) continue;
    const gone = slotsOf(before.players[p]).filter((sl) => !slotsOf(after.players[p]).some((x) => x.uid === sl.uid));
    let left = took;
    for (const sl of gone) {
      const d = topDef(before, sl);
      const n = Math.min(left, d.prizes);
      if (n <= 0) continue;
      stats.prizesBy[taker][d.name] = (stats.prizesBy[taker][d.name] ?? 0) + n;
      left -= n;
    }
    if (left > 0) stats.prizesBy[taker]['อื่น ๆ'] = (stats.prizesBy[taker]['อื่น ๆ'] ?? 0) + left;
  }
}
