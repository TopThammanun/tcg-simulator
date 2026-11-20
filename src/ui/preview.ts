// What an attack would do to the opponent's Active, shown on its button before you use it: played out on re-dealt
// copies of the position (determinize: hidden cards and coin flips drawn again, so it never peeks at the real ones),
// any question on the way answered with its first options. The damage (a range when coins or hidden cards decide
// it), the share of copies where the Active is Knocked Out, and whether Weakness or Resistance applies.
import { apply } from '../engine/actions';
import { weaknessOf } from '../engine/combat';
import { opp, slotsOf, topDef } from '../engine/state';
import { determinize } from '../engine/view';
import type { Action, GameState, PlayerId, SlotId } from '../engine/types';

export interface AttackPreview {
  /** Damage to the Active in the copies where it survives (both 0 when it never does). */
  min: number;
  max: number;
  /** Share of copies where the Active is Knocked Out (0–1). */
  ko: number;
  weak: boolean;
  resist: boolean;
}

/** About 4 ms in Node for a coin attack; the Knock Out share is then within a few points (shown to 5%). */
const SAMPLES = 96;

export function previewAttack(s: GameState, action: Extract<Action, { t: 'attack' }>, samples = SAMPLES): AttackPreview | null {
  if (s.pending || s.winner !== null) return null;
  const me = s.current;
  const target = s.players[opp(me)].active;
  const user = s.players[me].active;
  if (!target || !user) return null;
  const before = target.damage;
  const dealt: number[] = [];
  let kos = 0;
  for (let i = 0; i < samples; i++) {
    let n: GameState;
    try {
      n = apply(determinize(s, me, 0x5eed + i * 7919), action);
      for (let k = 0; n.pending && k < 40; k++) {
        const r = n.pending.request;
        n = apply(n, { t: 'choose', picks: r.options.slice(0, Math.max(r.min, Math.min(1, r.max))).map((o) => o.value) });
      }
    } catch {
      return null;
    }
    const now = find(n, target.uid);
    if (now) dealt.push(Math.max(0, now.damage - before));
    else if (n.players[opp(me)].discard.includes(target.stack[target.stack.length - 1]!)) kos++;
    else dealt.push(0);
  }
  const types = topDef(s, user).types;
  return {
    min: dealt.length ? Math.min(...dealt) : 0,
    max: dealt.length ? Math.max(...dealt) : 0,
    ko: kos / samples,
    weak: weaknessOf(s, target).some((w) => types.includes(w.type)),
    resist: topDef(s, target).resistances.some((r) => types.includes(r.type)),
  };
}

function find(s: GameState, uid: SlotId) {
  for (const p of [0, 1] as PlayerId[]) for (const sl of slotsOf(s.players[p])) if (sl.uid === uid) return sl;
  return null;
}

/**
 * The line under an attack: "KO ตัวหลักได้แน่นอน", "KO ตัวหลัก ~50% · ไม่ KO ก็เข้า 200", "เข้าตัวหลักจริง 40 (จุดอ่อน ×2)";
 * null when it does nothing to the Active.
 */
export function previewText(p: AttackPreview): string | null {
  const tags = [p.weak && 'จุดอ่อน ×2', p.resist && 'ต้านทาน'].filter(Boolean).join(', ');
  const range = p.min === p.max ? `${p.min}` : `${p.min}–${p.max}`;
  if (p.ko >= 1) return `KO ตัวหลักได้แน่นอน${tags ? ` (${tags})` : ''}`;
  if (p.ko > 0) {
    const pct = Math.min(95, Math.max(5, Math.round(p.ko * 20) * 5));
    return `KO ตัวหลัก ~${pct}% · ไม่ KO ก็เข้า ${range}${tags ? ` (${tags})` : ''}`;
  }
  if (p.max === 0) return null;
  return `เข้าตัวหลักจริง ${range}${tags ? ` (${tags})` : ''}`;
}
