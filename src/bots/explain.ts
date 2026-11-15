// Why the hint button suggests a move (PLAN.md v2: "พร้อมเหตุผล"): a reason read from the position,
// plus facts from playing the move out on a determinized copy, so hidden cards never leak.
import type { PokemonCard } from '../data/cards';
import { def, isPokemon, isTrainerType } from '../engine/db';
import { attackCost, benchLimit, energyOf, hpLeft, maxHp, provides, retreatCost, stadiumKey, toolKey } from '../engine/rules';
import { keyOf, opp, slotsOf, topDef, topKey } from '../engine/state';
import type { Action, CardId, GameState, PlayerId, Slot, SlotId } from '../engine/types';
import { determinize } from '../engine/view';
import { describeAction } from '../ui/play';
import { runStep, type Finish, type Step } from './finisher';
import { cardValue, missingFor, roughDamage } from './knowledge';
import type { DeckPlan } from './types';

export interface Explanation {
  /** The move as a button label, with its target. */
  title: string;
  why: string;
  facts: string[];
}

const SIM_SEED = 97;
export const BEFORE_ATTACK = 'ทำก่อนโจมตี เพราะโจมตีแล้วเทิร์นจะจบทันที';

// What an Ability does, in Thai (cards in your list; others fall back to the name).
const ABILITY: Record<string, string> = {
  'Run Errand': 'จั่ว 2 ใบ (ใช้ได้ตอนเป็นตัวหลัก)',
  'Last-Ditch Catch': 'ค้น Supporter จากเด็คเข้ามือตอนลง Bench',
  'Teal Dance': 'ติด Grass Energy จากมือเพิ่มอีกใบแล้วจั่ว 1 ใบ (นอกจากการติดปกติ)',
  Skyliner: 'Basic Pokémon ของคุณถอยฟรี',
  'Fairy Zone': 'Pokémon {N} ของอีกฝั่งแพ้ทาง Psychic (×2)',
  'Flip the Script': 'จั่ว 3 ใบ ถ้าเทิร์นก่อน Pokémon ของคุณโดน KO',
  'Snow Sink': 'ทิ้ง Stadium ตอนลง Bench',
  'Rapid Vernier': 'สลับขึ้นเป็นตัวหลักตอนลง Bench แล้วย้ายพลังงานมาได้',
  'Cobalt Command': 'Future Pokémon ตัวอื่นตีตัวหลักแรงขึ้น 20',
  'Seasoned Skill': 'Blood Moon ใช้พลังงานน้อยลง 1 ต่อ Prize ที่อีกฝั่งเอาไปแล้ว',
};

/** Play `steps` on a determinized copy until the turn ends; the states before each step and the end. */
function simulate(s: GameState, me: PlayerId, steps: Step[], plan: DeckPlan): { states: GameState[]; end: GameState } {
  const states: GameState[] = [];
  let cur = determinize(s, me, SIM_SEED);
  const root = cur;
  for (const st of steps) {
    if (cur.winner !== null || cur.current !== me) break;
    states.push(cur);
    try {
      cur = runStep(cur, st, plan);
    } catch {
      return { states, end: root };
    }
  }
  return { states, end: cur };
}

const slotById = (s: GameState, uid: SlotId): Slot | undefined => {
  for (const p of [0, 1] as const) {
    const sl = slotsOf(s.players[p]).find((x) => x.uid === uid);
    if (sl) return sl;
  }
  return undefined;
};

/** What changed for `me` between two states (the move's visible effects); `played` is the card used. */
export function effectFacts(before: GameState, after: GameState, me: PlayerId, played?: CardId): string[] {
  if (after.winner === me) return ['ชนะเกมทันที'];
  const o = opp(me);
  const out: string[] = [];
  const turnOver = after.current !== me || after.turn !== before.turn;

  // The opponent's side: Knock Outs, damage, a new Active.
  const theirsNow = new Map(slotsOf(after.players[o]).map((sl) => [sl.uid, sl]));
  for (const sl of slotsOf(before.players[o])) {
    const now = theirsNow.get(sl.uid);
    const name = topDef(before, sl).name;
    if (!now) out.push(`KO ${name}`);
    else if (now.damage > sl.damage) out.push(`${name} โดน ${now.damage - sl.damage} (เหลือ ${hpLeft(after, now)} HP)`);
  }
  const took = before.players[me].prizes.length - after.players[me].prizes.length;
  if (took > 0) out.push(`ได้ ${took} Prize (เหลืออีก ${after.players[me].prizes.length})`);
  const oldActive = before.players[o].active;
  const newActive = after.players[o].active;
  if (oldActive && newActive && newActive.uid !== oldActive.uid && theirsNow.has(oldActive.uid)) {
    out.push(`${topDef(after, newActive).name} ถูกดึงขึ้นมาเป็นตัวหลักของอีกฝั่ง`);
  }

  // Your side.
  const mineBefore = new Map(slotsOf(before.players[me]).map((sl) => [sl.uid, sl]));
  const ps = after.players[me];
  if (ps.active && before.players[me].active && ps.active.uid !== before.players[me].active!.uid) {
    out.push(`${topDef(after, ps.active).name} ขึ้นมาเป็นตัวหลัก`);
  }
  const added = ps.bench.filter((sl) => !mineBefore.has(sl.uid)).map((sl) => topDef(after, sl).name);
  if (added.length) out.push(`ลง ${added.join(', ')} บน Bench (${ps.bench.length}/${benchLimit(after, me)})`);
  for (const sl of slotsOf(ps)) {
    const prev = mineBefore.get(sl.uid);
    if (!prev) continue;
    const name = topDef(after, sl).name;
    if (topKey(after, sl) !== topKey(before, prev)) out.push(`${topDef(before, prev).name} วิวัฒนาการเป็น ${name}`);
    if (sl.energy.length > prev.energy.length) out.push(`${name} มีพลังงาน ${prev.energy.length} → ${sl.energy.length} ใบ`);
    if (sl.energy.length < prev.energy.length) out.push(`${name} ทิ้ง/ย้ายพลังงานออก ${prev.energy.length - sl.energy.length} ใบ`);
    if (toolKey(after, sl) && !toolKey(before, prev)) out.push(`${name} ติด ${def(toolKey(after, sl)!).name}`);
    if (sl.damage > prev.damage) out.push(`${name} ของคุณโดน ${sl.damage - prev.damage}`);
  }

  if (!turnOver) {
    const h0 = before.players[me].hand.length;
    const h1 = ps.hand.length;
    // Playing the card itself costs one; only report real draws or discards.
    if (h1 !== h0 - 1 && h1 !== h0) out.push(`มือ ${h0} → ${h1} ใบ`);
    const costs = ps.discard.filter((c) => c !== played && !before.players[me].discard.includes(c) && before.players[me].hand.includes(c));
    // The chooser's pick, as an example: you choose the discards yourself.
    if (costs.length) out.push(`ต้องทิ้งจากมือ ${costs.length} ใบ เช่น ${costs.map((c) => def(keyOf(after, c)).name).join(', ')}`);
    const oh0 = before.players[o].hand.length;
    const oh1 = after.players[o].hand.length;
    if (oh1 !== oh0) out.push(`มือบอท ${oh0} → ${oh1} ใบ`);
  }
  const st0 = stadiumKey(before);
  const st1 = stadiumKey(after);
  if (st0 !== st1) out.push(st1 ? `Stadium เป็น ${def(st1).name}` : `ทิ้ง Stadium ${def(st0!).name}`);
  return out;
}

/** The attack this Pokémon wants: the strongest one, or the closest to being paid for. */
function attackInfo(s: GameState, sl: Slot, extra?: ReturnType<typeof provides>) {
  const have = energyOf(s, sl);
  const next = extra ? [...have, extra] : have;
  return topDef(s, sl).attacks.map((at) => {
    const cost = attackCost(s, sl, at);
    return { at, dmg: roughDamage(s, sl, at), before: missingFor(have, cost), after: missingFor(next, cost) };
  });
}

function dmgText(s: GameState, me: PlayerId, dmg: number): string {
  if (dmg <= 0) return '';
  const target = s.players[opp(me)].active;
  if (target && dmg >= hpLeft(s, target)) return ` (~${dmg} ดาเมจ พอ KO ${topDef(s, target).name} ที่เหลือ ${hpLeft(s, target)} HP)`;
  return ` (~${dmg} ดาเมจ)`;
}

/** Best card for `me` among those still hidden from them (deck + prizes), by the deck plan's values. */
function bestHidden(s: GameState, me: PlayerId, plan: DeckPlan, f: (k: string) => boolean): string | undefined {
  const ps = s.players[me];
  let best: string | undefined;
  let bestV = -Infinity;
  for (const c of [...ps.deck, ...ps.prizes]) {
    const k = keyOf(s, c);
    if (!f(k)) continue;
    const v = cardValue(s, me, k, plan);
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  return best && def(best).name;
}

/** The reason for one move, read from the position (no look-ahead). */
function reasonFor(s: GameState, me: PlayerId, a: Action, plan: DeckPlan, fallback: string): { why: string; facts: string[] } {
  const ps = s.players[me];
  const o = s.players[opp(me)];
  const facts: string[] = [];
  switch (a.t) {
    case 'energy': {
      const k = keyOf(s, a.card);
      const sl = slotById(s, a.target)!;
      const name = topDef(s, sl).name;
      const info = attackInfo(s, sl, provides(k));
      const ready = info.filter((x) => x.after === 0 && x.before > 0).sort((x, y) => y.dmg - x.dmg)[0];
      const closer = info.filter((x) => x.after < x.before).sort((x, y) => x.after - y.after || y.dmg - x.dmg)[0];
      let why: string;
      if (ready) why = `${name} ใช้ ${ready.at.name} ได้ทันทีหลังติด${dmgText(s, me, ready.dmg)}`;
      else if (closer) why = `${name} ขาดอีก ${closer.after} พลังงานสำหรับ ${closer.at.name}${dmgText(s, me, closer.dmg)}`;
      else if (k === 'enriching-energy') why = 'Enriching Energy จั่ว 4 ใบตอนติด';
      else why = `เผื่อค่าถอยหรือท่าที่นับพลังงานของ ${name}`;
      if (ps.active?.uid !== sl.uid) facts.push('เตรียมตัวบน Bench ให้พร้อมขึ้นมาตีเทิร์นถัดไป');
      facts.push('ติดพลังงานจากมือได้เทิร์นละ 1 ใบ');
      return { why, facts };
    }
    case 'bench': {
      const k = keyOf(s, a.card);
      const d = def(k) as PokemonCard;
      const ability = d.abilities[0]?.name;
      const rank = plan.attackers.indexOf(k);
      let why: string;
      if (k === 'meowth-ex') why = `${d.name}: ${ABILITY['Last-Ditch Catch']} (มือคุณยังไม่มี Supporter)`;
      else if (k === 'chien-pao' && s.stadium && s.stadium.owner !== me) why = `${d.name} ทิ้ง ${def(stadiumKey(s)!).name} ของอีกฝั่งตอนลง Bench`;
      else if (k === 'iron-leaves-ex') why = `${d.name}: ${ABILITY['Rapid Vernier']}`;
      // The top attackers are benched to power up; for the rest, the Ability is usually the point.
      else if (rank >= 0 && (rank < 2 || (rank < 4 && !ability))) why = `${d.name} เป็นตัวตีหลักของเด็ค ลงไว้ก่อนเพื่อทยอยติดพลังงาน`;
      else if (ability) why = `ลง ${d.name} เพื่อใช้ Ability ${ability}${ABILITY[ability] ? `: ${ABILITY[ability]}` : ''}`;
      else why = `เพิ่ม ${d.name} เป็นตัวสำรองบน Bench`;
      if (ps.bench.length === 0) facts.push('ตอนนี้ Bench ว่าง ถ้าตัวหลักโดน KO จะแพ้ทันที');
      if (d.prizes >= 2) facts.push(`${d.name} ให้อีกฝั่ง ${d.prizes} Prize ถ้าโดน KO (ระวัง Boss's Orders)`);
      return { why, facts };
    }
    case 'evolve': {
      const sl = slotById(s, a.target)!;
      const d = def(keyOf(s, a.card)) as PokemonCard;
      const from = topDef(s, sl);
      const hp = maxHp(s, sl);
      const gained = d.attacks.filter((x) => !from.attacks.some((y) => y.name === x.name)).map((x) => `${x.name} ${x.damage}`.trim());
      const ability = d.abilities[0]?.name;
      if (ability) facts.push(`ได้ Ability ${ability}${ABILITY[ability] ? `: ${ABILITY[ability]}` : ''}`);
      if (gained.length) facts.push(`ได้ท่า ${gained.join(', ')}`);
      return { why: `${from.name} → ${d.name}: HP ${hp} → ${hp - from.hp + d.hp}`, facts };
    }
    case 'tool': {
      const k = keyOf(s, a.card);
      const sl = slotById(s, a.target)!;
      const name = topDef(s, sl).name;
      if (k === 'heros-cape') return { why: `${name} HP ${maxHp(s, sl)} → ${maxHp(s, sl) + 100} อีกฝั่ง KO ยากขึ้นมาก`, facts };
      if (k === 'air-balloon') return { why: `ค่าถอยของ ${name} ลดลง 2`, facts };
      return { why: `${fallback}`, facts };
    }
    case 'retreat': {
      const act = ps.active!;
      const to = slotById(s, a.to)!;
      const ready = attackInfo(s, to).filter((x) => x.before === 0).sort((x, y) => y.dmg - x.dmg)[0];
      const why = ready
        ? `${topDef(s, to).name} ตีได้เลยด้วย ${ready.at.name}${dmgText(s, me, ready.dmg)}`
        : `${topDef(s, act).name} ไม่ควรอยู่หน้า ให้ ${topDef(s, to).name} รับหน้าที่แทน`;
      const cost = retreatCost(s, me, act);
      facts.push(cost === 0 ? 'ถอยฟรี' : `ค่าถอย ${cost} พลังงาน`);
      return { why, facts };
    }
    case 'ability': {
      const text = ABILITY[a.name];
      return { why: text ? `${a.name}: ${text}` : fallback, facts };
    }
    case 'attack':
      return { why: `โจมตีด้วย ${a.name}`, facts };
    case 'trainer': {
      const k = keyOf(s, a.card);
      const h = ps.hand.length - 1;
      if (isTrainerType(k, 'Supporter')) facts.push('ใช้ Supporter ได้เทิร์นละ 1 ใบ');
      switch (k) {
        case 'lillies-determination':
          return { why: `มือเหลือ ${h} ใบหลังใช้ สับคืนแล้วจั่วใหม่ ${ps.prizes.length === 6 ? 8 : 6} ใบ`, facts };
        case 'judge':
          return { why: `ทั้งสองฝั่งสับมือแล้วจั่ว 4: มือคุณ ${h} → 4, มือบอท ${o.hand.length} → 4`, facts };
        case 'ultra-ball': {
          const best = bestHidden(s, me, plan, isPokemon);
          return { why: `ค้น Pokémon ที่ยังขาด${best ? ` เช่น ${best}` : ''} แลกกับทิ้ง 2 ใบ`, facts };
        }
        case 'cyrano': {
          const best = bestHidden(s, me, plan, (x) => isPokemon(x) && (def(x) as PokemonCard).prizes >= 2);
          return { why: `ค้น Pokémon ex ได้ถึง 3 ตัว${best ? ` เช่น ${best}` : ''}`, facts };
        }
        case 'crispin':
          return { why: 'ค้น Basic Energy 2 ชนิด: เข้ามือ 1 ติดให้ Pokémon 1 (เร่งพลังงานเกินเทิร์นละใบ)', facts };
        case 'ciphermaniacs-codebreaking':
          return { why: 'ค้น 2 ใบที่ต้องใช้มาวางบนเด็ค จั่วได้เทิร์นถัดไป', facts };
        case 'special-red-card':
          return { why: `มือบอท ${o.hand.length} ใบ: ล้างมือแล้วจั่วแค่ 3`, facts };
        case 'unfair-stamp':
          return { why: `มือบอท ${o.hand.length} ใบ → เหลือ 2 (ใช้ได้หลังโดน KO)`, facts };
        case 'night-stretcher': {
          let best = '';
          let bestV = -Infinity;
          for (const c of ps.discard) {
            const x = keyOf(s, c);
            const v = cardValue(s, me, x, plan);
            if ((isPokemon(x) || def(x).category === 'energy') && v > bestV) [best, bestV] = [def(x).name, v];
          }
          return { why: `เก็บ ${best || 'การ์ด'} จากกองทิ้งกลับเข้ามือ`, facts };
        }
        case 'glass-trumpet':
          return { why: 'ติดพลังงานจากกองทิ้งให้ Pokémon {C} บน Bench 2 ตัว (เร่งพลังงาน)', facts };
        case 'area-zero-underdepths':
          return {
            why: s.stadium && s.stadium.owner !== me ? `แทน ${def(stadiumKey(s)!).name} ของอีกฝั่ง และ Bench ได้ถึง 8 ตัวเมื่อมี Tera` : 'มี Tera Pokémon: Bench ได้ถึง 8 ตัว',
            facts,
          };
      }
      if (isTrainerType(k, 'Stadium') && s.stadium && s.stadium.owner !== me) {
        return { why: `แทน ${def(stadiumKey(s)!).name} ของอีกฝั่ง`, facts };
      }
      return { why: fallback, facts };
    }
    default:
      return { why: fallback, facts };
  }
}

/** One development move (bench, attach, draw…), as the coach suggests it. */
export function explainAction(s: GameState, me: PlayerId, step: Step, plan: DeckPlan, fallback = ''): Explanation {
  const title = describeAction(s, step.action);
  const r = reasonFor(s, me, step.action, plan, fallback || title);
  const { states, end } = simulate(s, me, [step], plan);
  const played = 'card' in step.action ? step.action.card : undefined;
  const effects = states.length ? effectFacts(states[0]!, end, me, played) : [];
  const headline = effects.find((f) => f.startsWith('KO ') || f === 'ชนะเกมทันที');
  const why = step.action.t === 'attack' && headline ? `${r.why}: ${headline}` : r.why;
  return { title, why, facts: [...r.facts, ...effects.filter((f) => f !== headline || step.action.t !== 'attack')] };
}

/** A move sequence ending in an attack (the finisher's plan): what each step does and the result. */
export function explainPlan(s: GameState, me: PlayerId, fin: Finish, plan: DeckPlan): Explanation {
  const { states, end } = simulate(s, me, fin.steps, plan);
  const labels = fin.steps.slice(0, states.length).map((st, i) => stepLabel(states[i]!, st));
  const effects = states.length ? effectFacts(states[0]!, end, me) : [];
  const headline = effects.find((f) => f.startsWith('KO ') || f === 'ชนะเกมทันที') ?? effects[0];
  const first = labels[0] ?? describeAction(s, fin.steps[0]!.action);
  const title = labels.length > 1 ? `${first} (ขั้น 1 จาก ${labels.length})` : first;
  const why = labels.length > 1 ? `แผนเทิร์นนี้: ${labels.join(' → ')}` : `${first}${headline ? `: ${headline}` : ''}`;
  return { title, why, facts: effects.filter((f) => labels.length > 1 || f !== headline) };
}

/** When nothing is worth doing: why not attack. */
export function explainEnd(s: GameState, me: PlayerId): Explanation {
  const ps = s.players[me];
  const facts: string[] = [];
  if (s.turn === 1) facts.push('ผู้เล่นที่ไปก่อนโจมตีไม่ได้ในเทิร์นแรก');
  else if (ps.active) {
    const near = attackInfo(s, ps.active).sort((x, y) => x.before - y.before || y.dmg - x.dmg)[0];
    if (near && near.before > 0) facts.push(`${topDef(s, ps.active).name} ยังขาดพลังงาน ${near.before} สำหรับ ${near.at.name}`);
  }
  if (ps.energyAttached) facts.push('ติดพลังงานของเทิร์นนี้ไปแล้ว');
  return { title: 'จบเทิร์น', why: 'ไม่มีการกระทำที่ได้ประโยชน์เพิ่มในเทิร์นนี้', facts };
}

function stepLabel(s: GameState, st: Step): string {
  const a = st.action;
  const pickName = (i: number) => {
    const uid = st.picks?.[i]?.[0];
    const sl = uid === undefined ? undefined : slotById(s, uid);
    return sl ? topDef(s, sl).name : '';
  };
  if (a.t === 'trainer') {
    const k = keyOf(s, a.card);
    const name = def(k).name;
    if (k === 'bosss-orders' && pickName(0)) return `${name} ดึง ${pickName(0)} ขึ้นมา`;
    if (k === 'switch' && pickName(0)) return `${name} เอา ${pickName(0)} ขึ้นมา`;
    if (k === 'energy-switch' && st.picks?.length === 3) return `${name} ย้ายพลังงานจาก ${pickName(0)} ไป ${pickName(2)}`;
  }
  if (a.t === 'attack') return `โจมตี ${a.name}`;
  return describeAction(s, a);
}
