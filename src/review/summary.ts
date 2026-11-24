// The review page's reading of a reviewed game (pure, tested in tests/ui/review-summary.test.ts): the turns worth a
// look and the one sentence that sums the game up, the points of the win% chart (where it moved on your turns and
// where on the bot's), and a turn's moves as lines with the card each one plays, to be shown as cards.
import { tx } from '../i18n';
import type { TurnReview, Verdict } from '../analysis/review';
import { actor, apply } from '../engine/actions';
import { stadiumKey } from '../engine/rules';
import { keyOf, slotsOf, topKey } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { describeAction } from '../ui/play';

const RANK: Record<Verdict, number> = { 'missed-win': 0, 'missed-ko': 1, better: 2, ok: 3 };

/** The turns worth a look, the clear mistakes first, then where the bot's turn gains the most. */
export function keyTurns(turns: readonly TurnReview[]): TurnReview[] {
  return turns
    .filter((t) => t.verdict !== 'ok')
    .sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || (b.alt?.diff ?? 0) - (a.alt?.diff ?? 0) || a.turn - b.turn);
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export interface ReviewSummary {
  /** One sentence: the turn that mattered most and what was there. */
  sentence: string;
  missed: number;
  better: number;
  /** The turn where the bot's way gains the most win%, and by how many points. */
  widest: { turn: number; points: number } | null;
}

export function reviewSummary(turns: readonly TurnReview[]): ReviewSummary {
  const key = keyTurns(turns);
  const missed = turns.filter((t) => t.verdict === 'missed-win' || t.verdict === 'missed-ko').length;
  const better = turns.filter((t) => t.verdict === 'better').length;
  const gain = turns.filter((t) => t.alt && t.alt.diff > 0).sort((a, b) => b.alt!.diff - a.alt!.diff)[0];
  const widest = gain ? { turn: gain.turn, points: Math.round(gain.alt!.diff * 100) } : null;
  const top = key[0];
  let sentence = turns.length
    ? tx('เกมนี้ไม่มีจุดพลาดชัด ๆ ทุกเทิร์นเล่นได้ใกล้เคียงกับบอท', 'No clear slip in this game: every turn is close to what the bot would play')
    : '';
  if (top?.missed?.kind === 'win') sentence = tx(`เทิร์น ${top.turn}: มีทางชนะเกมได้ในเทิร์นนั้น`, `Turn ${top.turn}: there was a way to win the game that turn`);
  else if (top?.missed) sentence = tx(
      `เทิร์น ${top.turn}: มีทาง KO ที่ได้ ${top.missed.prizes} Prize (คุณได้ ${top.missed.took})`,
      `Turn ${top.turn}: a Knock Out was there for ${top.missed.prizes} Prize cards (you took ${top.missed.took})`,
    );
  else if (top?.alt) sentence = tx(
      `เทิร์น ${top.turn}: ถ้าเล่นแบบบอท win% จะเป็น ${pct(top.alt.win.p)} แทนที่จะเป็น ${pct(top.win.p)}`,
      `Turn ${top.turn}: the bot's way gives a win% of ${pct(top.alt.win.p)} instead of ${pct(top.win.p)}`,
    );
  return { sentence, missed, better, widest };
}

export interface WinPoint {
  /** Position along the chart: two per turn of yours, its start then its end. */
  x: number;
  turn: number;
  p: number;
  at: 'start' | 'end';
}
export interface WinSegment {
  from: WinPoint;
  to: WinPoint;
  /** Your turn (start to end) or the bot's in between (the end of one of yours to the start of the next). */
  whose: 'mine' | 'theirs';
}

/** The win% chart: where each of your turns started and ended, and the moves between them, yours and the bot's. */
export function winPoints(turns: readonly TurnReview[]): { points: WinPoint[]; segments: WinSegment[] } {
  const sorted = [...turns].sort((a, b) => a.turn - b.turn);
  const points: WinPoint[] = sorted.flatMap((t, i) => [
    { x: 2 * i, turn: t.turn, p: t.before, at: 'start' as const },
    { x: 2 * i + 1, turn: t.turn, p: t.win.p, at: 'end' as const },
  ]);
  const segments: WinSegment[] = [];
  for (let i = 1; i < points.length; i++)
    segments.push({ from: points[i - 1]!, to: points[i]!, whose: points[i]!.at === 'end' ? 'mine' : 'theirs' });
  return { points, segments };
}

/** One move of a turn: its label and the card it plays (null for "จบเทิร์น"). */
export interface Move {
  label: string;
  key: string | null;
}

/** A turn played on the table: its states, the state shown at each step (0 = the start), and its moves. */
export interface Line {
  states: GameState[];
  actions: Action[];
  stops: number[];
  moves: Move[];
}

/** The card a move plays: the card from the hand, the Pokémon using an Ability or attacking, the one coming up. */
export function moveCard(s: GameState, a: Action, me: PlayerId): string | null {
  const ps = s.players[me];
  const slotKey = (uid: number) => {
    const sl = slotsOf(ps).find((x) => x.uid === uid);
    return sl ? topKey(s, sl) : null;
  };
  if ('card' in a) return keyOf(s, a.card);
  if (a.t === 'ability') return slotKey(a.slot);
  if (a.t === 'attack') return ps.active ? topKey(s, ps.active) : null;
  if (a.t === 'retreat') return slotKey(a.to);
  if (a.t === 'stadium') return stadiumKey(s) ?? null;
  return null;
}

/** `me`'s own moves (not answers to choices) cut a turn into steps; a step ends where the next move starts. */
export function turnLine(st: GameState[], acts: Action[], me: PlayerId): Line {
  const starts: number[] = [];
  for (let i = 0; i < acts.length; i++) if (actor(st[i]!) === me && acts[i]!.t !== 'choose') starts.push(i);
  const n = st.length - 1;
  return {
    states: st,
    actions: acts,
    stops: starts.length ? [0, ...starts.slice(1), n] : [n],
    moves: starts.map((i) => ({ label: describeAction(st[i]!, acts[i]!), key: moveCard(st[i]!, acts[i]!, me) })),
  };
}

/** A reviewed turn as you played it, and as the bot would have (replayed on the same cards; null when it plays alike). */
export function turnLines(states: GameState[], actions: Action[], t: TurnReview): { me: PlayerId; mine: Line; bot: Line | null } {
  const me = actor(states[t.span.start]!);
  const mine = turnLine(states.slice(t.span.start, t.span.end + 1), actions.slice(t.span.start, t.span.end), me);
  let bot: Line | null = null;
  if (t.alt?.actions) {
    try {
      const st = [states[t.span.start]!];
      for (const a of t.alt.actions) st.push(apply(st[st.length - 1]!, a, { trusted: true }));
      bot = turnLine(st, t.alt.actions, me);
    } catch {
      bot = null; // a turn saved by an older engine may not replay: the text still shows
    }
  }
  return { me, mine, bot };
}
