// The ruler of BOT-PRO.md P1: how often the bot chooses what the pros chose in the games transcribed from broadcasts
// (data/pro/*.json, the transcription page's export; any games file works, e.g. your own games against the bot),
// where it differs, how its value head judges real games, and how the pros pilot each deck.
//   npx tsx scripts/pro/agreement.ts [files or dirs…] [--deals 8] [--hard] [--weights <net or expert set>] [--out data/pro/report.md] [--json data/pro/report.json]
// Every decision of a pro is put to the bot on `deals` re-deals of the cards the broadcast never showed
// (engine/script.ts redealUnknown; a pending choice is judged on the transcript's own deal); agreement = the share of
// deals where the bot's first choice is the pro's. Decisions with no alternative are left out. `net` is each deck's
// expert, the network alone (what the simulator's bot plays); --hard adds the rule-based hard bot.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { MODEL } from '../../src/bots';
import { makeHardBot } from '../../src/bots/hard';
import { encode } from '../../src/bots/learn/encode';
import { loadModel, run, type Model, type ModelJson } from '../../src/bots/learn/model';
import { actionKey, bestOption } from '../../src/bots/learn/netbot';
import { planFor } from '../../src/bots/plans';
import { makeRand } from '../../src/bots/random';
import { netWin } from '../../src/analysis/winrate';
import { actor, legalActions } from '../../src/engine/actions';
import { def } from '../../src/engine/db';
import { redealUnknown } from '../../src/engine/script';
import { keyOf } from '../../src/engine/state';
import type { Action, GameState, PlayerId } from '../../src/engine/types';
import { readGamesFile, replay, turnsOf, type SavedGame } from '../../src/review/record';
import { wilson } from '../../src/sim/stats';
import { describeAction } from '../../src/ui/play';
import { BOT_WEIGHTS, expertModel, expertWeights } from '../lib/experts';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DEALS = Number(opt('deals') ?? 8);
const HARD = args.includes('--hard');
const WEIGHTS = opt('weights');
const OUT = opt('out') ?? 'data/pro/report.md';
const JSON_OUT = opt('json');
const MAX_ACTIONS_PER_TURN = 40;
const inputs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--') && !['--hard'].includes(args[i - 1]!)));
const paths = (inputs.length ? inputs : ['data/pro']).flatMap((p) =>
  existsSync(p) && statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => join(p, f)) : [p],
);

const games: { file: string; g: SavedGame }[] = paths.flatMap((file) => readGamesFile(readFileSync(file, 'utf8')).map((g) => ({ file, g })));
if (!games.length) throw new Error(`no games in ${paths.join(', ') || 'data/pro'}`);

// ---------- what a decision is ----------

/** A move or answer as what it does, so the same choice on another deal of the hidden cards compares equal. */
function decisionKey(s: GameState, a: Action): string {
  if (a.t !== 'choose') return actionKey(s, a);
  const req = s.pending!.request;
  const part = (v: number) => {
    const o = req.options.find((x) => x.value === v);
    return o?.card !== undefined ? keyOf(s, o.card) : o?.slot !== undefined ? `slot:${o.slot}` : `opt:${v}`;
  };
  const parts = a.picks.map(part);
  return (req.ordered ? parts : parts.sort()).join('+');
}

/** The kind of decision, for the tables: a Trainer by its type, a choice by its purpose. */
function classOf(s: GameState, a: Action): string {
  if (a.t === 'choose') return `choice:${s.pending!.request.purpose}`;
  if (a.t === 'trainer') {
    const d = def(keyOf(s, a.card));
    return `trainer:${d.category === 'trainer' ? d.trainerType : d.category}`;
  }
  return a.t;
}

/** A decision with an alternative: a free position with more than "end turn", a choice with more options than it must take. */
function contested(s: GameState): boolean {
  if (s.winner !== null) return false;
  if (s.pending) {
    const r = s.pending.request;
    return r.options.length > 1 && (r.repeat || r.ordered || r.min < r.options.length);
  }
  return legalActions(s).length > 1;
}

function text(s: GameState, a: Action): string {
  if (a.t !== 'choose') return describeAction(s, a);
  const req = s.pending!.request;
  return `${req.prompt}: ${a.picks.map((v) => req.options.find((o) => o.value === v)?.label ?? String(v)).join(', ') || '—'}`;
}

// ---------- the bots ----------

const models = new Map<string, Model | null>();
function modelFor(slug: string): Model {
  if (!models.has(slug)) {
    const m = WEIGHTS ? loadModel(JSON.parse(readFileSync(expertWeights(WEIGHTS, slug, BOT_WEIGHTS), 'utf8')) as ModelJson) : (expertModel(slug) ?? MODEL);
    if (!m) throw new Error('no network is bundled (src/bots/learn/weights.json)');
    models.set(slug, m);
  }
  return models.get(slug)!;
}

/** The network alone, as the simulator's bot plays: its first choice at `s` for the player to act, `n` actions into the turn. */
function netAct(model: Model, decks: readonly [string, string], s: GameState, n: number, seed: number): Action {
  const rand = makeRand(seed);
  if (s.pending) {
    const picks: number[] = [];
    for (;;) {
      const enc = encode(s, { decks }, picks);
      const ref = enc.refs[enc.refs.length === 1 ? 0 : bestOption(run(model, enc).logits, 0, rand)]!;
      if (ref.t !== 'pick') break;
      picks.push(ref.value);
    }
    return { t: 'choose', picks };
  }
  if (n >= MAX_ACTIONS_PER_TURN) return { t: 'end' };
  const enc = encode(s, { decks, actionsThisTurn: n });
  const ref = enc.refs[enc.refs.length === 1 ? 0 : bestOption(run(model, enc).logits, 0, rand)]!;
  return ref.t === 'action' ? ref.action : { t: 'end' };
}

// ---------- the measurement ----------

interface Decision {
  game: number;
  seat: PlayerId;
  deck: string;
  turn: number;
  cls: string;
  pro: string;
  proText: string;
  /** Per bot: share of deals agreeing, the bot's most frequent choice in words. */
  bots: Record<string, { agree: number; text: string }>;
}

interface Piloting {
  games: number;
  ownTurns: number;
  attackTurns: number;
  prizes: number;
  firstAttack: number[];
  /** Cards played from the hand (Trainers, Energy, Pokémon), count per game. */
  played: Record<string, number>;
  attacks: Record<string, number>;
  benchAtEnd: number;
  wins: number;
}

const decisions: Decision[] = [];
const value: { deck: string; stage: string; p: number; result: number }[] = [];
const piloting = new Map<string, Piloting>();
const gameRows: { title: string; decisions: Decision[]; result: string }[] = [];
const botKinds = ['net', ...(HARD ? ['hard'] : [])];

games.forEach(({ file, g }, gi) => {
  const states = replay(g);
  const slugs: [string, string] = [g.mine ?? 'player', g.opponent];
  const plans = [planFor(slugs[0], g.policy), planFor(slugs[1])] as const;
  const names = g.pro?.players ?? [g.mineName ?? 'you', g.opponentName];
  const title = g.pro ? `${g.pro.event}${g.pro.round ? ` · ${g.pro.round}` : ''}: ${names[0]} (${slugs[0]}) vs ${names[1]} (${slugs[1]})` : `${basename(file)} #${gi + 1}: ${names[0]} (${slugs[0]}) vs ${names[1]} (${slugs[1]})`;
  const last = states[states.length - 1]!;
  const result = last.winner === null ? 'unfinished' : last.winner === 'draw' ? 'draw' : `${names[last.winner]} won`;
  const rows: Decision[] = [];
  for (const seat of [0, 1] as const) {
    const my = plans[seat];
    const their = plans[seat === 0 ? 1 : 0];
    const decks = [my.name, their.name] as const;
    const model = modelFor(slugs[seat]);
    const theirs = modelFor(slugs[seat === 0 ? 1 : 0]);
    const hard = HARD ? makeHardBot(my, their, { seed: 7 }) : null;
    const outcome = last.winner === null ? null : last.winner === 'draw' ? 0.5 : last.winner === seat ? 1 : 0;
    let actionsThisTurn = 0;
    let turn = -1;
    for (let i = 0; i < g.actions.length; i++) {
      const s = states[i]!;
      if (s.winner !== null || actor(s) !== seat) continue;
      if (!s.pending) {
        if (s.turn !== turn) {
          turn = s.turn;
          actionsThisTurn = 0;
          if (outcome !== null) {
            const deals = Array.from({ length: DEALS }, (_, d) => netWin(redealUnknown(s, 1000 * gi + 17 * i + d), seat, model, decks, { deals: 1, seed: d + 1 }, theirs).p);
            const stage = s.turn <= 2 ? 'turns 1-2' : s.turn <= 6 ? 'turns 3-6' : 'turn 7+';
            value.push({ deck: slugs[seat], stage, p: deals.reduce((a, b) => a + b, 0) / deals.length, result: outcome });
          }
        }
      }
      const a = g.actions[i]!;
      const n = actionsThisTurn;
      if (!s.pending) actionsThisTurn++;
      if (!contested(s)) continue;
      const pro = decisionKey(s, a);
      const bots: Decision['bots'] = {};
      for (const kind of botKinds) {
        const counts = new Map<string, { n: number; text: string }>();
        const deals = s.pending ? 1 : DEALS;
        for (let d = 0; d < deals; d++) {
          const r = s.pending ? s : redealUnknown(s, 1000 * gi + 17 * i + d);
          const b = kind === 'net' ? netAct(model, decks, r, n, d + 1) : hard!.act(r);
          const k = decisionKey(r, b);
          const c = counts.get(k) ?? { n: 0, text: text(r, b) };
          c.n++;
          counts.set(k, c);
        }
        const top = [...counts.entries()].sort((x, y) => y[1].n - x[1].n)[0]!;
        bots[kind] = { agree: (counts.get(pro)?.n ?? 0) / deals, text: top[1].text };
      }
      rows.push({ game: gi, seat, deck: slugs[seat], turn: s.turn, cls: classOf(s, a), pro, proText: text(s, a), bots });
    }
    // How this seat piloted its deck.
    const p = piloting.get(slugs[seat]) ?? { games: 0, ownTurns: 0, attackTurns: 0, prizes: 0, firstAttack: [], played: {}, attacks: {}, benchAtEnd: 0, wins: 0 };
    p.games++;
    if (last.winner === seat) p.wins++;
    const spans = turnsOf(states, seat);
    let own = 0;
    for (const span of spans) {
      own++;
      p.ownTurns++;
      const acts = g.actions.slice(span.start, span.end);
      const attack = acts.find((x) => x.t === 'attack');
      if (attack) {
        p.attackTurns++;
        p.attacks[(attack as { name: string }).name] = (p.attacks[(attack as { name: string }).name] ?? 0) + 1;
        if (!p.firstAttack[p.games - 1]) p.firstAttack[p.games - 1] = own;
      }
      p.prizes += states[span.start]!.players[seat].prizes.length - states[span.end]!.players[seat].prizes.length;
      p.benchAtEnd += states[span.end]!.players[seat].bench.length;
      for (let j = span.start; j < span.end; j++) {
        const x = g.actions[j]!;
        if ('card' in x) {
          const name = def(keyOf(states[j]!, x.card)).name;
          p.played[name] = (p.played[name] ?? 0) + 1;
        }
      }
    }
    piloting.set(slugs[seat], p);
  }
  decisions.push(...rows);
  gameRows.push({ title, decisions: rows, result });
});

// ---------- the report ----------

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const ci = (sum: number, n: number) => {
  if (!n) return '—';
  const [lo, hi] = wilson(Math.round(sum), n);
  return `${pct(sum / n)} (${pct(lo)}–${pct(hi)}, n=${n})`;
};
const agreeOf = (rows: Decision[], kind: string) => ci(rows.reduce((a, r) => a + r.bots[kind]!.agree, 0), rows.length);
const by = <K extends string>(rows: Decision[], key: (r: Decision) => K) => {
  const m = new Map<K, Decision[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
};

const out: string[] = [];
out.push(`# โปรเล่นอย่างไร เทียบกับบอท (BOT-PRO.md P1)`, '');
out.push(`${games.length} games from ${paths.map((p) => basename(p)).join(', ')} · ${decisions.length} contested decisions · ${DEALS} re-deals of the unseen cards per free position · bots: ${botKinds.join(', ')}`, '');
out.push('## Agreement: the bot\'s first choice is the pro\'s', '');
out.push(`| | ${botKinds.join(' | ')} |`, `| --- | ${botKinds.map(() => '---').join(' | ')} |`);
const free = decisions.filter((d) => !d.cls.startsWith('choice:'));
const choices = decisions.filter((d) => d.cls.startsWith('choice:'));
out.push(`| all decisions | ${botKinds.map((k) => agreeOf(decisions, k)).join(' | ')} |`);
out.push(`| moves (free positions) | ${botKinds.map((k) => agreeOf(free, k)).join(' | ')} |`);
out.push(`| answers to choices | ${botKinds.map((k) => agreeOf(choices, k)).join(' | ')} |`, '');
out.push('### By deck', '', `| deck | decisions | ${botKinds.join(' | ')} |`, `| --- | --- | ${botKinds.map(() => '---').join(' | ')} |`);
for (const [deck, rows] of by(decisions, (r) => r.deck)) out.push(`| ${deck} | ${rows.length} | ${botKinds.map((k) => agreeOf(rows, k)).join(' | ')} |`);
out.push('', '### By kind of decision', '', `| kind | decisions | ${botKinds.join(' | ')} |`, `| --- | --- | ${botKinds.map(() => '---').join(' | ')} |`);
for (const [cls, rows] of by(decisions, (r) => r.cls)) out.push(`| ${cls} | ${rows.length} | ${botKinds.map((k) => agreeOf(rows, k)).join(' | ')} |`);
out.push('', '### By turn', '', `| turns | decisions | ${botKinds.join(' | ')} |`, `| --- | --- | ${botKinds.map(() => '---').join(' | ')} |`);
for (const [stage, rows] of by(decisions, (r) => (r.turn <= 2 ? 'turns 1-2' : r.turn <= 6 ? 'turns 3-6' : 'turn 7+'))) out.push(`| ${stage} | ${rows.length} | ${botKinds.map((k) => agreeOf(rows, k)).join(' | ')} |`);

out.push('', '## The value head on real games', '', 'The expert\'s chance of winning for the pro\'s side at the start of each of their turns (the unseen cards re-dealt), against the result. Brier: 0 = perfect, 0.25 = a coin; self-play review gate 0.144.', '');
out.push('| | positions | Brier | mean win% given | share won |', '| --- | --- | --- | --- | --- |');
const brier = (rows: typeof value) => (rows.length ? rows.reduce((a, r) => a + (r.p - r.result) ** 2, 0) / rows.length : NaN);
const vrow = (label: string, rows: typeof value) => `| ${label} | ${rows.length} | ${rows.length ? brier(rows).toFixed(3) : '—'} | ${rows.length ? pct(rows.reduce((a, r) => a + r.p, 0) / rows.length) : '—'} | ${rows.length ? pct(rows.reduce((a, r) => a + r.result, 0) / rows.length) : '—'} |`;
out.push(vrow('all', value));
for (const stage of ['turns 1-2', 'turns 3-6', 'turn 7+']) out.push(vrow(stage, value.filter((v) => v.stage === stage)));
for (const deck of [...new Set(value.map((v) => v.deck))]) out.push(vrow(deck, value.filter((v) => v.deck === deck)));

out.push('', '## How the pros pilot each deck', '', '| deck | games (won) | own turns | turns with an attack | Prizes per own turn | first attack on own turn | Bench at the end of a turn | attacks | cards played per game (top 8) |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [deck, p] of piloting) {
  const first = p.firstAttack.filter((x) => x);
  const top = (m: Record<string, number>, n: number) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${k} ${(v / p.games).toFixed(1)}`)
      .join(', ');
  out.push(
    `| ${deck} | ${p.games} (${p.wins}) | ${(p.ownTurns / p.games).toFixed(1)} | ${pct(p.attackTurns / Math.max(1, p.ownTurns))} | ${(p.prizes / Math.max(1, p.ownTurns)).toFixed(2)} | ${first.length ? (first.reduce((a, b) => a + b, 0) / first.length).toFixed(1) : '—'} | ${(p.benchAtEnd / Math.max(1, p.ownTurns)).toFixed(1)} | ${top(p.attacks, 4)} | ${top(p.played, 8)} |`,
  );
}

out.push('', '## Where the bot differs, game by game', '', 'Every contested decision where the bot\'s first choice was the pro\'s on under half the deals.', '');
for (const g of gameRows) {
  const diff = g.decisions.filter((d) => botKinds.some((k) => d.bots[k]!.agree < 0.5));
  out.push(`### ${g.title} — ${g.result}`, '', `${g.decisions.length} contested decisions, ${diff.length} differ.`, '');
  if (!diff.length) continue;
  out.push(`| turn | who | kind | the pro | ${botKinds.map((k) => `${k} (agree)`).join(' | ')} |`, `| --- | --- | --- | --- | ${botKinds.map(() => '---').join(' | ')} |`);
  for (const d of diff) out.push(`| ${d.turn} | ${d.seat === 0 ? 'bottom' : 'top'} ${d.deck} | ${d.cls} | ${d.proText} | ${botKinds.map((k) => `${d.bots[k]!.text} (${pct(d.bots[k]!.agree)})`).join(' | ')} |`);
  out.push('');
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join('\n'));
if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify({ games: gameRows.map((g) => g.title), deals: DEALS, decisions, value, piloting: Object.fromEntries(piloting) }, null, 1));
}
console.log(out.slice(0, 12).join('\n'));
console.log(`\nwritten ${OUT}${JSON_OUT ? ` and ${JSON_OUT}` : ''}`);
