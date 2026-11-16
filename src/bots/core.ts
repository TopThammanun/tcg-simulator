// The shared bot: score "development" actions with cheap heuristics, and let the finisher (attack
// planner) decide gusts, boosts, switching and the attack. Deck plans tune both through hooks.
import { actor, legalActions } from '../engine/actions';
import { def, hasRuleBox, isBasicEnergy, isPokemon, isTrainerType } from '../engine/db';
import { hpLeft, provides, retreatCost } from '../engine/rules';
import { keyOf, opp, slotsOf, topDef, topKey } from '../engine/state';
import type { Action, GameState, PlayerId } from '../engine/types';
import { choosePicks } from './choose';
import { planFinish, type Finish } from './finisher';
import { attackerScore, cardValue, energyTarget } from './knowledge';
import { P } from './params';
import { makeRand, type Rand } from './random';
import type { Bot, DeckPlan } from './types';

export interface Scored {
  action: Action;
  score: number;
  reason: string;
  picks?: number[][];
}

const GUST_OR_BOOST = new Set(['bosss-orders', 'gladions-final-battle', 'black-belts-training', 'kieran']);
const DRAW_SUPPORTERS = new Set(['lillies-determination', 'judge', 'surfer']);
const FINISHER_ONLY = new Set(['energy-switch', 'switch']);
const MAX_ACTIONS_PER_TURN = 60;

export function makeBot(plan: DeckPlan, opts: { seed?: number } = {}): Bot {
  const rand = makeRand(opts.seed ?? 1);
  let queue: number[][] = [];
  let turn = -1;
  let actionsThisTurn = 0;

  return {
    act(s: GameState): Action {
      const me = actor(s);
      if (s.pending) {
        const req = s.pending.request;
        const forced = queue.shift();
        if (forced && forced.every((v) => req.options.some((o) => o.value === v)) && forced.length >= req.min && forced.length <= req.max) {
          return { t: 'choose', picks: forced };
        }
        queue = [];
        return { t: 'choose', picks: choosePicks(s, req, plan) };
      }
      if (s.turn !== turn) {
        turn = s.turn;
        actionsThisTurn = 0;
      }
      if (++actionsThisTurn > MAX_ACTIONS_PER_TURN) return { t: 'end' };
      const choice = decide(s, me, plan, rand);
      queue = choice.picks ? choice.picks.slice() : [];
      return choice.action;
    },
  };
}

/** The bot's next main-phase action, with a reason (also used by the coach). */
export function decide(s: GameState, me: PlayerId, plan: DeckPlan, rand: Rand): Scored {
  const ranked = rankDevelopment(s, me, plan);
  let best = ranked[0];
  const conflicts = best && (isSupporter(s, best.action) || best.action.t === 'energy');
  if (best && best.score > P.devThreshold && !conflicts) return best;

  const fin = planFinish(s, me, plan, Math.floor(rand() * 2 ** 31));
  const usable = ranked.filter(
    (r) => !(fin.usesSupporter && isSupporter(s, r.action)) && !(fin.usesEnergy && r.action.t === 'energy'),
  );
  best = usable[0];
  if (best && best.score > P.devThreshold) return best;
  return finishStep(s, fin);
}

export function finishStep(s: GameState, fin: Finish): Scored {
  const first = fin.steps[0];
  if (!first || fin.value <= 0) return { action: { t: 'end' }, score: 0, reason: 'ไม่มีอะไรคุ้มทำต่อ จบเทิร์น' };
  return { action: first.action, picks: first.picks, score: fin.value, reason: finishReason(s, fin) };
}

function finishReason(s: GameState, fin: Finish): string {
  const atk = fin.steps.find((st) => st.action.t === 'attack')?.action;
  const name = atk && atk.t === 'attack' ? atk.name : '';
  const first = fin.steps[0]!.action;
  const what =
    first.t === 'attack'
      ? `โจมตีด้วย ${first.name}`
      : first.t === 'trainer'
        ? `ใช้ ${def(keyOf(s, first.card)).name}`
        : first.t === 'retreat'
          ? 'ถอยเพื่อเปลี่ยนตัวตี'
          : first.t === 'energy'
            ? `ติด ${def(keyOf(s, first.card)).name} ให้ตัวหลัก`
            : 'เตรียมโจมตี';
  return `${what}${name && first.t !== 'attack' ? ` แล้วตีด้วย ${name}` : ''} (คะแนนคาดหวัง ${Math.round(fin.value)})`;
}

const isSupporter = (s: GameState, a: Action) => a.t === 'trainer' && isTrainerType(keyOf(s, a.card), 'Supporter');

/** Development actions (everything except gust/boost Supporters, switching and attacking), best first. */
export function rankDevelopment(s: GameState, me: PlayerId, plan: DeckPlan): Scored[] {
  const out: Scored[] = [];
  for (const a of legalActions(s)) {
    const r = devScore(s, me, a, plan);
    if (r.score > 0) out.push({ action: a, ...r });
  }
  return out.sort((x, y) => y.score - x.score);
}

function devScore(s: GameState, me: PlayerId, a: Action, plan: DeckPlan): { score: number; reason: string } {
  const ps = s.players[me];
  const handKeys = ps.hand.map((c) => keyOf(s, c));
  const supporterInHand = handKeys.some((k) => isTrainerType(k, 'Supporter'));
  let score = 0;
  let reason = '';
  switch (a.t) {
    case 'bench': {
      const k = keyOf(s, a.card);
      const target = plan.benchTarget?.(s, me) ?? 4;
      const room = ps.bench.length < target;
      score = room ? P.benchBase + cardValue(s, me, k, plan) / P.benchCardDiv : 4;
      reason = `ลง ${def(k).name} บน Bench`;
      if (k === 'meowth-ex') {
        const canCatch = !ps.supporterPlayed && !ps.namedUsed.includes('Last-Ditch') && !supporterInHand;
        score = canCatch ? P.meowth : 0;
        reason = 'ลง Meowth ex เพื่อค้น Supporter';
      } else if (k === 'chien-pao') {
        score = s.stadium && s.stadium.owner !== me ? 48 : room ? 18 : 0;
        reason = 'ลง Chien-Pao ทิ้ง Stadium ของอีกฝั่ง';
      } else if (hasRuleBox(k) && !plan.attackers.includes(k)) {
        score -= P.ruleBoxBenchPenalty;
      }
      break;
    }
    case 'evolve': {
      const k = keyOf(s, a.card);
      score = P.evolve;
      reason = `วิวัฒนาการเป็น ${def(k).name}`;
      // Support Pokémon (Thwackey, Drakloak…) belong on the Bench; evolve a Benched copy instead.
      if (ps.active?.uid === a.target && !plan.attackers.slice(0, 2).includes(k)) score -= P.evolveActivePenalty;
      break;
    }
    case 'retreat': {
      // Pivot: move a non-attacker out of the Active Spot when a real attacker waits on the Bench.
      const act = ps.active!;
      const to = ps.bench.find((b) => b.uid === a.to)!;
      const gain = attackerScore(s, me, to, plan) - attackerScore(s, me, act, plan);
      const cheap = retreatCost(s, me, act) <= 1;
      if (cheap && gain > P.pivotGain && !plan.attackers.slice(0, 2).includes(topKey(s, act))) {
        score = P.pivotRetreat;
        reason = `ถอย ${topDef(s, act).name} ให้ ${topDef(s, to).name} ขึ้นมาเป็นตัวตี`;
      }
      break;
    }
    case 'energy': {
      const k = keyOf(s, a.card);
      const t = provides(k);
      const tgt = energyTarget(s, me, t, plan);
      if (tgt?.uid === a.target) {
        score = P.energy;
        reason = `ติด ${def(k).name} ให้ ${topDef(s, tgt).name} (ตัวตีที่ต้องการพลังงาน)`;
      }
      if (k === 'enriching-energy' && score === 0 && slotsOf(ps).length > 0) {
        score = 30;
        reason = 'ติด Enriching Energy จั่ว 4 ใบ';
      }
      break;
    }
    case 'tool': {
      const k = keyOf(s, a.card);
      const sl = slotsOf(ps).find((x) => x.uid === a.target)!;
      const isAct = ps.active?.uid === sl.uid;
      const tk = topKey(s, sl);
      const attacker = plan.attackers.includes(tk);
      if (k === 'brave-bangle') score = !hasRuleBox(tk) && attacker ? (isAct ? 40 : 30) : 0;
      else if (k === 'heros-cape') score = isAct || attacker ? 35 + topDef(s, sl).hp / 20 : 10;
      else if (k === 'air-balloon') score = isAct && topDef(s, sl).retreat >= 2 ? 30 : 5;
      else if (k === 'lucky-helmet' || k === 'handheld-fan') score = isAct ? 25 : 3;
      else if (k === 'lillies-pearl') score = topDef(s, sl).name.startsWith("Lillie's ") ? 30 : 0;
      else if (k === 'binding-mochi') score = topDef(s, sl).types.includes('Darkness') && attacker ? 25 : 2;
      reason = `ติด ${def(k).name} ให้ ${topDef(s, sl).name}`;
      break;
    }
    case 'trainer': {
      const k = keyOf(s, a.card);
      ({ score, reason } = trainerScore(s, me, k, plan, handKeys));
      break;
    }
    case 'ability':
      ({ score, reason } = abilityScore(s, me, a.name, plan, handKeys));
      break;
    default:
      return { score: 0, reason: '' };
  }
  if (plan.adjust) score += plan.adjust(s, me, a, score);
  return { score, reason };
}

function bestInDeck(s: GameState, me: PlayerId, plan: DeckPlan, f: (k: string) => boolean): number {
  let best = 0;
  const seen = new Set<string>();
  for (const c of s.players[me].deck) {
    const k = keyOf(s, c);
    if (seen.has(k) || !f(k)) continue;
    seen.add(k);
    best = Math.max(best, cardValue(s, me, k, plan));
  }
  return best;
}

function trainerScore(s: GameState, me: PlayerId, k: string, plan: DeckPlan, handKeys: string[]): { score: number; reason: string } {
  const ps = s.players[me];
  const o = s.players[opp(me)];
  const name = def(k).name;
  const hand = handKeys.length;
  const r = (score: number, reason = `ใช้ ${name}`) => ({ score, reason });
  const lowestHand = (n: number, except: string) =>
    handKeys
      .filter((x, i) => !(x === except && handKeys.indexOf(except) === i))
      .map((x) => cardValue(s, me, x, plan))
      .sort((x, y) => x - y)
      .slice(0, n)
      .reduce((a, b) => a + b, 0);

  if (GUST_OR_BOOST.has(k) || FINISHER_ONLY.has(k)) return r(0);
  // Don't draw ourselves out of the game.
  const deck = ps.deck.length;
  if (DRAW_SUPPORTERS.has(k) && deck < 14) {
    const draws = k === 'lillies-determination' ? (ps.prizes.length === 6 ? 8 : 6) - hand : k === 'judge' ? 4 - hand : 5 - hand;
    if (deck - draws < 6) return r(0);
  }
  switch (k) {
    case 'poke-pad':
      return r(P.searchItem * (15 + bestInDeck(s, me, plan, (x) => isPokemon(x) && !hasRuleBox(x)) / 1.5), 'ค้น Pokémon ด้วย Poké Pad');
    case 'ultra-ball': {
      const best = bestInDeck(s, me, plan, isPokemon);
      return r(P.searchItem * (best / 1.3) - lowestHand(2, k) / 2.5, 'ใช้ Ultra Ball ค้น Pokémon');
    }
    case 'buddy-buddy-poffin':
      return r(P.searchItem * (ps.bench.length < (plan.benchTarget?.(s, me) ?? 4) ? 45 : 5), 'Poffin ลง Basic 2 ตัว');
    case 'secret-box':
      return r(hand >= 6 ? 35 : 5);
    case 'bug-catching-set':
      return r(30);
    case 'lillies-determination':
      return r(
        P.drawSupporter * (hand <= 2 ? 58 : hand <= 4 ? 38 : hand <= 6 ? 24 : 8),
        `ใช้ Lillie's Determination สับมือแล้วจั่ว ${ps.prizes.length === 6 ? 8 : 6}`,
      );
    case 'judge':
      return r(P.drawSupporter * (o.hand.length >= 6 && hand <= 4 ? 42 : hand <= 2 ? 30 : 6), `ใช้ Judge (มืออีกฝั่ง ${o.hand.length} ใบ)`);
    case 'surfer':
      return r(P.drawSupporter * (hand <= 3 && ps.bench.length > 0 ? 34 : 6));
    case 'crispin':
      return r(slotsOf(ps).some((sl) => plan.attackers.includes(topKey(s, sl))) ? 40 : 15, 'Crispin ค้นพลังงานติด');
    case 'cyrano':
      return r(14 + bestInDeck(s, me, plan, hasRuleBox) / 1.5, 'Cyrano ค้น Pokémon ex');
    case 'dawn':
    case 'hilda':
      return r(20 + bestInDeck(s, me, plan, (x) => isPokemon(x) && topStage(x) !== 'Basic') / 1.4);
    case 'ciphermaniacs-codebreaking':
      return r(hand <= 1 ? 22 : 12);
    case 'janines-secret-art':
    case 'rosas-encouragement':
      return r(40);
    case 'lanas-aid':
      return r(ps.discard.length >= 4 ? 28 : 5);
    case 'eri':
      return r(o.hand.length >= 4 ? 30 : 0);
    case 'night-stretcher': {
      let best = 0;
      for (const c of ps.discard) {
        const x = keyOf(s, c);
        if (isPokemon(x) || isBasicEnergy(x)) best = Math.max(best, cardValue(s, me, x, plan));
      }
      return r(best / 1.4, 'Night Stretcher เก็บของจากกองทิ้ง');
    }
    case 'rare-candy':
      return r(75, 'Rare Candy ข้ามไป Stage 2');
    case 'tool-scrapper': {
      const tools = slotsOf(o).filter((sl) => sl.tool !== null).length;
      return r(tools > 0 ? 30 : 0);
    }
    case 'sacred-ash':
      return r(ps.discard.filter((c) => isPokemon(keyOf(s, c))).length >= 3 ? 20 : 0);
    case 'hand-trimmer':
      return r(o.hand.length >= 7 && hand <= 6 ? 30 : 0);
    case 'unfair-stamp':
      return r(o.hand.length >= 4 ? 55 : 0, 'Unfair Stamp ตัดมืออีกฝั่งเหลือ 2');
    case 'special-red-card':
      return r(o.hand.length >= 4 ? 45 : 0, 'Special Red Card ตัดมืออีกฝั่งเหลือ 3');
    case 'wondrous-patch':
    case 'ns-pp-up':
    case 'glass-trumpet':
      return r(38, `${name} เร่งพลังงาน`);
    case 'crushing-hammer':
      return r(o.active && o.active.energy.length > 0 ? 24 : 2);
  }
  if (isTrainerType(k, 'Stadium')) {
    const theirs = s.stadium && s.stadium.owner !== me;
    return r(s.stadium ? (theirs ? 30 : 0) : 20, `วาง ${name}`);
  }
  return r(10);
}

function topStage(k: string) {
  const d = def(k);
  return d.category === 'pokemon' ? d.stage : 'Basic';
}

function abilityScore(s: GameState, me: PlayerId, name: string, plan: DeckPlan, handKeys: string[]): { score: number; reason: string } {
  const ps = s.players[me];
  const r = (score: number, reason = `ใช้ Ability ${name}`) => ({ score, reason });
  switch (name) {
    case 'Run Errand':
      return r(50, 'Run Errand จั่ว 2');
    case 'Flip the Script':
      return r(52, 'Flip the Script จั่ว 3');
    case 'Trade': {
      const low = Math.min(...handKeys.map((k) => cardValue(s, me, k, plan)));
      return r(low < 16 ? 40 : 18, 'Trade ทิ้ง 1 จั่ว 2');
    }
    case 'Run Away Draw':
      return r(handKeysCount(handKeys) <= 4 ? 36 : 12, 'Run Away Draw จั่ว 3');
    case 'Recon Directive':
      return r(42);
    case 'Attract Customers':
      return r(handKeys.some((k) => isTrainerType(k, 'Supporter')) ? 0 : 40);
    case 'Boom Boom Groove': {
      // Only search when something worth having is left, and not when the deck is running out.
      const want = bestInDeck(s, me, plan, () => true);
      return r(ps.deck.length < 10 ? 0 : want >= 40 ? 56 : want >= 28 ? 30 : 0, 'Boom Boom Groove ค้นการ์ดที่ขาด');
    }
    case 'Teal Dance':
      return r(46, 'Teal Dance ติด Grass Energy แล้วจั่ว');
    case 'Adrena-Brain': {
      const damaged = slotsOf(ps).some((sl) => sl.damage >= 30);
      const o = s.players[opp(me)];
      const near = slotsOf(o).some((sl) => hpLeft(s, sl) <= 30);
      return r(damaged ? (near ? 50 : 32) : 0, 'Adrena-Brain ย้ายตัวนับดาเมจไปฝั่งตรงข้าม');
    }
  }
  return r(0);
}

const handKeysCount = (h: string[]) => h.length;

export type { Finish };
