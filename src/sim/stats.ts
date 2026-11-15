// Aggregate bot-vs-bot games into the numbers PLAN.md reports.
import type { GameStats } from './game';

export type GameRecord = Omit<GameStats, 'thinkMsByTurn'> & { seed: number; opp: string };

export interface Matchup {
  opp: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  /** 95% Wilson interval for the win rate. */
  ci: [number, number];
  avgTurns: number;
  /** Prizes the bot took per game, by the Pokémon it Knocked Out. */
  prizesBy: Record<string, number>;
  doubleAttacksPerGame: number;
  gladionRate: number;
  festivalOutRate: number;
  mulliganRate: [number, number];
  maxThinkMs: number;
}

export function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

export function summarize(opp: string, games: GameRecord[]): Matchup {
  const n = games.length;
  const wins = games.filter((g) => g.winner === 0).length;
  const losses = games.filter((g) => g.winner === 1).length;
  const prizesBy: Record<string, number> = {};
  for (const g of games) for (const [k, v] of Object.entries(g.prizesBy[1])) prizesBy[k] = (prizesBy[k] ?? 0) + v;
  for (const k of Object.keys(prizesBy)) prizesBy[k] = prizesBy[k]! / Math.max(n, 1);
  const avg = (f: (g: GameRecord) => number) => (n ? games.reduce((a, g) => a + f(g), 0) / n : 0);
  return {
    opp,
    games: n,
    wins,
    losses,
    draws: n - wins - losses,
    // Draws count as half a win.
    winRate: n ? (wins + (n - wins - losses) / 2) / n : 0,
    ci: wilson(wins + (n - wins - losses) / 2, n),
    avgTurns: avg((g) => g.turns),
    prizesBy,
    doubleAttacksPerGame: avg((g) => g.doubleAttacks[1]),
    gladionRate: avg((g) => (g.gladion[1] ? 1 : 0)),
    festivalOutRate: avg((g) => (g.festivalGroundsOut[1] ? 1 : 0)),
    mulliganRate: [avg((g) => (g.mulligan[0] ? 1 : 0)), avg((g) => (g.mulligan[1] ? 1 : 0))],
    maxThinkMs: Math.max(0, ...games.map((g) => g.maxThinkMs)),
  };
}

/**
 * Win rate weighted by meta share (PLAN.md: "win rate คาดหวังใน meta"), with a 95% interval from
 * the per-matchup binomial variances.
 */
export function metaWeighted(results: Matchup[], share: (opp: string) => number): { winRate: number; ci: [number, number] } {
  const ws = results.map((r) => share(r.opp));
  const total = ws.reduce((a, b) => a + b, 0) || 1;
  let wr = 0;
  let variance = 0;
  results.forEach((r, i) => {
    const w = ws[i]! / total;
    wr += w * r.winRate;
    if (r.games > 0) variance += (w * w * r.winRate * (1 - r.winRate)) / r.games;
  });
  const m = 1.96 * Math.sqrt(variance);
  return { winRate: wr, ci: [Math.max(0, wr - m), Math.min(1, wr + m)] };
}

const score = (g: GameRecord) => (g.winner === 0 ? 1 : g.winner === 1 ? 0 : 0.5);

/**
 * Meta-weighted difference B − A for an experiment run on the same seeds, with a 95% interval from
 * the per-seed paired differences (much tighter than comparing the two win rates separately).
 */
export function pairedDiff(a: GameRecord[], b: GameRecord[], share: (opp: string) => number): { diff: number; ci: [number, number] } {
  const byKey = new Map(a.map((g) => [`${g.opp}|${g.seed}`, g]));
  const perOpp = new Map<string, number[]>();
  for (const g of b) {
    const base = byKey.get(`${g.opp}|${g.seed}`);
    if (!base) continue;
    const xs = perOpp.get(g.opp) ?? [];
    xs.push(score(g) - score(base));
    perOpp.set(g.opp, xs);
  }
  const opps = [...perOpp.keys()];
  const total = opps.reduce((n, o) => n + share(o), 0) || 1;
  let diff = 0;
  let variance = 0;
  for (const o of opps) {
    const xs = perOpp.get(o)!;
    const w = share(o) / total;
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const v = xs.length > 1 ? xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1) : 0;
    diff += w * mean;
    variance += (w * w * v) / xs.length;
  }
  const m = 1.96 * Math.sqrt(variance);
  return { diff, ci: [diff - m, diff + m] };
}

export function toCsv(rows: Matchup[], label: string): string {
  const head = ['config', 'opponent', 'games', 'wins', 'losses', 'draws', 'win_rate', 'ci_low', 'ci_high', 'avg_turns', 'double_attacks_per_game', 'gladion_rate', 'festival_grounds_out_rate', 'mulligan_you', 'mulligan_bot'];
  const lines = rows.map((r) =>
    [label, r.opp, r.games, r.wins, r.losses, r.draws, r.winRate.toFixed(4), r.ci[0].toFixed(4), r.ci[1].toFixed(4), r.avgTurns.toFixed(2), r.doubleAttacksPerGame.toFixed(3), r.gladionRate.toFixed(3), r.festivalOutRate.toFixed(3), r.mulliganRate[0].toFixed(3), r.mulliganRate[1].toFixed(3)].join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
