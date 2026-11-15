<script lang="ts">
  // The play screen: setup options, then you (player 0) vs a bot (player 1).
  // Every change of state is animated (src/ui/anim): the state changes at once, the animations only
  // show it, the bot waits for them, and anything you do skips them.
  import { untrack } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { actor, apply, createGame, legalActions } from '../../engine/actions';
  import { def } from '../../engine/db';
  import { keyOf, slotsOf, topKey } from '../../engine/state';
  import type { Action, CardId, GameState, PlayerId, SlotId } from '../../engine/types';
  import { viewFor } from '../../engine/view';
  import { makeBot } from '../../bots/core';
  import { createBot } from '../../bots';
  import { DEFAULT_POLICY, planFor } from '../../bots/plans';
  import type { Bot, Level } from '../../bots/types';
  import { actionLabel, describeAction, handActions, pickByShare, targetOf } from '../../ui/play';
  import { handDrops, pickDrop, setupDrops, slotDrops, zonesAt } from '../../ui/drag';
  import { trackPress } from '../../ui/press';
  import { animEvents, type AnimEvent } from '../../ui/anim/events';
  import { Fx, snapshot, type AnimLevel, type Snapshot } from '../../ui/anim/fx';
  import { motion, setAnimLevel } from '../../ui/anim/motion';
  import { applyEdit } from '../../sim/experiments';
  import { myCards as savedCards } from '../../ui/my-list';
  import DeckEditor from '../DeckEditor.svelte';
  import Board, { type BoardDrag } from './Board.svelte';
  import CardFace from './CardFace.svelte';
  import CardInfo from './CardInfo.svelte';
  import ChoicePanel from './ChoicePanel.svelte';
  import HandView from './HandView.svelte';
  import LogPanel from './LogPanel.svelte';
  import Coach from './Coach.svelte';
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
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let animLevel = $state<AnimLevel>((params.get('anim') as AnimLevel) ?? (saved.anim as AnimLevel) ?? (reducedMotion ? 'off' : 'full'));
  // Replays at full bot speed (and the end-to-end games) skip animations.
  const effectiveAnim = $derived<AnimLevel>(watch && speed === 0 ? 'off' : animLevel);
  let meBot: Bot | null = null;

  let states = $state.raw<GameState[]>([]);
  let history = $state.raw<Action[]>([]);
  let botSlug = $state('');
  let bot: Bot | null = null;
  let viewing = $state<number | null>(null);
  let selected = $state<CardId | null>(null);
  let retreatMode = $state(false);
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

  // Phone layout: the hints move from the side column into the dock at the bottom of the screen.
  let narrow = $state(false);
  $effect(() => {
    const mq = matchMedia('(max-width: 700px)');
    narrow = mq.matches;
    const update = () => (narrow = mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  });
  let mainEl: HTMLDivElement | undefined = $state();

  const cur = $derived(states[states.length - 1]);
  const shownRaw = $derived(viewing === null ? cur : (states.find((x) => x.steps > viewing!) ?? cur));
  const shown = $derived(shownRaw ? viewFor(shownRaw, 0) : undefined);
  const live = $derived(!!cur && viewing === null && cur.winner === null);
  const myTurn = $derived(live && !watch && actor(cur!) === 0);
  const req = $derived(myTurn && cur!.pending ? cur!.pending.request : null);
  const legal = $derived(myTurn && !cur!.pending ? legalActions(cur!) : []);
  const hand = $derived(myTurn && !cur!.pending ? handActions(cur!) : new Map());
  const attacks = $derived(legal.filter((a) => a.t === 'attack'));
  const retreats = $derived(legal.filter((a) => a.t === 'retreat'));
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
    if (retreatMode) for (const a of retreats) if (a.t === 'retreat') t.add(a.to);
    return t;
  });
  // Setup: Basics in your hand are the options; drag them to the Active Spot / Bench or tap them.
  const setupReq = $derived(req && (req.purpose === 'setup-active' || req.purpose === 'setup-bench') ? req : null);
  const optionOf = (c: CardId) => setupReq?.options.find((o) => o.card === c);
  const handPlayable = $derived(
    setupReq ? new Set(setupReq.options.map((o) => o.card!)) : new Set<CardId>(hand.keys()),
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
  const oppUsed = $derived.by(() => {
    if (!cur) return [];
    const counts = new Map<string, number>();
    for (const c of cur.players[1].discard) {
      const d = def(keyOf(cur, c));
      if (d.category === 'trainer' && d.trainerType !== 'Item') counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  });

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ opponent, level, speed, pierce, includeFestival, anim: animLevel }));
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
    bot = createBot(planFor(pick.slug), level, seed ^ 0x2545f491, planFor('player', policy));
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
    // Bring the table into view when it doesn't fit below the page header.
    requestAnimationFrame(() => {
      if (mainEl && mainEl.getBoundingClientRect().bottom > innerHeight) mainEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
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
    retreatMode = false;
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
    const who = actor(s) === 1 ? bot : meBot;
    if (!who) return;
    const delay = Math.max(s.pending ? Math.min(speed, 250) : speed, busyUntil - performance.now());
    const t = setTimeout(() => step(who.act(s)), delay);
    return () => clearTimeout(t);
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
    retreatMode = false;
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
    if (retreatMode) step({ t: 'retreat', to: uid });
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
        retreatMode = false;
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

  // While dragging near the top of the screen, scroll up so the whole board can be reached.
  $effect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => {
      if (drag && drag.y < 70) window.scrollBy(0, -12);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

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
        bot = createBot(planFor(botSlug), level, seed ^ 0x2545f491 ^ i, planFor('player'));
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
      <input type="checkbox" bind:checked={pierce} /> Twin Shotels ทะลุ Rabsca/Shaymin (ruling ยังไม่ยืนยัน, ค่าเริ่มต้น: ไม่ทะลุ)
    </label>
    <DeckEditor defaultList={playerList} />
    <button type="button" class="primary" onclick={start}>เริ่มเกม</button>
  </section>
{:else if shown}
  <div class="game" class:dragging>
    <div class="main" bind:this={mainEl}>
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
      </div>

      <Board
        s={shown}
        {targets}
        picks={pickCounts}
        {abilities}
        drag={boardDrag}
        {grabbable}
        ghostBench={[...marked].map((c) => keyOf(cur, c))}
        onslot={onSlot}
        onability={(slot, name) => step({ t: 'ability', slot, name })}
        onzoom={(k) => (zoom = k)}
        ondiscard={(p) => (discardOf = p)}
        onpress={onSlotPress}
        canUseStadium={canStadium}
        onstadium={() => step({ t: 'stadium' })}
      />

      {#if req}
        <ChoicePanel
          s={cur}
          {req}
          {picks}
          onpick={pick}
          onsubmit={() => step({ t: 'choose', picks })}
          onclear={() => (picks = [])}
          onzoom={(k) => (zoom = k)}
        />
      {/if}

      {#if error}<p class="error">{error}</p>{/if}

      <div class="dock">
        {#if narrow && myTurn && !req && cur.phase === 'main'}
          <Coach s={cur} onapply={follow} compact />
        {/if}
        {#if myTurn && !req}
          <div class="bar">
            {#each attacks as a}
              {#if a.t === 'attack'}
                <button type="button" class="attack" onclick={() => step(a)}>
                  {actionLabel(cur, a)}{a.from !== undefined ? ' (Memory Helix)' : ''}
                </button>
              {/if}
            {/each}
            {#if retreats.length}
              <button type="button" class:on={retreatMode} onclick={() => ((retreatMode = !retreatMode), (selected = null))}>
                {retreatMode ? 'เลือกตัวที่จะขึ้นมา…' : 'ถอย'}
              </button>
            {/if}
            <button type="button" onclick={() => step({ t: 'end' })}>จบเทิร์น</button>
            <button type="button" class="ghost" onclick={undo} disabled={history.length === 0}>ย้อน</button>
            {#if selected !== null}<span class="hint">แตะ Pokémon ที่ไฮไลต์ หรือลากการ์ดไปวาง</span>{/if}
          </div>
        {:else if setupReq}
          <p class="hint">ลากการ์ดจากมือไปวาง{setupReq.purpose === 'setup-active' ? 'ที่ช่องตัวหลัก' : 'บน Bench'} หรือแตะเพื่อเลือก</p>
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

    <aside class="side">
      {#if !narrow && myTurn && !req && cur.phase === 'main'}
        <Coach s={cur} onapply={follow} />
      {/if}
      <section class="panel">
        <h3>ข้อมูลคู่แข่ง</h3>
        <p>มือบอท {cur.players[1].hand.length} ใบ · เด็ค {cur.players[1].deck.length} ใบ</p>
        {#if oppUsed.length}
          <p class="muted">Supporter / Stadium ในกองทิ้งบอท (ใช้ไปแล้วหรือถูกทิ้ง)</p>
          <ul class="used">
            {#each oppUsed as [name, n]}<li><span>{name}</span><span class="mono">{n}</span></li>{/each}
          </ul>
        {:else}
          <p class="muted">ยังไม่มี Supporter/Stadium ในกองทิ้งบอท</p>
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
  .primary,
  .attack {
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-display);
    font-weight: 600;
  }
  .attack {
    position: relative;
    overflow: hidden;
    background: var(--stamp);
    border-color: var(--stamp);
    color: #fff;
  }
  /* An attack you can use shines now and then. */
  .attack::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(110deg, transparent 35%, #ffffff66 50%, transparent 65%) no-repeat;
    background-size: 250% 100%;
    background-position: 130% 0;
    pointer-events: none;
    animation: attack-sheen 2.8s ease-in-out infinite;
  }
  @keyframes attack-sheen {
    0%,
    55% {
      background-position: 130% 0;
    }
    100% {
      background-position: -30% 0;
    }
  }
  .ghost {
    background: transparent;
  }
  button.on {
    background: #f2c94c;
    color: #1f1c16;
  }
  .game {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 16px;
    align-items: start;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    align-items: baseline;
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
    position: sticky;
    bottom: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 6px;
    background: var(--paper);
    box-shadow: 0 -10px 12px -8px color-mix(in srgb, var(--ink) 25%, transparent);
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
    margin: 0;
    color: var(--stamp);
    font-size: 0.85rem;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    border-bottom: 1px dashed var(--rule);
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
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 700px) {
    .main {
      gap: 6px;
    }
    .status {
      font-size: 0.85rem;
    }
    .dock {
      gap: 4px;
      margin: 0 -16px;
      padding: 6px 12px calc(4px + env(safe-area-inset-bottom));
      background: var(--paper);
      border-top: 1.5px solid var(--ink);
      box-shadow: 0 -8px 18px color-mix(in srgb, var(--ink) 18%, transparent);
    }
    .bar {
      gap: 4px;
    }
    .bar button {
      padding: 5px 10px;
      font-size: 0.85rem;
    }
    .side {
      margin-top: 8px;
    }
  }
</style>
