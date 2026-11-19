<script lang="ts">
  // The play screen: the match sheet (your deck, the opponent, practice or real mode), then you (player 0)
  // vs a bot (player 1). Practice mode has the hints, the threat panel, the opponent's Trainer count and
  // undo, which deals the hidden cards again (engine/view.ts redeal()); a real game has none of them.
  // Every change of state is animated (src/ui/anim): the state changes at once, the animations only
  // show it, the bot waits for them, and anything you do skips them.
  import { untrack } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { actor, apply, createGame, legalActions } from '../../engine/actions';
  import { maxHp } from '../../engine/rules';
  import { keyOf, slotsOf, topKey } from '../../engine/state';
  import type { Action, CardId, GameState, PlayerId, SlotId } from '../../engine/types';
  import { redeal, viewFor } from '../../engine/view';
  import { makeBot } from '../../bots/core';
  import { remoteBot, type RemoteBot } from '../../bots/remote';
  import { DEFAULT_POLICY, planFor } from '../../bots/plans';
  import type { Bot } from '../../bots/types';
  import { describeAction, handActions, targetOf } from '../../ui/play';
  import { headline, nearestDeck, pickOpponent, type MetaDeck } from '../../ui/decks';
  import { loadMyDecks, myDeckCards } from '../../ui/my-decks';
  import { handDrops, pickDrop, setupDrops, slotDrops, zonesAt } from '../../ui/drag';
  import { trackPress } from '../../ui/press';
  import { slotMenu } from '../../ui/menu';
  import { animEvents, type AnimEvent } from '../../ui/anim/events';
  import { Fx, snapshot, type AnimLevel, type Snapshot } from '../../ui/anim/fx';
  import { motion, setAnimLevel } from '../../ui/anim/motion';
  import { canAnalyse } from '../../analysis/can-analyse';
  import type { ThreatReport } from '../../analysis/threat';
  import { threatClient, type ThreatClient } from '../../analysis/remote';
  import { trainerCounts } from '../../analysis/counts';
  import { replay, type PlayMode, type Redeal, type SavedGame } from '../../review/record';
  import { getGame, saveGame } from '../../review/store';
  import Board, { type BoardDrag } from './Board.svelte';
  import CardBack from './CardBack.svelte';
  import CardFace from './CardFace.svelte';
  import CardInfo from './CardInfo.svelte';
  import ChoicePanel from './ChoicePanel.svelte';
  import HandView from './HandView.svelte';
  import LogPanel from './LogPanel.svelte';
  import Coach from './Coach.svelte';
  import PokemonMenu from './PokemonMenu.svelte';
  import ThreatPanel from './ThreatPanel.svelte';
  import FxLayer from './FxLayer.svelte';
  import GameOver from './GameOver.svelte';
  import HowTo from './HowTo.svelte';

  /** The meta decks: yours to play, and the bots'. */
  let { decks }: { decks: MetaDeck[] } = $props();

  const SETTINGS_KEY = 'tcg-sim:play-settings';
  const HOWTO_KEY = 'tcg-sim:seen-howto';

  function loadSettings(): Record<string, unknown> {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {};
    } catch {
      return {}; // settings are a convenience only
    }
  }
  const saved = loadSettings();
  // ?me=<deck>&opp=<deck> preselect the decks (the decks pages link here). ?seed=… fixes the deal.
  // ?watch=1&seed=…&opp=…&speed=… lets the rule-based bot play your deck (the Playwright end-to-end tests;
  // &save=1 saves it like a game of yours). ?resume=<saved game id>&at=<state index> picks a saved game up
  // at that point (the review page's "ลองเล่นใหม่จากตรงนี้"), with what you couldn't see dealt again.
  // ?pierce=1: Twin Shotels goes through Rabsca/Shaymin (the ruling the engine doesn't use by default).
  const params = new URLSearchParams(location.search);
  const watch = params.has('watch');
  const testing = params.has('test');
  const pierce = params.get('pierce') === '1';
  // The decks never change on this page.
  const meta = untrack(() => decks);
  const wantOpp = params.get('opp') ?? (saved.opponent as string) ?? 'random';
  let opponent = $state(meta.some((d) => d.slug === wantOpp) ? wantOpp : 'random');
  const SPEEDS = [150, 500, 1100];
  let speed = $state(params.has('speed') ? Number(params.get('speed')) : SPEEDS.includes(saved.speed as number) ? (saved.speed as number) : 500);
  const fixedSeed = params.has('seed') ? Number(params.get('seed')) : null;
  let seed = fixedSeed ?? Math.floor(Math.random() * 1e9);
  let mode = $state<PlayMode>(saved.mode === 'real' ? 'real' : 'practice');

  // Your deck: a meta deck, or one of your own lists (played with the plan of the meta deck nearest to it).
  interface DeckChoice {
    id: string;
    name: string;
    cards: string[] | null;
    plan: string;
  }
  const myDecks = loadMyDecks();
  const choices: DeckChoice[] = [
    ...meta.map((d) => ({ id: d.slug, name: d.name, cards: d.cards, plan: d.slug })),
    ...myDecks.map((d) => {
      const cards = myDeckCards(d);
      return { id: `my:${d.id}`, name: d.name, cards, plan: cards ? nearestDeck(cards, meta).slug : meta[0]!.slug };
    }),
  ];
  const usable = (id: unknown): id is string => choices.some((c) => c.id === id && c.cards);
  let mineId = $state<string>([params.get('me'), saved.mine].find(usable) ?? meta[0]!.slug);
  const mineChoice = $derived(choices.find((c) => c.id === mineId)!);
  const oppChoice = $derived(decks.find((d) => d.slug === opponent));
  /** This game's mode, your deck's plan (a meta deck slug) and its name. */
  let gameMode = $state<PlayMode>('practice');
  let minePlan = $state('');
  let mineName = $state('');
  /** Undos that dealt the hidden cards again (saved with the game, so it replays). */
  let redeals: Redeal[] = [];
  let howto = $state(false);
  /** Where each card of a deck's fan sits: the headline Pokémon in the middle, the next two either side. */
  const FAN = [0, -1, 1];
  /** "ภัยเทิร์นหน้า" (practice mode): the chance each of your Pokémon is Knocked Out next turn, on the table and in the side column. */
  let showThreat = $state(params.get('threat') !== '0' && ((saved.threat as boolean) ?? true));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let animLevel = $state<AnimLevel>((params.get('anim') as AnimLevel) ?? (saved.anim as AnimLevel) ?? (reducedMotion ? 'off' : 'full'));
  // Replays at full bot speed (and the end-to-end games) skip animations.
  const effectiveAnim = $derived<AnimLevel>(watch && speed === 0 ? 'off' : animLevel);
  let meBot: Bot | null = null;
  /** This game's lists (card keys), for saving it. */
  let gameDecks: [string[], string[]] = [[], []];
  /** The saved game's id once it is over (the review link), and the game picked up from, if any. */
  let savedId = $state<number | null>(null);
  let resumedFrom = $state<{ id: number; turn: number } | null>(null);

  let states = $state.raw<GameState[]>([]);
  let history = $state.raw<Action[]>([]);
  let botSlug = $state('');
  /** The opponent thinks in a Web Worker (src/bots/worker.ts) so its search never freezes the page. */
  let bot: RemoteBot | null = null;
  $effect(() => () => bot?.dispose());
  let viewing = $state<number | null>(null);
  let selected = $state<CardId | null>(null);
  /** The pop-up for one of your Pokémon (attacks, Abilities, retreat), opened by tapping it. */
  let menuFor = $state<SlotId | null>(null);
  let menuAnchor = $state<DOMRect | null>(null);
  let picks = $state<number[]>([]);
  let zoom = $state<string | null>(null);
  let discardOf = $state<PlayerId | null>(null);
  let error = $state('');

  // Drag and drop: what is being dragged, where each zone's drop leads, and the pointer position.
  interface Drop {
    label: string;
    run: () => void;
  }
  interface Drag {
    key: string;
    card?: CardId;
    drops: Map<string, Drop>;
    x: number;
    y: number;
    over: string | null;
    touch: boolean;
    /** Tilt (deg) from the sideways speed of the drag. */
    tilt: number;
  }
  let drag = $state.raw<Drag | null>(null);
  const dragging = $derived(drag !== null);
  const boardDrag = $derived<BoardDrag | null>(
    drag && { drops: new Set(drag.drops.keys()), over: drag.over, label: drag.over ? drag.drops.get(drag.over)!.label : '' },
  );

  // Narrow screens: the side column becomes a drawer and the hints move into the dock.
  let narrow = $state(false);
  let sideOpen = $state(false);
  $effect(() => {
    const mq = matchMedia('(max-width: 980px)');
    narrow = mq.matches;
    const update = () => (narrow = mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  });
  // A game fills the screen: nothing behind it scrolls.
  $effect(() => {
    const on = !!shown;
    document.documentElement.classList.toggle('playing', on);
    return () => document.documentElement.classList.remove('playing');
  });

  const cur = $derived(states[states.length - 1]);
  const shownRaw = $derived(viewing === null ? cur : (states.find((x) => x.steps > viewing!) ?? cur));
  const shown = $derived(shownRaw ? viewFor(shownRaw, 0) : undefined);
  const live = $derived(!!cur && viewing === null && cur.winner === null);
  const myTurn = $derived(live && !watch && actor(cur!) === 0);
  const req = $derived(myTurn && cur!.pending ? cur!.pending.request : null);
  const legal = $derived(myTurn && !cur!.pending ? legalActions(cur!) : []);
  const hand = $derived(myTurn && !cur!.pending ? handActions(cur!) : new Map());
  const menu = $derived(menuFor !== null && myTurn && !cur!.pending ? slotMenu(cur!, legal, menuFor) : null);
  /** Your Pokémon with something to do now (an attack or an Ability): they glow on the table. */
  const ready = $derived.by(() => {
    const r = new Set<SlotId>();
    for (const a of legal) {
      if (a.t === 'ability') r.add(a.slot);
      if (a.t === 'attack' && cur?.players[0].active) r.add(cur.players[0].active.uid);
    }
    return r;
  });
  const canStadium = $derived(legal.some((a) => a.t === 'stadium'));
  const abilities = $derived.by(() => {
    const m = new Map<SlotId, string[]>();
    for (const a of legal) if (a.t === 'ability') m.set(a.slot, [...(m.get(a.slot) ?? []), a.name]);
    return m;
  });
  const targets = $derived.by(() => {
    const t = new Set<SlotId>();
    if (req) for (const o of req.options) if (o.slot !== undefined) t.add(o.slot);
    if (selected !== null) {
      const ca = hand.get(selected);
      if (ca?.kind === 'target') for (const a of ca.actions) t.add(targetOf(a)!);
    }
    return t;
  });
  // Setup: Basics in your hand are the options; drag them to the Active Spot / Bench or tap them.
  const choiceKind = $derived(
    req ? (req.options[0]?.slot !== undefined ? 'slot' : req.options[0]?.card !== undefined ? 'card' : 'label') : null,
  );
  const setupReq = $derived(req && (req.purpose === 'setup-active' || req.purpose === 'setup-bench') ? req : null);
  const optionOf = (c: CardId) => setupReq?.options.find((o) => o.card === c);
  const handPlayable = $derived(
    setupReq ? new Set(setupReq.options.map((o) => o.card!)) : new Set<CardId>(hand.keys()),
  );
  const benchPicks = $derived(
    setupReq?.purpose === 'setup-bench' ? picks.flatMap((v) => setupReq.options.filter((o) => o.value === v)) : [],
  );
  const marked = $derived(
    setupReq?.purpose === 'setup-bench'
      ? new Set(setupReq.options.filter((o) => picks.includes(o.value)).map((o) => o.card!))
      : new Set<CardId>(),
  );
  const grabbable = $derived.by(() => {
    const g = new Set<SlotId>();
    if (!myTurn || req || !cur) return g;
    for (const sl of slotsOf(cur.players[0])) if (slotDrops(cur, legal, sl.uid).size) g.add(sl.uid);
    return g;
  });
  const pickCounts = $derived(
    req && req.options[0]?.slot !== undefined
      ? picks.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<SlotId, number>())
      : new Map<SlotId, number>(),
  );
  const botDeck = $derived(decks.find((d) => d.slug === botSlug));
  const practice = $derived(gameMode === 'practice' && !watch);
  /** The opponent's Trainers by their archetype's reference list: seen so far / in the list. */
  const oppCounts = $derived(practice && cur && botDeck ? trainerCounts(cur, 1, botDeck.cards) : []);

  // "ภัยเทิร์นหน้า" is sampled in a Web Worker (src/analysis/worker.ts) after every move on your turn.
  // Each turn uses the same deals, so the numbers change with your moves, not with the luck of the draw.
  const THREAT_SAMPLES = 64;
  let threatWorker: ThreatClient | null = null;
  let threat = $state.raw<{ report: ThreatReport; done: boolean; state: GameState } | null>(null);
  $effect(() => () => threatWorker?.dispose());
  const analysable = $derived(practice && showThreat && live && !!cur && canAnalyse(cur, 0));
  $effect(() => {
    const s = cur;
    if (!analysable || !s) {
      threatWorker?.stop();
      return;
    }
    threatWorker ??= threatClient((report, done, state) => (threat = { report, done, state }));
    untrack(() =>
      threatWorker!.ask({ state: s, me: 0, mine: minePlan, theirs: botSlug, policy: DEFAULT_POLICY, samples: THREAT_SAMPLES, seed: seed + s.turn }),
    );
  });
  /** The report on show: this position's, or (dimmed) the one for your previous move this turn. */
  const threatShown = $derived(analysable && threat && threat.state.turn === cur!.turn && threat.state.seed === cur!.seed ? threat : null);
  const threatStale = $derived(!!threatShown && threatShown.state !== cur);
  const danger = $derived(new Map<SlotId, number>(threatShown?.report.slots.map((x) => [x.uid, x.chance]) ?? []));
  const expectedPrizes = $derived(threatShown?.report.expected ?? 0);

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ opponent, speed, mine: mineId, mode, anim: animLevel, threat: showThreat }));
    } catch {
      /* ignore */
    }
  }

  function start() {
    // Watching (the end-to-end tests) doesn't change your settings.
    if (!watch) saveSettings();
    showOver = false;
    if (fixedSeed === null) seed = Math.floor(Math.random() * 1e9);
    const pick =
      opponent === 'random' ? pickOpponent(decks, (seed % 10007) / 10007, (Math.floor(seed / 10007) % 7919) / 7919) : oppChoice!;
    botSlug = pick.slug;
    gameMode = mode;
    minePlan = mineChoice.plan;
    mineName = mineChoice.name;
    redeals = [];
    threat = null;
    savedId = null;
    resumedFrom = null;
    bot?.dispose();
    // Watching a game plays it with the bots the simulator uses (the bot without look-ahead).
    bot = remoteBot({ slug: pick.slug, oppSlug: minePlan, seed: seed ^ 0x2545f491, policy: DEFAULT_POLICY, fast: watch });
    if (watch) meBot = makeBot(planFor(minePlan), { seed: seed ^ 0x1b873593 });
    error = '';
    viewing = null;
    history = [];
    const myCards = mineChoice.cards!;
    gameDecks = [myCards, pick.cards];
    states = [
      createGame({
        seed,
        decks: [
          { name: 'คุณ', cards: myCards },
          { name: 'บอท', cards: pick.cards },
        ],
        names: ['คุณ', 'บอท'],
        rules: { twinShotelsPiercesBenchShields: pierce },
      }),
    ];
    if (!watch && !testing && !seenHowTo()) howto = true;
  }

  /** Whether "วิธีเล่น" has been shown before (and from now on it has). */
  function seenHowTo(): boolean {
    try {
      if (localStorage.getItem(HOWTO_KEY)) return true;
      localStorage.setItem(HOWTO_KEY, '1');
    } catch {
      /* storage blocked: show it every time */
    }
    return false;
  }

  /** Pick a saved game up at state `at` (your turn): the same seed, lists and moves up to there. */
  async function resume(id: number, at: number) {
    const g = await getGame(id);
    if (!g) {
      error = 'ไม่พบเกมที่บันทึกไว้';
      return;
    }
    const all = replay(g);
    const upto = Math.max(0, Math.min(at, g.actions.length));
    seed = g.seed;
    botSlug = g.opponent;
    gameMode = g.mode ?? 'practice';
    minePlan = g.mine ?? 'player';
    mineName = g.mineName ?? 'list ของคุณ';
    gameDecks = g.decks;
    threat = null;
    savedId = null;
    showOver = false;
    error = '';
    viewing = null;
    resumedFrom = { id, turn: all[upto]!.turn };
    bot?.dispose();
    bot = remoteBot({ slug: g.opponent, oppSlug: minePlan, seed: g.seed ^ 0x2545f491 ^ upto, policy: g.policy });
    history = g.actions.slice(0, upto);
    // What you couldn't see is dealt again, so playing on doesn't show what was to come.
    redeals = (g.redeals ?? []).filter((r) => r.at <= upto);
    const from = all[upto]!;
    if (from.pending) states = all.slice(0, upto + 1);
    else {
      const r = Math.floor(Math.random() * 1e9);
      redeals.push({ at: upto, seed: r });
      states = [...all.slice(0, upto), redeal(from, 0, r)];
    }
  }

  // A finished game of yours is saved for the review page (watch-mode games only with &save=1).
  let saving = false;
  $effect(() => {
    const s = cur;
    if (!s || s.winner === null || savedId !== null || saving || (watch && !params.has('save'))) return;
    saving = true;
    const g: SavedGame = {
      savedAt: Date.now(),
      seed,
      opponent: botSlug,
      opponentName: botDeck?.name ?? botSlug,
      mine: minePlan,
      mineName,
      mode: gameMode,
      redeals: redeals.slice(),
      rules: { ...s.rules },
      policy: { ...DEFAULT_POLICY },
      decks: [gameDecks[0].slice(), gameDecks[1].slice()],
      actions: history.slice(),
      winner: s.winner,
      reason: s.winReason,
      turns: s.turn,
    };
    saveGame(g)
      .then((id) => (savedId = id))
      .catch(() => (error = 'บันทึกเกมไม่ได้'))
      .finally(() => (saving = false));
  });

  function step(a: Action) {
    fx?.finish();
    drag = null;
    try {
      const ns = apply(cur!, a);
      states = [...states, ns];
      history = [...history, a];
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
    selected = null;
    menuFor = null;
    picks = [];
  }

  // Animations: where everything was is read before the DOM updates, then the change is played.
  let fxLayer: HTMLDivElement | undefined = $state();
  let fx: Fx | null = null;
  let before: Snapshot | null = null;
  /** Index in `states` already shown. */
  let animated = -1;
  /** The bot waits until the animations of its last move are done. */
  let busyUntil = 0;
  let showOver = $state(false);
  let overTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (fxLayer && !fx) fx = new Fx(fxLayer, document.body);
    setAnimLevel(effectiveAnim);
    if (fx) {
      fx.level = effectiveAnim;
      if (effectiveAnim === 'off') fx.finish();
    }
  });
  $effect.pre(() => {
    void states;
    void viewing;
    untrack(() => {
      if (fx && effectiveAnim !== 'off') before = snapshot(document.body);
    });
  });
  $effect(() => {
    const list = states;
    const v = viewing;
    untrack(() => {
      const snap = before;
      before = null;
      const idx = list.length - 1;
      if (idx < 0) {
        animated = -1;
        return;
      }
      if (idx === animated) return;
      const next = list[idx]!;
      let total = 0;
      if (fx && snap && effectiveAnim !== 'off' && v === null && (idx === 0 || idx > animated)) {
        // A new game shows its opening coin toss; otherwise every action since the last one shown.
        const from = idx === 0 || animated < 0 ? null : animated;
        const events: AnimEvent[] =
          from === null
            ? animEvents(null, next)
            : list.slice(from, idx).flatMap((s, i) => animEvents(s, list[from + i + 1]!, history[from + i]));
        fx.finish();
        total = fx.play(events, { prev: from === null ? next : list[from]!, next, before: snap });
      } else fx?.finish();
      animated = idx;
      // A short beat after the animations before the bot moves again.
      busyUntil = total ? performance.now() + total + 150 : 0;
      clearTimeout(overTimer);
      if (next.winner === null) showOver = false;
      else if (!showOver) overTimer = setTimeout(() => (showOver = true), total + (total ? 400 : 0));
    });
  });

  // Bots move on their own after a short pause (both sides in watch mode).
  $effect(() => {
    const s = cur;
    if (!s || !live) return;
    const p = actor(s);
    const opponent = bot;
    const mine = meBot;
    if (p === 1 ? !opponent : !mine) return;
    const delay = Math.max(s.pending ? Math.min(speed, 250) : speed, busyUntil - performance.now());
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const a = p === 1 ? await opponent!.act(s) : mine!.act(s);
        // Ignore an answer for a position that is gone (undo, new game).
        if (!stale && cur === s) step(a);
      } catch (e) {
        if (!stale) error = `บอทผิดพลาด: ${(e as Error).message}`;
      }
    }, delay);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  });

  // Test hook: Playwright reads the engine state to compare with the screen.
  if (testing) (window as unknown as { __tcg: unknown }).__tcg = { state: () => cur, history: () => history };
  if (watch) start();
  else if (params.has('resume')) void resume(Number(params.get('resume')), Number(params.get('at') ?? 0));

  function onHand(c: CardId) {
    if (setupReq) {
      const o = optionOf(c);
      if (o) pick(o.value);
      return;
    }
    if (selected === c) {
      selected = null;
      return;
    }
    menuFor = null;
    const ca = hand.get(c);
    if (!ca) return;
    if (ca.kind === 'now') step(ca.action);
    else selected = c;
  }

  function onSlot(uid: SlotId) {
    if (req) {
      if (!req.options.some((o) => o.value === uid)) return;
      pick(uid);
      return;
    }
    if (selected !== null) {
      const ca = hand.get(selected);
      const a = ca?.kind === 'target' ? ca.actions.find((x: Action) => targetOf(x) === uid) : undefined;
      if (a) step(a);
      return;
    }
    // Your Pokémon: its pop-up. The other side's: the card, large.
    if (myTurn && cur!.players[0].active && slotMenu(cur!, legal, uid)) {
      menuFor = uid;
      menuAnchor = document.querySelector(`[data-slot="${uid}"] .card`)?.getBoundingClientRect() ?? null;
      return;
    }
    const sl = shown && [0, 1].flatMap((p) => slotsOf(shown!.players[p as PlayerId])).find((x) => x.uid === uid);
    if (sl) zoom = topKey(shown!, sl);
  }

  function pick(v: number) {
    if (!req) return;
    if (req.max === 1 && req.min === 1) {
      step({ t: 'choose', picks: [v] });
      return;
    }
    if (req.repeat) {
      if (picks.length < req.max) picks = [...picks, v];
    } else if (picks.includes(v)) {
      picks = picks.filter((x) => x !== v);
    } else if (picks.length < req.max) {
      picks = [...picks, v];
    }
  }

  function press(e: PointerEvent, key: string, drops: Map<string, Drop>, card?: CardId) {
    trackPress(e, {
      canDrag: drops.size > 0,
      onLongPress: () => (zoom = key),
      onDragStart: (x, y) => {
        fx?.finish();
        selected = null;
        menuFor = null;
        drag = { key, card, drops, x, y, over: null, touch: e.pointerType !== 'mouse', tilt: 0 };
      },
      onDragMove: (x, y) => {
        if (!drag) return;
        const tilt = drag.tilt * 0.6 + Math.max(-18, Math.min(18, (x - drag.x) * 1.6)) * 0.4;
        drag = { ...drag, x, y, tilt, over: pickDrop(zonesAt(x, y), drag.drops) };
      },
      onDrop: (x, y) => {
        const d = drag;
        drag = null;
        const zone = d && pickDrop(zonesAt(x, y), d.drops);
        if (zone) d!.drops.get(zone)!.run();
      },
      onCancel: () => (drag = null),
    });
  }

  function onHandPress(c: CardId, e: PointerEvent) {
    if (!cur) return;
    const drops = new Map<string, Drop>();
    if (setupReq) {
      for (const [zone, v] of setupDrops(setupReq, c)) {
        const active = setupReq.purpose === 'setup-active';
        drops.set(zone, {
          label: active ? 'วางเป็นตัวหลัก' : 'ลง Bench',
          run: () => (active ? step({ t: 'choose', picks: [v] }) : !picks.includes(v) && pick(v)),
        });
      }
    } else if (myTurn && !req) {
      for (const [zone, a] of handDrops(hand.get(c))) drops.set(zone, { label: describeAction(cur, a), run: () => step(a) });
    }
    press(e, keyOf(cur, c), drops, c);
  }

  function onSlotPress(uid: SlotId, e: PointerEvent) {
    if (!shown || !cur) return;
    const sl = [0, 1].flatMap((p) => slotsOf(shown!.players[p as PlayerId])).find((x) => x.uid === uid);
    if (!sl) return;
    const drops = new Map<string, Drop>();
    if (grabbable.has(uid)) {
      for (const [zone, a] of slotDrops(cur, legal, uid)) drops.set(zone, { label: describeAction(cur, a), run: () => step(a) });
    }
    press(e, topKey(shown, sl), drops);
  }

  /** "ทำตามนี้": the suggested move, then its planned choices (e.g. which Pokémon Boss's Orders brings up). */
  function follow(a: Action, planned: number[][] = []) {
    step(a);
    const queue = planned.map((p) => p.slice());
    while (cur && cur.pending && cur.winner === null && actor(cur) === 0 && queue.length) {
      const r = cur.pending.request;
      const f = queue.shift()!;
      if (!f.every((v) => r.options.some((o) => o.value === v)) || f.length < r.min || f.length > r.max) break;
      step({ t: 'choose', picks: f });
    }
  }

  function undo() {
    // Back to your previous decision point (before your last action and the bot's replies), with the cards
    // you can't see dealt again: going back never shows what you would draw.
    for (let i = states.length - 2; i >= 0; i--) {
      const s = states[i]!;
      if (s.winner === null && !s.pending && actor(s) === 0 && s.phase === 'main') {
        const r = Math.floor(Math.random() * 1e9);
        states = [...states.slice(0, i), redeal(s, 0, r)];
        history = history.slice(0, i);
        redeals = [...redeals.filter((x) => x.at <= i), { at: i, seed: r }];
        bot?.dispose();
        bot = remoteBot({ slug: botSlug, oppSlug: minePlan, seed: seed ^ 0x2545f491 ^ r, policy: DEFAULT_POLICY });
        viewing = null;
        return;
      }
    }
  }
</script>

{#if !cur}
  <section class="setup" aria-labelledby="setup-title">
    <header class="sheet-head">
      <div>
        <p class="eyebrow">ตั้งค่าเกม</p>
        <h1 id="setup-title">เลือกเด็ค แล้วลงสนาม</h1>
      </div>
      <button type="button" class="link" onclick={() => (howto = true)}>วิธีเล่น</button>
    </header>

    <div class="match">
      <div class="corner you">
        <span class="who">คุณ</span>
        <div class="fan" aria-hidden="true">
          {#each mineChoice.cards ? headline(mineChoice.cards, mineChoice.name) : [] as k, j (k)}
            <span class="fc" style:--o={FAN[j]} style:z-index={3 - j}><CardFace cardKey={k} /></span>
          {/each}
        </div>
        <label>
          เด็คของคุณ
          <select bind:value={mineId}>
            <optgroup label="เด็คใน meta">
              {#each decks as d}<option value={d.slug}>{d.name}</option>{/each}
            </optgroup>
            {#if myDecks.length}
              <optgroup label="เด็คของฉัน">
                {#each choices.filter((c) => c.id.startsWith('my:')) as c}
                  <option value={c.id} disabled={!c.cards}>{c.name}{c.cards ? '' : ' (list ใช้ไม่ได้)'}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        </label>
        <a class="more" href="/decks/#mine">+ ใช้ list ของคุณเอง</a>
      </div>

      <div class="vs" aria-hidden="true"><span>VS</span></div>

      <div class="corner them">
        <span class="who">บอท</span>
        <div class="fan" aria-hidden="true">
          {#if oppChoice}
            {#each headline(oppChoice.cards, oppChoice.name) as k, j (k)}
              <span class="fc" style:--o={FAN[j]} style:z-index={3 - j}><CardFace cardKey={k} /></span>
            {/each}
          {:else}
            {#each [0, 1, 2] as j (j)}<span class="fc" style:--o={FAN[j]} style:z-index={3 - j}><CardBack /></span>{/each}
            <span class="q">?</span>
          {/if}
        </div>
        <label>
          คู่แข่ง
          <select bind:value={opponent}>
            <option value="random">สุ่มตามสัดส่วนใน meta</option>
            {#each decks as d}
              <option value={d.slug}>{d.rank}. {d.name} · {d.metaShare?.toFixed(1)}%</option>
            {/each}
          </select>
        </label>
        <a class="more" href={oppChoice ? `/decks/${oppChoice.slug}/` : '/decks/'}>ดู list ของบอท</a>
      </div>
    </div>

    <fieldset class="modes">
      <legend>โหมด</legend>
      <label class="mode" class:on={mode === 'practice'}>
        <input type="radio" name="mode" value="practice" bind:group={mode} />
        <strong>โหมดฝึก</strong>
        <span>โอกาสโดน KO เทิร์นหน้า, ปุ่มแนะนำ, นับการ์ดคู่แข่ง และย้อนได้</span>
      </label>
      <label class="mode" class:on={mode === 'real'}>
        <input type="radio" name="mode" value="real" bind:group={mode} />
        <strong>โหมดจริง</strong>
        <span>ไม่มีตัวช่วย ย้อนไม่ได้ เหมือนแข่งจริง</span>
      </label>
    </fieldset>

    <div class="prefs">
      <label>
        ความเร็วบอท
        <select bind:value={speed}>
          <option value={150}>เร็ว</option>
          <option value={500}>ปกติ</option>
          <option value={1100}>ช้า</option>
        </select>
      </label>
      <label>
        Animation
        <select bind:value={animLevel}>
          <option value="full">เต็ม</option>
          <option value="fast">เร็ว</option>
          <option value="off">ปิด</option>
        </select>
      </label>
      <button type="button" class="primary start" onclick={start}>เริ่มเกม →</button>
    </div>
  </section>
{:else if shown}
  {#snippet choice()}
    <ChoicePanel
      s={cur!}
      req={req!}
      {picks}
      onpick={pick}
      onsubmit={() => step({ t: 'choose', picks })}
      onclear={() => (picks = [])}
      onzoom={(k) => (zoom = k)}
    />
  {/snippet}
  <div class="game" class:dragging>
    <div class="main">
      <div class="status">
        {#if cur.winner !== null}
          <strong class="result">{cur.winner === 0 ? 'คุณชนะ' : cur.winner === 1 ? 'บอทชนะ' : 'เสมอ'} · {cur.winReason}</strong>
          {#if savedId !== null}<a href={`/review/?id=${savedId}`}>วิจารณ์เกมนี้ →</a>{/if}
          <a href={`/decks/${botSlug}/`}>ดู list ที่บอทใช้ ({botDeck?.name}) →</a>
        {:else if viewing !== null}
          <strong>กำลังดูสนามย้อนหลัง</strong>
          <button type="button" class="link" onclick={() => (viewing = null)}>กลับไปเกมปัจจุบัน</button>
        {:else if watch}
          <strong>ดูบอทเล่น · เทิร์น {cur.turn}</strong>
        {:else}
          <span class="chip" class:real={gameMode === 'real'}>{gameMode === 'real' ? 'โหมดจริง' : 'โหมดฝึก'}</span>
          <strong>เทิร์น {cur.turn} · {actor(cur) === 0 ? 'ตาคุณ' : 'บอทกำลังคิด…'}</strong>
          <span class="opp">{mineName} vs {botDeck?.name}</span>
          {#if resumedFrom}<span class="opp">เล่นต่อจากเกมที่บันทึกไว้ (เทิร์น {resumedFrom.turn})</span>{/if}
        {/if}
        <span class="top-tools">
          {#if narrow}
            <button type="button" class="small" aria-expanded={sideOpen} onclick={() => (sideOpen = !sideOpen)}>ข้อมูล · log</button>
            <button type="button" class="small" onclick={() => (states = [])}>เกมใหม่</button>
          {/if}
        </span>
      </div>

      <div class="table">
      <Board
        s={shown}
        {targets}
        picks={pickCounts}
        {abilities}
        drag={boardDrag}
        {grabbable}
        ghostBench={benchPicks.map((o) => keyOf(cur, o.card!))}
        onghost={(i) => (picks = picks.filter((v) => v !== benchPicks[i]!.value))}
        onslot={onSlot}
        {ready}
        {danger}
        dangerStale={threatStale}
        onzoom={(k) => (zoom = k)}
        ondiscard={(p) => (discardOf = p)}
        onpress={onSlotPress}
        canUseStadium={canStadium}
        onstadium={() => step({ t: 'stadium' })}
      />

      <!-- Picking cards or an option covers the table; picking Pokémon on the table happens in the dock. -->
      {#if req && !setupReq && choiceKind !== 'slot'}
        <div class="choice-layer">{@render choice()}</div>
      {/if}
      {#if error}<p class="error">{error}</p>{/if}
      </div>

      <div class="dock">
        {#if practice && narrow && myTurn && !req && cur.phase === 'main'}
          <Coach s={cur} onapply={follow} mine={minePlan} botPlan={planFor(botSlug).name} compact />
        {/if}
        {#if req && !setupReq && choiceKind === 'slot'}
          {@render choice()}
        {:else if myTurn && !req}
          <div class="bar">
            <button type="button" onclick={() => step({ t: 'end' })}>จบเทิร์น</button>
            {#if practice}
              <button type="button" class="ghost" onclick={undo} disabled={history.length === 0} title="การ์ดที่มองไม่เห็นจะถูกสับใหม่">ย้อน</button>
            {/if}
            {#if narrow && threatShown}
              <button type="button" class="small threat-chip" class:hot={expectedPrizes >= 1} onclick={() => (sideOpen = true)}>
                ภัยเทิร์นหน้า ~{expectedPrizes.toFixed(1)} Prize
              </button>
            {/if}
            <span class="hint">
              {selected !== null ? 'แตะ Pokémon ที่ไฮไลต์ หรือลากการ์ดไปวาง' : 'แตะ Pokémon ของคุณเพื่อโจมตี · ถอย · ใช้ Ability'}
            </span>
          </div>
        {:else if setupReq}
          <div class="bar setup-bar" data-step={setupReq.purpose === 'setup-active' ? 'active' : 'bench'}>
            {#if setupReq.purpose === 'setup-active'}
              <span class="hint">ลาก Basic จากมือไปวางที่ช่องตัวหลัก หรือแตะการ์ด</span>
            {:else}
              <button type="button" class="primary" onclick={() => step({ t: 'choose', picks })}>
                ยืนยัน{picks.length ? ` (ลง Bench ${picks.length} ตัว)` : ' (ไม่ลง Bench)'}
              </button>
              {#if picks.length}<button type="button" class="ghost" onclick={() => (picks = [])}>ล้าง</button>{/if}
              <span class="hint">
                {picks.length < setupReq.max ? `ลาก Basic ลง Bench ได้อีก ${setupReq.max - picks.length} ตัว` : 'ลง Bench ครบแล้ว'} · แตะตัวบน
                Bench เพื่อเอาคืน
              </span>
            {/if}
          </div>
        {/if}

        <HandView
          s={shown}
          playable={handPlayable}
          {selected}
          {marked}
          lifted={drag?.card ?? null}
          onpick={onHand}
          onpress={onHandPress}
          onzoom={(k) => (zoom = k)}
        />
      </div>
    </div>

    {#if narrow && sideOpen}
      <div class="side-backdrop" role="presentation" onclick={() => (sideOpen = false)}></div>
    {/if}
    <aside class="side" class:open={sideOpen}>
      {#if narrow}
        <button type="button" class="small close-side" onclick={() => (sideOpen = false)}>ปิด ✕</button>
      {/if}
      {#if practice && !narrow && myTurn && !req && cur.phase === 'main'}
        <Coach s={cur} onapply={follow} mine={minePlan} botPlan={planFor(botSlug).name} />
      {/if}
      {#if analysable}
        <ThreatPanel report={threatShown?.report ?? null} done={threatShown?.done ?? false} stale={threatStale} />
      {/if}
      <section class="panel">
        <h3>ข้อมูลคู่แข่ง</h3>
        <p>มือบอท {cur.players[1].hand.length} ใบ · เด็ค {cur.players[1].deck.length} ใบ · Prize {cur.players[1].prizes.length} ใบ</p>
        {#if oppCounts.length}
          <details class="counts" open>
            <summary>Trainer ของเขา (เห็นแล้ว/ใน list)</summary>
            <p class="muted">เห็นแล้ว = ในกองทิ้งหรือบนสนาม ที่เหลืออยู่ในมือ เด็ค หรือ Prize ของเขา</p>
            <ul class="used">
              {#each oppCounts as c (c.key)}
                <li class:gone={c.seen >= c.total}>
                  <span>{c.name}</span><span class="mono">{c.seen}/{c.total}{c.seen < c.total ? ` · เหลือ ${c.total - c.seen}` : ''}</span>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
      </section>
      <LogPanel log={cur.log} {viewing} onview={(st) => (viewing = st)} />
      <div class="tools">
        <button type="button" onclick={() => (states = [])}>เกมใหม่</button>
        <label class="anim-pick">
          Animation
          <select bind:value={animLevel} onchange={saveSettings}>
            <option value="full">เต็ม</option>
            <option value="fast">เร็ว</option>
            <option value="off">ปิด</option>
          </select>
        </label>
        <button type="button" onclick={() => (howto = true)}>วิธีเล่น</button>
        {#if practice}
          <label class="check threat-pick">
            <input type="checkbox" bind:checked={showThreat} onchange={saveSettings} /> ภัยเทิร์นหน้า
          </label>
        {/if}
      </div>
    </aside>
  </div>
{/if}

<FxLayer bind:layer={fxLayer} />

{#if howto}<HowTo onclose={() => (howto = false)} />{/if}

{#if showOver && cur && cur.winner !== null && viewing === null}
  <GameOver
    winner={cur.winner}
    reason={cur.winReason}
    botDeck={botDeck?.name ?? ''}
    botHref={`/decks/${botSlug}/`}
    reviewHref={savedId !== null ? `/review/?id=${savedId}` : null}
    onnew={() => ((states = []), (showOver = false))}
    onclose={() => (showOver = false)}
  />
{/if}

{#if menu}
  {@const sl = slotsOf(cur!.players[0]).find((x) => x.uid === menu.uid)}
  <PokemonMenu
    {menu}
    anchor={menuAnchor}
    hp={{ left: sl ? Math.max(0, maxHp(cur!, sl) - sl.damage) : 0, max: sl ? maxHp(cur!, sl) : 0 }}
    onact={(a) => ((menuFor = null), step(a))}
    onzoom={(k) => (zoom = k)}
    onclose={() => (menuFor = null)}
  />
{/if}

{#if zoom}<CardInfo cardKey={zoom} onclose={() => (zoom = null)} />{/if}

{#if drag}
  <div
    class="drag-ghost"
    class:touch={drag.touch}
    class:ok={drag.over !== null}
    style:transform={`translate(${drag.x}px, ${drag.y}px)`}
    style:--tilt={`${drag.tilt.toFixed(1)}deg`}
  >
    <div class="ghost-face"><CardFace cardKey={drag.key} /></div>
    <span class="ghost-label">{drag.over ? drag.drops.get(drag.over)!.label : 'ลากไปที่ช่องที่ไฮไลต์'}</span>
  </div>
{/if}

{#if discardOf !== null && shown}
  <div
    class="backdrop"
    role="presentation"
    transition:fade={{ duration: motion(160) }}
    onclick={() => (discardOf = null)}
    onkeydown={(e) => e.key === 'Escape' && (discardOf = null)}
  >
    <div class="discard" role="dialog" aria-label="กองทิ้ง">
      <h3>กองทิ้ง{discardOf === 0 ? 'ของคุณ' : 'ของบอท'} ({shown.players[discardOf].discard.length})</h3>
      <div class="grid">
        {#each shown.players[discardOf].discard as c, i (c)}
          <button
            type="button"
            onclick={(e) => ((e.stopPropagation(), (zoom = keyOf(shown, c))))}
            in:scale={{ start: 0.8, delay: motion(Math.min(i, 24) * 18), duration: motion(200) }}
          >
            <CardFace cardKey={keyOf(shown, c)} />
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  /* The match sheet: your corner, VS, the bot's corner, then the mode and start. */
  .setup {
    max-width: 920px;
    margin: 8px auto 0;
    border: 2px solid var(--ink);
    background: var(--card-bg);
    box-shadow: 8px 8px 0 var(--paper-deep);
  }
  .sheet-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 20px 14px;
    border-bottom: 2px solid var(--ink);
  }
  .sheet-head h1 {
    margin: 0;
    font-size: clamp(1.6rem, 4vw, 2.4rem);
  }
  .sheet-head .eyebrow {
    margin: 0 0 2px;
  }
  .match {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 4.5rem minmax(0, 1fr);
    border-bottom: 1px solid var(--rule);
  }
  .corner {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 20px 18px;
  }
  .corner.you {
    background: color-mix(in srgb, var(--stamp) 6%, transparent);
  }
  .corner.them {
    background: color-mix(in srgb, var(--teal) 7%, transparent);
  }
  .who {
    align-self: flex-start;
    padding: 1px 10px;
    font-family: var(--font-display);
    font-weight: 700;
    color: var(--paper);
    background: var(--stamp);
    transform: rotate(-3deg);
  }
  .them .who {
    background: var(--teal);
    transform: rotate(3deg);
  }
  .fan {
    position: relative;
    height: clamp(8.5rem, 22vw, 10.5rem);
    margin: 4px 0 2px;
  }
  .fc {
    position: absolute;
    bottom: 0;
    left: calc(50% - 3.3rem + var(--o) * 3.6rem);
    width: 6.6rem;
    border-radius: 6px;
    box-shadow: var(--shadow);
    transform: rotate(calc(var(--o) * 9deg)) translateY(calc(var(--o) * var(--o) * 6px));
    transform-origin: bottom center;
    transition: transform 0.25s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .corner:hover .fc {
    transform: rotate(calc(var(--o) * 13deg)) translateY(calc(var(--o) * var(--o) * 8px - 4px));
  }
  .fc :global(.back) {
    display: block;
  }
  .q {
    position: absolute;
    z-index: 4;
    left: 50%;
    top: 52%;
    translate: -50% -50%;
    display: grid;
    place-items: center;
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    background: var(--stamp);
    color: #fff;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 2.1rem;
    line-height: 1;
    box-shadow: 0 0 0 4px var(--card-bg), 3px 5px 0 4px var(--ink);
    transform: rotate(-8deg);
  }
  .more {
    align-self: flex-start;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .more:hover {
    color: var(--stamp);
  }
  .vs {
    display: grid;
    place-items: center;
    background: repeating-linear-gradient(-45deg, transparent 0 7px, color-mix(in srgb, var(--ink) 6%, transparent) 7px 8px);
    border-left: 1px solid var(--rule);
    border-right: 1px solid var(--rule);
  }
  .vs span {
    display: grid;
    place-items: center;
    width: 3.2rem;
    height: 3.2rem;
    border-radius: 50%;
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.15rem;
    transform: rotate(-8deg);
    box-shadow: 3px 3px 0 var(--stamp);
  }
  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 0;
    padding: 16px 20px;
    border: 0;
    border-bottom: 1px solid var(--rule);
  }
  .modes legend {
    float: left;
    grid-column: 1 / -1;
    margin-bottom: 2px;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  label.mode {
    position: relative;
    gap: 2px;
    padding: 12px 14px 12px 40px;
    border: 1.5px solid var(--rule);
    background: var(--paper);
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  }
  .mode input {
    position: absolute;
    left: 14px;
    top: 15px;
    margin: 0;
    accent-color: var(--stamp);
  }
  .mode strong {
    font-family: var(--font-display);
    font-size: 1.05rem;
  }
  .mode span {
    font-weight: 400;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .mode:hover {
    border-color: var(--ink-soft);
  }
  .mode.on {
    border: 2px solid var(--ink);
    padding: 11px 13px 11px 39px;
    box-shadow: 4px 4px 0 var(--stamp);
    transform: translate(-1px, -1px);
  }
  .mode:focus-within {
    outline: 2px solid var(--stamp);
    outline-offset: 2px;
  }
  .prefs {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px 16px;
    padding: 14px 20px 18px;
  }
  .prefs label {
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .start {
    margin-left: auto;
    padding: 10px 26px;
    font-size: 1.1rem;
    box-shadow: 4px 4px 0 var(--stamp);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .start:hover {
    transform: translate(-2px, -2px);
    box-shadow: 6px 6px 0 var(--stamp);
  }
  .chip {
    padding: 0 8px;
    border: 1.5px solid var(--teal);
    color: var(--teal);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
  }
  .chip.real {
    border-color: var(--stamp);
    color: var(--stamp);
  }
  @media (max-width: 720px) {
    .match {
      grid-template-columns: 1fr;
    }
    .vs {
      height: 2.6rem;
      border: 0;
      border-top: 1px solid var(--rule);
      border-bottom: 1px solid var(--rule);
    }
    .vs span {
      width: 2.6rem;
      height: 2.6rem;
      font-size: 0.95rem;
    }
    .modes {
      grid-template-columns: 1fr;
    }
    .start {
      width: 100%;
    }
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 500;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-weight: 400;
    font-size: 0.9rem;
  }
  select {
    padding: 6px 8px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }
  button {
    padding: 6px 14px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .primary {
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-display);
    font-weight: 600;
  }
  .ghost {
    background: transparent;
  }
  /* A game fills the screen like the real game: status line, table, then your hand. Nothing scrolls
     except the side column. */
  :global(html.playing),
  :global(html.playing body) {
    overflow: hidden;
  }
  .game {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 10px;
    height: 100dvh;
    padding: 8px 12px calc(6px + env(safe-area-inset-bottom));
    background-color: var(--paper);
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
  }
  .status {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    align-items: center;
    font-size: 0.92rem;
  }
  .top-tools {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  button.small {
    padding: 3px 10px;
    font-size: 0.82rem;
  }
  /* The table: card sizes come from this box (container query units in Board.svelte). */
  .table {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    container-type: size;
  }
  .choice-layer {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: grid;
    place-items: center;
    padding: 12px;
    border-radius: 14px;
    background: #0b0a0799;
  }
  .choice-layer :global(.choice) {
    width: min(780px, 100%);
    max-height: 100%;
    overflow-y: auto;
  }
  .result {
    color: var(--stamp);
    font-family: var(--font-display);
    font-size: 1.2rem;
  }
  .opp {
    color: var(--ink-soft);
    font-size: 0.9rem;
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--teal);
    text-decoration: underline;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  /* The hand and buttons stay on screen while the board scrolls, so a drag can always reach a target. */
  .dock {
    position: relative;
    z-index: 20;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .game.dragging {
    cursor: grabbing;
    user-select: none;
  }
  .drag-ghost {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 60;
    pointer-events: none;
    will-change: transform;
  }
  .ghost-face {
    width: 92px;
    transform: translate(-50%, -50%) rotate(calc(-5deg + var(--tilt, 0deg))) scale(1.04);
    filter: drop-shadow(0 12px 18px #0008);
    transition: transform 0.1s ease;
  }
  .drag-ghost.ok .ghost-face {
    transform: translate(-50%, -50%) rotate(calc(var(--tilt, 0deg) * 0.5)) scale(1.1);
  }
  /* On touch the card floats above the finger so it stays visible. */
  .drag-ghost.touch .ghost-face {
    width: 76px;
    transform: translate(-50%, -125%) rotate(calc(-5deg + var(--tilt, 0deg)));
  }
  .drag-ghost.touch.ok .ghost-face {
    transform: translate(-50%, -125%) scale(1.08);
  }
  .ghost-label {
    position: absolute;
    left: 0;
    top: 0;
    transform: translate(-50%, 56px);
    padding: 3px 10px;
    border-radius: 999px;
    background: #1a150ce6;
    color: #fff;
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .drag-ghost.touch .ghost-label {
    transform: translate(-50%, 18px);
  }
  .drag-ghost.ok .ghost-label {
    background: #f2c94c;
    color: #1a150c;
    font-weight: 600;
  }
  .error {
    position: absolute;
    left: 50%;
    bottom: 8px;
    z-index: 7;
    transform: translateX(-50%);
    margin: 0;
    padding: 4px 12px;
    background: var(--card-bg);
    color: var(--stamp);
    font-size: 0.85rem;
    box-shadow: 0 4px 12px -4px #000a;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .close-side {
    align-self: flex-end;
  }
  .side-backdrop {
    position: fixed;
    inset: 0;
    z-index: 35;
    background: #0b0a0780;
  }
  .panel {
    padding: 10px 12px;
    border: 1.5px solid var(--ink);
    background: var(--card-bg);
    font-size: 0.85rem;
  }
  .panel h3 {
    margin: 0 0 6px;
    font-size: 0.95rem;
  }
  .panel p {
    margin: 0 0 4px;
  }
  .used {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .used li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px dashed var(--rule);
  }
  .counts summary {
    cursor: pointer;
    margin-bottom: 2px;
  }
  .used li.gone {
    color: var(--ink-soft);
    text-decoration: line-through;
  }
  .threat-pick {
    font-size: 0.85rem;
  }
  .threat-chip {
    border-color: var(--stamp);
    color: var(--stamp);
  }
  .threat-chip.hot {
    background: var(--stamp);
    color: #fff;
  }
  .muted {
    color: var(--ink-soft);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .anim-pick {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    font-weight: 400;
  }
  .anim-pick select {
    padding: 4px 6px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 16px;
    background: color-mix(in srgb, #1a150c 55%, transparent);
  }
  .discard {
    width: min(860px, 100%);
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 16px;
    border: 2px solid var(--ink);
    background: var(--card-bg);
  }
  .discard h3 {
    margin: 0 0 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 8px;
  }
  .grid button {
    padding: 0;
    border: 0;
    background: none;
  }
  .mono {
    font-family: var(--font-mono);
  }
  @media (max-width: 980px) {
    .game {
      grid-template-columns: minmax(0, 1fr);
    }
    /* The side column slides in from the right. */
    .side {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 36;
      width: min(360px, 88vw);
      padding: 12px;
      background: var(--paper);
      box-shadow: -12px 0 30px -12px #000c;
      transform: translateX(105%);
      transition: transform 0.25s ease;
    }
    .side.open {
      transform: none;
    }
  }
  @media (max-width: 700px) {
    .game {
      padding: 6px 8px calc(4px + env(safe-area-inset-bottom));
    }
    .main {
      gap: 4px;
    }
    .status {
      font-size: 0.8rem;
      gap: 2px 10px;
    }
    .opp {
      display: none;
    }
    .bar {
      gap: 4px;
    }
    .bar button {
      padding: 4px 9px;
      font-size: 0.82rem;
    }
  }
</style>
