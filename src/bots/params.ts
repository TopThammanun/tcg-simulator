// The bots' main weights in one place, so self-play tuning (scripts/tune.ts, SPSA as chess engines use)
// can adjust them. Every bot reads `P`; a tuning run swaps it per bot around each decision (withParams).
// Values: tuned 2026-11-16 by 96,000 self-play games (16 chains × 3,000 SPSA steps); the tuned normal bot
// beat the hand-set one 51.6% of 8,000 fresh games (95% CI 50.5–52.7). The hand-set values are in git history.

export const DEFAULT_PARAMS = {
  // core.ts: development moves (score ~0–100)
  benchBase: 22.4,
  benchCardDiv: 2.45,
  meowth: 77.9,
  ruleBoxBenchPenalty: 17.4,
  evolve: 102,
  evolveActivePenalty: 22.9,
  pivotRetreat: 26,
  pivotGain: 64.8,
  energy: 30.4,
  /** A development move above this is played before the attack plan is looked at. */
  devThreshold: 8.87,
  /** Multipliers for the draw Supporters (Lillie's, Judge, Surfer) and search Items. */
  drawSupporter: 1.06,
  searchItem: 0.734,
  // finisher.ts: value of a line (outcome)
  prize: 193,
  damage: 0.301,
  ruleBoxDamage: 0.288,
  nearKo: 14.7,
  selfDamage: 0.278,
  discardTheirEnergy: 8.77,
  discardMyEnergy: 8.93,
  energyOnBoard: 0.497,
  handCard: 3.32,
  // knowledge.ts: who should attack
  missingEnergy: 53,
  attackerRank: 47.2,
  attackerRankStep: 9.86,
  attackerHpDiv: 12.9,
};

export type Params = typeof DEFAULT_PARAMS;
export type ParamName = keyof Params;

/** The weights in use. */
export let P: Params = DEFAULT_PARAMS;

export function setParams(p: Params): void {
  P = p;
}

/** A bot that decides with `p` (and puts the previous weights back afterwards). */
export function withParams<B extends { act(s: never): unknown }>(bot: B, p: Params): B {
  return {
    ...bot,
    act(s: never) {
      const before = P;
      P = p;
      try {
        return bot.act(s);
      } finally {
        P = before;
      }
    },
  } as B;
}
