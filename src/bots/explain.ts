// Why the hint button suggests a move (PLAN.md v2: "พร้อมเหตุผล"): a reason read from the position,
// plus facts from playing the move out on a determinized copy, so hidden cards never leak.
import type { PokemonCard } from '../data/cards';
import { tx } from '../i18n';
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
export const beforeAttack = () => tx('ทำก่อนโจมตี เพราะโจมตีแล้วเทิร์นจะจบทันที', 'Do it before attacking: attacking ends the turn');

// What an Ability does, [Thai, English] (cards in your list; others fall back to the name).
const ABILITY: Record<string, [string, string]> = {
  'Run Errand': ['จั่ว 2 ใบ (ใช้ได้ตอนเป็นตัวหลัก)', 'draw 2 cards (while Active)'],
  'Last-Ditch Catch': ['ค้น Supporter จากเด็คเข้ามือตอนลง Bench', 'search your deck for a Supporter when it goes onto the Bench'],
  'Teal Dance': ['ติด Grass Energy จากมือเพิ่มอีกใบแล้วจั่ว 1 ใบ (นอกจากการติดปกติ)', 'attach one more Grass Energy from your hand and draw a card (besides the usual attachment)'],
  Skyliner: ['Basic Pokémon ของคุณถอยฟรี', 'your Basic Pokémon retreat for free'],
  'Fairy Zone': ['Pokémon {N} ของอีกฝั่งแพ้ทาง Psychic (×2)', "your opponent's {N} Pokémon are weak to Psychic (×2)"],
  'Flip the Script': ['จั่ว 3 ใบ ถ้าเทิร์นก่อน Pokémon ของคุณโดน KO', 'draw 3 cards if one of your Pokémon was Knocked Out last turn'],
  'Snow Sink': ['ทิ้ง Stadium ตอนลง Bench', 'discard the Stadium when it goes onto the Bench'],
  'Rapid Vernier': ['สลับขึ้นเป็นตัวหลักตอนลง Bench แล้วย้ายพลังงานมาได้', 'switch in when it goes onto the Bench and move Energy to it'],
  'Cobalt Command': ['Future Pokémon ตัวอื่นตีตัวหลักแรงขึ้น 20', 'your other Future Pokémon do 20 more to the Active Pokémon'],
  'Seasoned Skill': ['Blood Moon ใช้พลังงานน้อยลง 1 ต่อ Prize ที่อีกฝั่งเอาไปแล้ว', 'Blood Moon costs 1 less Energy for each Prize card your opponent has taken'],
};
const winNow = () => tx('ชนะเกมทันที', 'Wins the game');
const abilityText = (name: string): string | undefined => (ABILITY[name] ? tx(...ABILITY[name]) : undefined);

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
  if (after.winner === me) return [winNow()];
  const o = opp(me);
  const out: string[] = [];
  const turnOver = after.current !== me || after.turn !== before.turn;

  // The opponent's side: Knock Outs, damage, a new Active.
  const theirsNow = new Map(slotsOf(after.players[o]).map((sl) => [sl.uid, sl]));
  for (const sl of slotsOf(before.players[o])) {
    const now = theirsNow.get(sl.uid);
    const name = topDef(before, sl).name;
    if (!now) out.push(`KO ${name}`);
    else if (now.damage > sl.damage) out.push(tx(`${name} โดน ${now.damage - sl.damage} (เหลือ ${hpLeft(after, now)} HP)`, `${name} takes ${now.damage - sl.damage} (${hpLeft(after, now)} HP left)`));
  }
  const took = before.players[me].prizes.length - after.players[me].prizes.length;
  if (took > 0) out.push(tx(`ได้ ${took} Prize (เหลืออีก ${after.players[me].prizes.length})`, `Takes ${took} Prize ${took === 1 ? 'card' : 'cards'} (${after.players[me].prizes.length} left)`));
  const oldActive = before.players[o].active;
  const newActive = after.players[o].active;
  if (oldActive && newActive && newActive.uid !== oldActive.uid && theirsNow.has(oldActive.uid)) {
    out.push(tx(`${topDef(after, newActive).name} ถูกดึงขึ้นมาเป็นตัวหลักของอีกฝั่ง`, `${topDef(after, newActive).name} is dragged up as the opponent's Active Pokémon`));
  }

  // Your side.
  const mineBefore = new Map(slotsOf(before.players[me]).map((sl) => [sl.uid, sl]));
  const ps = after.players[me];
  if (ps.active && before.players[me].active && ps.active.uid !== before.players[me].active!.uid) {
    out.push(tx(`${topDef(after, ps.active).name} ขึ้นมาเป็นตัวหลัก`, `${topDef(after, ps.active).name} becomes Active`));
  }
  const added = ps.bench.filter((sl) => !mineBefore.has(sl.uid)).map((sl) => topDef(after, sl).name);
  if (added.length) out.push(tx(`ลง ${added.join(', ')} บน Bench (${ps.bench.length}/${benchLimit(after, me)})`, `${added.join(', ')} onto the Bench (${ps.bench.length}/${benchLimit(after, me)})`));
  for (const sl of slotsOf(ps)) {
    const prev = mineBefore.get(sl.uid);
    if (!prev) continue;
    const name = topDef(after, sl).name;
    if (topKey(after, sl) !== topKey(before, prev)) out.push(tx(`${topDef(before, prev).name} วิวัฒนาการเป็น ${name}`, `${topDef(before, prev).name} evolves into ${name}`));
    if (sl.energy.length > prev.energy.length) out.push(tx(`${name} มีพลังงาน ${prev.energy.length} → ${sl.energy.length} ใบ`, `${name} Energy ${prev.energy.length} → ${sl.energy.length}`));
    if (sl.energy.length < prev.energy.length) out.push(tx(`${name} ทิ้ง/ย้ายพลังงานออก ${prev.energy.length - sl.energy.length} ใบ`, `${name} loses ${prev.energy.length - sl.energy.length} Energy (discarded or moved)`));
    if (toolKey(after, sl) && !toolKey(before, prev)) out.push(tx(`${name} ติด ${def(toolKey(after, sl)!).name}`, `${name} gets ${def(toolKey(after, sl)!).name}`));
    if (sl.damage > prev.damage) out.push(tx(`${name} ของคุณโดน ${sl.damage - prev.damage}`, `Your ${name} takes ${sl.damage - prev.damage}`));
  }

  if (!turnOver) {
    const h0 = before.players[me].hand.length;
    const h1 = ps.hand.length;
    // Playing the card itself costs one; only report real draws or discards.
    if (h1 !== h0 - 1 && h1 !== h0) out.push(tx(`มือ ${h0} → ${h1} ใบ`, `Hand ${h0} → ${h1} cards`));
    const costs = ps.discard.filter((c) => c !== played && !before.players[me].discard.includes(c) && before.players[me].hand.includes(c));
    // The chooser's pick, as an example: you choose the discards yourself.
    if (costs.length) out.push(tx(`ต้องทิ้งจากมือ ${costs.length} ใบ เช่น ${costs.map((c) => def(keyOf(after, c)).name).join(', ')}`, `Discards ${costs.length} from hand, e.g. ${costs.map((c) => def(keyOf(after, c)).name).join(', ')}`));
    const oh0 = before.players[o].hand.length;
    const oh1 = after.players[o].hand.length;
    if (oh1 !== oh0) out.push(tx(`มือบอท ${oh0} → ${oh1} ใบ`, `Bot's hand ${oh0} → ${oh1} cards`));
  }
  const st0 = stadiumKey(before);
  const st1 = stadiumKey(after);
  if (st0 !== st1) out.push(st1 ? tx(`Stadium เป็น ${def(st1).name}`, `Stadium is now ${def(st1).name}`) : tx(`ทิ้ง Stadium ${def(st0!).name}`, `Stadium ${def(st0!).name} discarded`));
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
  if (target && dmg >= hpLeft(s, target)) return tx(` (~${dmg} ดาเมจ พอ KO ${topDef(s, target).name} ที่เหลือ ${hpLeft(s, target)} HP)`, ` (~${dmg} damage, enough to KO ${topDef(s, target).name} at ${hpLeft(s, target)} HP)`);
  return tx(` (~${dmg} ดาเมจ)`, ` (~${dmg} damage)`);
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
      if (ready) why = tx(`${name} ใช้ ${ready.at.name} ได้ทันทีหลังติด${dmgText(s, me, ready.dmg)}`, `${name} can use ${ready.at.name} right after this${dmgText(s, me, ready.dmg)}`);
      else if (closer) why = tx(`${name} ขาดอีก ${closer.after} พลังงานสำหรับ ${closer.at.name}${dmgText(s, me, closer.dmg)}`, `${name} is ${closer.after} Energy short of ${closer.at.name}${dmgText(s, me, closer.dmg)}`);
      else if (k === 'enriching-energy') why = tx('Enriching Energy จั่ว 4 ใบตอนติด', 'Enriching Energy draws 4 cards when attached');
      else why = tx(`เผื่อค่าถอยหรือท่าที่นับพลังงานของ ${name}`, `For ${name}'s Retreat Cost or attacks that count Energy`);
      if (ps.active?.uid !== sl.uid) facts.push(tx('เตรียมตัวบน Bench ให้พร้อมขึ้นมาตีเทิร์นถัดไป', 'Gets a Benched Pokémon ready to attack next turn'));
      facts.push(tx('ติดพลังงานจากมือได้เทิร์นละ 1 ใบ', 'You can attach 1 Energy from your hand per turn'));
      return { why, facts };
    }
    case 'bench': {
      const k = keyOf(s, a.card);
      const d = def(k) as PokemonCard;
      const ability = d.abilities[0]?.name;
      const rank = plan.attackers.indexOf(k);
      let why: string;
      if (k === 'meowth-ex') why = tx(`${d.name}: ${abilityText('Last-Ditch Catch')} (มือคุณยังไม่มี Supporter)`, `${d.name}: ${abilityText('Last-Ditch Catch')} (no Supporter in your hand yet)`);
      else if (k === 'chien-pao' && s.stadium && s.stadium.owner !== me) why = tx(`${d.name} ทิ้ง ${def(stadiumKey(s)!).name} ของอีกฝั่งตอนลง Bench`, `${d.name} discards the opponent's ${def(stadiumKey(s)!).name} when it goes onto the Bench`);
      else if (k === 'iron-leaves-ex') why = `${d.name}: ${abilityText('Rapid Vernier')}`;
      // The top attackers are benched to power up; for the rest, the Ability is usually the point.
      else if (rank >= 0 && (rank < 2 || (rank < 4 && !ability))) why = tx(`${d.name} เป็นตัวตีหลักของเด็ค ลงไว้ก่อนเพื่อทยอยติดพลังงาน`, `${d.name} is the deck's main attacker: down early to build up Energy`);
      else if (ability) why = tx(`ลง ${d.name} เพื่อใช้ Ability ${ability}${abilityText(ability) ? `: ${abilityText(ability)}` : ''}`, `${d.name} for its Ability ${ability}${abilityText(ability) ? `: ${abilityText(ability)}` : ''}`);
      else why = tx(`เพิ่ม ${d.name} เป็นตัวสำรองบน Bench`, `${d.name} as a backup on the Bench`);
      if (ps.bench.length === 0) facts.push(tx('ตอนนี้ Bench ว่าง ถ้าตัวหลักโดน KO จะแพ้ทันที', 'Your Bench is empty: if your Active Pokémon is Knocked Out, you lose'));
      if (d.prizes >= 2) facts.push(tx(`${d.name} ให้อีกฝั่ง ${d.prizes} Prize ถ้าโดน KO (ระวัง Boss's Orders)`, `${d.name} gives up ${d.prizes} Prize cards if Knocked Out (watch out for Boss's Orders)`));
      return { why, facts };
    }
    case 'evolve': {
      const sl = slotById(s, a.target)!;
      const d = def(keyOf(s, a.card)) as PokemonCard;
      const from = topDef(s, sl);
      const hp = maxHp(s, sl);
      const gained = d.attacks.filter((x) => !from.attacks.some((y) => y.name === x.name)).map((x) => `${x.name} ${x.damage}`.trim());
      const ability = d.abilities[0]?.name;
      if (ability) facts.push(tx(`ได้ Ability ${ability}${abilityText(ability) ? `: ${abilityText(ability)}` : ''}`, `Gains the Ability ${ability}${abilityText(ability) ? `: ${abilityText(ability)}` : ''}`));
      if (gained.length) facts.push(tx(`ได้ท่า ${gained.join(', ')}`, `Gains ${gained.join(', ')}`));
      return { why: `${from.name} → ${d.name}: HP ${hp} → ${hp - from.hp + d.hp}`, facts };
    }
    case 'tool': {
      const k = keyOf(s, a.card);
      const sl = slotById(s, a.target)!;
      const name = topDef(s, sl).name;
      if (k === 'heros-cape') return { why: tx(`${name} HP ${maxHp(s, sl)} → ${maxHp(s, sl) + 100} อีกฝั่ง KO ยากขึ้นมาก`, `${name} HP ${maxHp(s, sl)} → ${maxHp(s, sl) + 100}: much harder to Knock Out`), facts };
      if (k === 'air-balloon') return { why: tx(`ค่าถอยของ ${name} ลดลง 2`, `${name}'s Retreat Cost drops by 2`), facts };
      return { why: `${fallback}`, facts };
    }
    case 'retreat': {
      const act = ps.active!;
      const to = slotById(s, a.to)!;
      const ready = attackInfo(s, to).filter((x) => x.before === 0).sort((x, y) => y.dmg - x.dmg)[0];
      const why = ready
        ? tx(`${topDef(s, to).name} ตีได้เลยด้วย ${ready.at.name}${dmgText(s, me, ready.dmg)}`, `${topDef(s, to).name} can attack right away with ${ready.at.name}${dmgText(s, me, ready.dmg)}`)
        : tx(`${topDef(s, act).name} ไม่ควรอยู่หน้า ให้ ${topDef(s, to).name} รับหน้าที่แทน`, `${topDef(s, act).name} shouldn't stay Active: ${topDef(s, to).name} takes over`);
      const cost = retreatCost(s, me, act);
      facts.push(cost === 0 ? tx('ถอยฟรี', 'Free retreat') : tx(`ค่าถอย ${cost} พลังงาน`, `Retreat Cost ${cost} Energy`));
      return { why, facts };
    }
    case 'ability': {
      const text = abilityText(a.name);
      return { why: text ? `${a.name}: ${text}` : fallback, facts };
    }
    case 'attack':
      return { why: tx(`โจมตีด้วย ${a.name}`, `Attack with ${a.name}`), facts };
    case 'trainer': {
      const k = keyOf(s, a.card);
      const h = ps.hand.length - 1;
      if (isTrainerType(k, 'Supporter')) facts.push(tx('ใช้ Supporter ได้เทิร์นละ 1 ใบ', 'You can play 1 Supporter per turn'));
      switch (k) {
        case 'lillies-determination':
          return { why: tx(`มือเหลือ ${h} ใบหลังใช้ สับคืนแล้วจั่วใหม่ ${ps.prizes.length === 6 ? 8 : 6} ใบ`, `${h} cards in hand after it: shuffle them back and draw ${ps.prizes.length === 6 ? 8 : 6}`), facts };
        case 'judge':
          return { why: tx(`ทั้งสองฝั่งสับมือแล้วจั่ว 4: มือคุณ ${h} → 4, มือบอท ${o.hand.length} → 4`, `Both sides shuffle their hands and draw 4: your hand ${h} → 4, the bot's ${o.hand.length} → 4`), facts };
        case 'ultra-ball': {
          const best = bestHidden(s, me, plan, isPokemon);
          return { why: tx(`ค้น Pokémon ที่ยังขาด${best ? ` เช่น ${best}` : ''} แลกกับทิ้ง 2 ใบ`, `Search for a missing Pokémon${best ? ` such as ${best}` : ''} for 2 discards`), facts };
        }
        case 'cyrano': {
          const best = bestHidden(s, me, plan, (x) => isPokemon(x) && (def(x) as PokemonCard).prizes >= 2);
          return { why: tx(`ค้น Pokémon ex ได้ถึง 3 ตัว${best ? ` เช่น ${best}` : ''}`, `Search for up to 3 Pokémon ex${best ? ` such as ${best}` : ''}`), facts };
        }
        case 'crispin':
          return { why: tx('ค้น Basic Energy 2 ชนิด: เข้ามือ 1 ติดให้ Pokémon 1 (เร่งพลังงานเกินเทิร์นละใบ)', 'Search for 2 kinds of Basic Energy: 1 to your hand, 1 attached to a Pokémon (more than 1 Energy a turn)'), facts };
        case 'ciphermaniacs-codebreaking':
          return { why: tx('ค้น 2 ใบที่ต้องใช้มาวางบนเด็ค จั่วได้เทิร์นถัดไป', 'Put the 2 cards you need on top of your deck, to draw next turn'), facts };
        case 'special-red-card':
          return { why: tx(`มือบอท ${o.hand.length} ใบ: ล้างมือแล้วจั่วแค่ 3`, `The bot has ${o.hand.length} cards: it loses them and draws only 3`), facts };
        case 'unfair-stamp':
          return { why: tx(`มือบอท ${o.hand.length} ใบ → เหลือ 2 (ใช้ได้หลังโดน KO)`, `The bot's hand ${o.hand.length} → 2 (playable after a Knock Out)`), facts };
        case 'night-stretcher': {
          let best = '';
          let bestV = -Infinity;
          for (const c of ps.discard) {
            const x = keyOf(s, c);
            const v = cardValue(s, me, x, plan);
            if ((isPokemon(x) || def(x).category === 'energy') && v > bestV) [best, bestV] = [def(x).name, v];
          }
          return { why: tx(`เก็บ ${best || 'การ์ด'} จากกองทิ้งกลับเข้ามือ`, `Gets ${best || 'a card'} back from the discard pile`), facts };
        }
        case 'glass-trumpet':
          return { why: tx('ติดพลังงานจากกองทิ้งให้ Pokémon {C} บน Bench 2 ตัว (เร่งพลังงาน)', 'Attaches Energy from the discard pile to 2 Benched {C} Pokémon (extra Energy)'), facts };
        case 'area-zero-underdepths':
          return {
            why: s.stadium && s.stadium.owner !== me ? tx(`แทน ${def(stadiumKey(s)!).name} ของอีกฝั่ง และ Bench ได้ถึง 8 ตัวเมื่อมี Tera`, `Replaces the opponent's ${def(stadiumKey(s)!).name}, and the Bench holds 8 with a Tera Pokémon`) : tx('มี Tera Pokémon: Bench ได้ถึง 8 ตัว', 'With a Tera Pokémon: the Bench holds 8'),
            facts,
          };
      }
      if (isTrainerType(k, 'Stadium') && s.stadium && s.stadium.owner !== me) {
        return { why: tx(`แทน ${def(stadiumKey(s)!).name} ของอีกฝั่ง`, `Replaces the opponent's ${def(stadiumKey(s)!).name}`), facts };
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
  const headline = effects.find((f) => f.startsWith('KO ') || f === winNow());
  const why = step.action.t === 'attack' && headline ? `${r.why}: ${headline}` : r.why;
  return { title, why, facts: [...r.facts, ...effects.filter((f) => f !== headline || step.action.t !== 'attack')] };
}

/** A move sequence ending in an attack (the finisher's plan): what each step does and the result. */
export function explainPlan(s: GameState, me: PlayerId, fin: Finish, plan: DeckPlan): Explanation {
  const { states, end } = simulate(s, me, fin.steps, plan);
  const labels = fin.steps.slice(0, states.length).map((st, i) => stepLabel(states[i]!, st));
  const effects = states.length ? effectFacts(states[0]!, end, me) : [];
  const headline = effects.find((f) => f.startsWith('KO ') || f === winNow()) ?? effects[0];
  const first = labels[0] ?? describeAction(s, fin.steps[0]!.action);
  const title = labels.length > 1 ? tx(`${first} (ขั้น 1 จาก ${labels.length})`, `${first} (step 1 of ${labels.length})`) : first;
  const why = labels.length > 1 ? tx(`แผนเทิร์นนี้: ${labels.join(' → ')}`, `This turn's plan: ${labels.join(' → ')}`) : `${first}${headline ? `: ${headline}` : ''}`;
  return { title, why, facts: effects.filter((f) => labels.length > 1 || f !== headline) };
}

/** When nothing is worth doing: why not attack. */
export function explainEnd(s: GameState, me: PlayerId): Explanation {
  const ps = s.players[me];
  const facts: string[] = [];
  if (s.turn === 1) facts.push(tx('ผู้เล่นที่ไปก่อนโจมตีไม่ได้ในเทิร์นแรก', "The player going first can't attack on the first turn"));
  else if (ps.active) {
    const near = attackInfo(s, ps.active).sort((x, y) => x.before - y.before || y.dmg - x.dmg)[0];
    if (near && near.before > 0) facts.push(tx(`${topDef(s, ps.active).name} ยังขาดพลังงาน ${near.before} สำหรับ ${near.at.name}`, `${topDef(s, ps.active).name} is ${near.before} Energy short of ${near.at.name}`));
  }
  if (ps.energyAttached) facts.push(tx('ติดพลังงานของเทิร์นนี้ไปแล้ว', "This turn's Energy is already attached"));
  return { title: tx('จบเทิร์น', 'End turn'), why: tx('ไม่มีการกระทำที่ได้ประโยชน์เพิ่มในเทิร์นนี้', 'Nothing else is worth doing this turn'), facts };
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
    if (k === 'bosss-orders' && pickName(0)) return tx(`${name} ดึง ${pickName(0)} ขึ้นมา`, `${name} on ${pickName(0)}`);
    if (k === 'switch' && pickName(0)) return tx(`${name} เอา ${pickName(0)} ขึ้นมา`, `${name} to ${pickName(0)}`);
    if (k === 'energy-switch' && st.picks?.length === 3) return tx(`${name} ย้ายพลังงานจาก ${pickName(0)} ไป ${pickName(2)}`, `${name} from ${pickName(0)} to ${pickName(2)}`);
  }
  if (a.t === 'attack') return tx(`โจมตี ${a.name}`, `Attack: ${a.name}`);
  return describeAction(s, a);
}
