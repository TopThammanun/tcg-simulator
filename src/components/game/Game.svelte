<script lang="ts">
  // The play screen: setup options, then you (player 0) vs a bot (player 1).
  // Every change of state is animated (src/ui/anim): the state changes at once, the animations only
  // show it, the bot waits for them, and anything you do skips them.
  import { untrack } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { actor, apply, createGame, legalActions } from '../../engine/actions';
  import { maxHp } from '../../engine/rules';
  import { keyOf, slotsOf, topKey } from '../../engine/state';
  import type { Action, CardId, GameState, PlayerId, SlotId } from '../../engine/types';
  import { viewFor } from '../../engine/view';
  import { makeBot } from '../../bots/core';
  import { remoteBot, type RemoteBot } from '../../bots/remote';
  import { DEFAULT_POLICY, planFor } from '../../bots/plans';
  import type { Bot, Level } from '../../bots/types';
  import { describeAction, handActions, pickByShare, targetOf } from '../../ui/play';
  import { handDrops, pickDrop, setupDrops, slotDrops, zonesAt } from '../../ui/drag';
  import { trackPress } from '../../ui/press';
  import { slotMenu } from '../../ui/menu';
  import { animEvents, type AnimEvent } from '../../ui/anim/events';
  import { Fx, snapshot, type AnimLevel, type Snapshot } from '../../ui/anim/fx';
  import { motion, setAnimLevel } from '../../ui/anim/motion';
  import { applyEdit } from '../../sim/experiments';
  import { myCards as savedCards } from '../../ui/my-list';
  import { canAnalyse, type ThreatReport } from '../../analysis/threat';
  import { threatClient, type ThreatClient } from '../../analysis/remote';
  import { trainerCounts } from '../../analysis/counts';
  import DeckEditor from '../DeckEditor.svelte';
  import Board, { type BoardDrag } from './Board.svelte';
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

  interface DeckOption {
    slug: string;
    name: string;
    side: 'player' | 'bot';
    rank?: number;
    metaShare?: number;
    optional?: boolean;
    cards: string[];
  }

  let { decks, playerList }: { decks: DeckOption[]; playerList: string } = $props();

  const botDecks = $derived(decks.filter((d) => d.side === 'bot'));
  const playerDeck = $derived(decks.find((d) => d.side === 'player')!);
  const SETTINGS_KEY = 'tcg-sim:play-settings';

  function loadSettings(): Record<string, unknown> {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {};
    } catch {
      return {}; // settings are a convenience only
    }
  }
  const saved = loadSettings();
  // ?watch=1&seed=…&opp=…&level=…&speed=…&policy=<json> plays your deck with the player-policy bot
  // (replays from the simulator, and the Playwright end-to-end test).
  const params = new URLSearchParams(location.search);
  const watch = params.has('watch');
  let opponent = $state(params.get('opp') ?? (saved.opponent as string) ?? 'random');
  let level = $state<Level>((params.get('level') as Level) ?? (saved.level as Level) ?? 'normal');
  let speed = $state(params.has('speed') ? Number(params.get('speed')) : ((saved.speed as number) ?? 500));
  let seed = $state(params.has('seed') ? Number(params.get('seed')) : Math.floor(Math.random() * 1e9));
  let pierce = $state(params.get('pierce') === '1' || ((saved.pierce as boolean) ?? false));
  let includeFestival = $state((saved.includeFestival as boolean) ?? true);
  /** "ภัยเทิร์นหน้า": the chance each of your Pokémon is Knocked Out next turn, on the table and in the side column. */
  let showThreat = $state(params.get('threat') !== '0' && ((saved.threat as boolean) ?? true));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let animLevel = $state<AnimLevel>((params.get('anim') as AnimLevel) ?? (saved.anim as AnimLevel) ?? (reducedMotion ? 'off' : 'full'));
  // Replays at full bot speed (and the end-to-end games) skip animations.
  const effectiveAnim = $derived<AnimLevel>(watch && speed === 0 ? 'off' : animLevel);
  let meBot: Bot | null = null;
  let myPolicy = DEFAULT_POLICY;

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
  let copied = $state(false);

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
  /** The opponent's Trainers by their archetype's reference list: seen so far / in the list. */
  const oppCounts = $derived(cur && botDeck ? trainerCounts(cur, 1, botDeck.cards) : []);

  // "ภัยเทิร์นหน้า" is sampled in a Web Worker (src/analysis/worker.ts) after every move on your turn.
  // Each turn uses the same deals, so the numbers change with your moves, not with the luck of the draw.
  const THREAT_SAMPLES = 64;
  let threatWorker: ThreatClient | null = null;
  let threat = $state.raw<{ report: ThreatReport; done: boolean; state: GameState } | null>(null);
  $effect(() => () => threatWorker?.dispose());
  const analysable = $derived(showThreat && !watch && live && !!cur && canAnalyse(cur, 0));
  $effect(() => {
    const s = cur;
    if (!analysable || !s) {
      threatWorker?.stop();
      return;
    }
    threatWorker ??= threatClient((report, done, state) => (threat = { report, done, state }));
    untrack(() =>
      threatWorker!.ask({ state: s, me: 0, mine: 'player', theirs: botSlug, policy: myPolicy, samples: THREAT_SAMPLES, seed: seed + s.turn }),
    );
  });
  /** The report on show: this position's, or (dimmed) the one for your previous move this turn. */
  const threatShown = $derived(analysable && threat && threat.state.turn === cur!.turn && threat.state.seed === cur!.seed ? threat : null);
  const threatStale = $derived(!!threatShown && threatShown.state !== cur);
  const danger = $derived(new Map<SlotId, number>(threatShown?.report.slots.map((x) => [x.uid, x.chance]) ?? []));
  const expectedPrizes = $derived(threatShown?.report.expected ?? 0);

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ opponent, level, speed, pierce, includeFestival, anim: animLevel, threat: showThreat }));
    } catch {
      /* ignore */
    }
  }

  function start() {
    saveSettings();
    showOver = false;
    const pool = botDecks.filter((d) => includeFestival || !d.optional);
    const pick = opponent === 'random' ? pickByShare(pool, (seed % 10007) / 10007) : pool.find((d) => d.slug === opponent)!;
    botSlug = pick.slug;
    let policy = DEFAULT_POLICY;
    try {
      policy = { ...DEFAULT_POLICY, ...JSON.parse(params.get('policy') ?? localStorage.getItem('tcg-sim:policy') ?? '{}') };
    } catch {
      /* default policy */
    }
    myPolicy = policy;
    threat = null;
    bot?.dispose();
    bot = remoteBot({ slug: pick.slug, oppSlug: 'player', level, seed: seed ^ 0x2545f491, policy });
    if (watch) meBot = makeBot(planFor('player', policy), { level: 'normal', seed: seed ^ 0x1b873593 });
    error = '';
    viewing = null;
    history = [];
    let myCards = savedCards(playerDeck.cards).cards;
    try {
      if (watch && params.has('edit')) myCards = applyEdit(myCards, JSON.parse(params.get('edit')!));
    } catch (e) {
      error = `แก้ list ไม่ได้: ${(e as Error).message}`;
    }
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
  }

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
  if (params.has('test')) (window as unknown as { __tcg: unknown }).__tcg = { state: () => cur, history: () => history };
  if (watch) start();

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
    // Back to your previous decision point (before your last action and the bot's replies).
    for (let i = states.length - 2; i >= 0; i--) {
      const s = states[i]!;
      if (s.winner === null && !s.pending && actor(s) === 0 && s.phase === 'main') {
        states = states.slice(0, i + 1);
        history = history.slice(0, i);
        bot?.dispose();
        bot = remoteBot({ slug: botSlug, oppSlug: 'player', level, seed: seed ^ 0x2545f491 ^ i, policy: DEFAULT_POLICY });
        viewing = null;
        return;
      }
    }
  }

  async function copyReplay() {
    const replay = { seed, opponent: botSlug, level, rules: { twinShotelsPiercesBenchShields: pierce }, actions: history };
    try {
      await navigator.clipboard.writeText(JSON.stringify(replay));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      error = 'คัดลอกไม่ได้ในหน้านี้';
    }
  }
</script>

{#if !cur}
  <section class="setup">
    <h2>ตั้งค่าเกม</h2>
    <label>
      คู่แข่ง
      <select bind:value={opponent}>
        <option value="random">สุ่มตาม meta share</option>
        {#each botDecks as d}
          <option value={d.slug}>{d.rank}. {d.name} ({d.metaShare?.toFixed(2)}%){d.optional ? ' · เสริม' : ''}</option>
        {/each}
      </select>
    </label>
    <label class="check"><input type="checkbox" bind:checked={includeFestival} /> รวม Festival Lead ตอนสุ่ม</label>
    <label>
      ระดับบอท
      <select bind:value={level}>
        <option value="easy">ง่าย</option>
        <option value="normal">ปกติ</option>
        <option value="hard">ยาก</option>
      </select>
    </label>
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
    <label>
      Seed
      <span class="seed">
        <input type="number" bind:value={seed} />
        <button type="button" onclick={() => (seed = Math.floor(Math.random() * 1e9))}>สุ่ม</button>
      </span>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={showThreat} /> แสดงภัยเทิร์นหน้า: โอกาสที่ Pokémon ของคุณแต่ละตัวโดน KO ถ้าจบเทิร์นตอนนั้น
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={pierce} /> Twin Shotels ทะลุ Rabsca/Shaymin (ruling ยังไม่ยืนยัน, ค่าเริ่มต้น: ไม่ทะลุ)
    </label>
    <DeckEditor defaultList={playerList} />
    <button type="button" class="primary" onclick={start}>เริ่มเกม</button>
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
          <a href={`/decks/${botSlug}/`}>ดู list ที่บอทใช้ ({botDeck?.name}) →</a>
        {:else if viewing !== null}
          <strong>กำลังดูสนามย้อนหลัง</strong>
          <button type="button" class="link" onclick={() => (viewing = null)}>กลับไปเกมปัจจุบัน</button>
        {:else if watch}
          <strong>ดูบอทเล่น · เทิร์น {cur.turn} · seed {seed}</strong>
        {:else}
          <strong>เทิร์น {cur.turn} · {actor(cur) === 0 ? 'ตาคุณ' : 'บอทกำลังคิด…'}</strong>
          <span class="opp">คู่แข่ง: {botDeck?.name.replace(/ \(.*\)$/, '')}</span>
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
        {#if narrow && myTurn && !req && cur.phase === 'main'}
          <Coach s={cur} onapply={follow} compact />
        {/if}
        {#if req && !setupReq && choiceKind === 'slot'}
          {@render choice()}
        {:else if myTurn && !req}
          <div class="bar">
            <button type="button" onclick={() => step({ t: 'end' })}>จบเทิร์น</button>
            <button type="button" class="ghost" onclick={undo} disabled={history.length === 0}>ย้อน</button>
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
      {#if !narrow && myTurn && !req && cur.phase === 'main'}
        <Coach s={cur} onapply={follow} />
      {/if}
      {#if analysable}
        <ThreatPanel report={threatShown?.report ?? null} done={threatShown?.done ?? false} stale={threatStale} />
      {/if}
      <section class="panel">
        <h3>ข้อมูลคู่แข่ง</h3>
        <p>มือบอท {cur.players[1].hand.length} ใบ · เด็ค {cur.players[1].deck.length} ใบ · Prize {cur.players[1].prizes.length} ใบ</p>
        {#if oppCounts.length}
          <details class="counts" open>
            <summary>Trainer ของเขา: เห็นแล้ว / ใน list อ้างอิง</summary>
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
        <button type="button" onclick={copyReplay}>{copied ? 'คัดลอกแล้ว' : 'คัดลอก replay (JSON)'}</button>
        <label class="check threat-pick">
          <input type="checkbox" bind:checked={showThreat} onchange={saveSettings} /> ภัยเทิร์นหน้า
        </label>
      </div>
    </aside>
  </div>
{/if}

<FxLayer bind:layer={fxLayer} />

{#if showOver && cur && cur.winner !== null && viewing === null}
  <GameOver
    winner={cur.winner}
    reason={cur.winReason}
    botDeck={botDeck?.name ?? ''}
    botHref={`/decks/${botSlug}/`}
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
  .setup {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 520px;
    padding: 20px;
    border: 2px solid var(--ink);
    background: var(--card-bg);
  }
  .setup h2 {
    margin: 0;
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
  select,
  input[type='number'] {
    padding: 6px 8px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }
  .seed {
    display: flex;
    gap: 6px;
  }
  .seed input {
    flex: 1;
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
