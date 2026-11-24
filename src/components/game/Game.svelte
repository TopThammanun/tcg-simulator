<script lang="ts">
  // The play screen: the match sheet (your deck, the opponent), then you (player 0) vs a bot (player 1), played
  // as at a real table: no hints or take-backs. A saved game picked up again ("play on from here") has the cards
  // you couldn't see dealt again (engine/view.ts redeal()).
  // Every change of state is animated (src/ui/anim): the state changes at once, the animations only
  // show it, the bot waits for them, and anything you do skips them.
  import { untrack } from 'svelte';
  import { botName, href, langOfPath, setLang, tx, youName } from '../../i18n';
  import { fade, scale } from 'svelte/transition';
  import { actor, apply, createGame, legalActions, whyNotPlayable } from '../../engine/actions';
  import { benchLimit, maxHp } from '../../engine/rules';
  import { keyOf, slotsOf, topDef, topKey } from '../../engine/state';
  import type { Action, CardId, ChoiceRequest, GameState, PlayerId, SlotId } from '../../engine/types';
  import { redeal, viewFor } from '../../engine/view';
  import { makeBot } from '../../bots/core';
  import { remoteBot, type RemoteBot } from '../../bots/remote';
  import { DEFAULT_POLICY, planFor } from '../../bots/plans';
  import type { Bot } from '../../bots/types';
  import { def } from '../../engine/db';
  import { actionLabel, benchHint, describeAction, handActions, keyCommand, sortedHand, targetOf } from '../../ui/play';
  import { headline, nearestDeck, pickOpponent, type MetaDeck } from '../../ui/decks';
  import { loadMyDecks, myDeckCards } from '../../ui/my-decks';
  import { handDrops, pickDrop, setupDrops, slotDrops, zonesAt } from '../../ui/drag';
  import { preloadDecks } from '../../ui/images';
  import { trackPress } from '../../ui/press';
  import { slotMenu } from '../../ui/menu';
  import { previewAttack } from '../../ui/preview';
  import { slotInfo } from '../../ui/slot-info';
  import { lastOpponentTurn } from '../../ui/recap';
  import { cue as cueSound, KEY_VOICES, playVoice, setSound, voiceFor } from '../../ui/sound';
  import { animEvents, type AnimEvent } from '../../ui/anim/events';
  import { Fx, snapshot, type AnimLevel, type Snapshot } from '../../ui/anim/fx';
  import { motion, setAnimLevel } from '../../ui/anim/motion';
  import { reasonText, replay, type Redeal, type SavedGame } from '../../review/record';
  import { getGame, saveGame } from '../../review/store';
  import { clearCurrent, loadCurrent, saveCurrent, type CurrentGame } from '../../review/current';
  import { actionBar, type BarAction } from '../../ui/action-bar';
  import { loadSeenTips, nextTip, saveSeenTips, tipText, type TipId } from '../../ui/tips';
  import ActionBar from './ActionBar.svelte';
  import Inspector from './Inspector.svelte';
  import TopBar from './TopBar.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import Switch from '../ui/Switch.svelte';
  import Board, { type BoardDrag } from './Board.svelte';
  import CardBack from './CardBack.svelte';
  import CardFace from './CardFace.svelte';
  import CardInfo from './CardInfo.svelte';
  import ChoiceBar from './ChoiceBar.svelte';
  import PrizePick from './PrizePick.svelte';
  import ChoicePanel from './ChoicePanel.svelte';
  import HandDetail from './HandDetail.svelte';
  import HandView from './HandView.svelte';
  import LogPanel from './LogPanel.svelte';
  import PokemonMenu from './PokemonMenu.svelte';
  import FxLayer from './FxLayer.svelte';
  import GameOver from './GameOver.svelte';
  import HowTo from './HowTo.svelte';

  // The page's language (/en/play/ is English): the engine's log and every label below read it.
  setLang(langOfPath(location.pathname));

  /** The meta decks: yours to play, and the bots'. */
  let { decks }: { decks: MetaDeck[] } = $props();

  const SETTINGS_KEY = 'tcg-sim:play-settings';

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
  const SPEED_OPTIONS = [
    { value: 150, label: tx('เร็ว', 'Fast') },
    { value: 500, label: tx('ปกติ', 'Normal') },
    { value: 1100, label: tx('ช้า', 'Slow') },
  ];
  const ANIM_OPTIONS: { value: AnimLevel; label: string }[] = [
    { value: 'full', label: tx('เต็ม', 'Full') },
    { value: 'fast', label: tx('เร็ว', 'Fast') },
    { value: 'off', label: tx('ปิด', 'Off') },
  ];
  let speed = $state(params.has('speed') ? Number(params.get('speed')) : SPEEDS.includes(saved.speed as number) ? (saved.speed as number) : 500);
  const fixedSeed = params.has('seed') ? Number(params.get('seed')) : null;
  let seed = fixedSeed ?? Math.floor(Math.random() * 1e9);

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
  // The picked decks' pictures load while the match sheet is open (a slow connection has them by the first hand).
  $effect(() => preloadDecks(mineChoice.cards ?? [], oppChoice?.cards ?? []));
  /** Your deck's plan (a meta deck slug) and its name. */
  let minePlan = $state('');
  let mineName = $state('');
  /** Undos that dealt the hidden cards again (saved with the game, so it replays). */
  let redeals: Redeal[] = [];
  let howto = $state(false);
  /** The game menu (new game, how to play, settings), and on a phone the bot's last turn, each in a sheet. */
  let menuOpen = $state(false);
  let recapOpen = $state(false);
  /** A game left unfinished in this browser (review/current.ts): offered on the match sheet. */
  let unfinished = $state.raw<CurrentGame | null>(watch || params.has('resume') ? null : loadCurrent());
  /** Moves made in this page since a position was loaded by the tests (__tcg.load): such a game isn't kept. */
  let loaded = false;
  /** Where each card of a deck's fan sits: the headline Pokémon in the middle, the next two either side. */
  const FAN = [0, -1, 1];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Your hand sorted by kind and name (on unless turned off; saved with the other settings). */
  let sortHand = $state(saved.sortHand !== false);
  /** Sounds (ui/sound.ts); on unless turned off, never while watching the bots (the end-to-end tests). */
  let soundOn = $state(saved.sound !== false);
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
  /** "จบเทิร์น" pressed while an attack can still be used: the dock asks first (an attack lost by a slip is a turn). */
  let confirmEnd = $state(false);
  /** "เกมใหม่" pressed in a game that isn't over: the dock asks first (the game isn't saved until it ends). */
  let confirmNew = $state(false);
  /** The turn whose recap of the bot's last turn was closed (✕ or your first move). */
  let recapClosed = $state(-1);
  let menuAnchor = $state<DOMRect | null>(null);
  let picks = $state<number[]>([]);
  let zoom = $state<string | null>(null);
  /** The zoomed card is a Pokémon in play: its state shows too (ui/slot-info.ts). */
  let zoomSlot = $state<SlotId | null>(null);
  function zoomTo(key: string, slot: SlotId | null = null) {
    zoom = key;
    zoomSlot = slot;
  }
  let discardOf = $state<PlayerId | null>(null);
  let error = $state('');

  // The card text panel (computers): the face-up card under the mouse for a moment, else the card picked up from the
  // hand, else the last one shown. Cards carry `data-inspect` (their key) and Pokémon in play `data-slot`.
  let hovered = $state<{ key: string; slot: SlotId | null } | null>(null);
  let lastShown = $state<{ key: string; slot: SlotId | null } | null>(null);
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  function onPointerOver(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || narrow) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-inspect]');
    clearTimeout(hoverTimer);
    if (!el) {
      hoverTimer = setTimeout(() => (hovered = null), 120);
      return;
    }
    const slotEl = el.closest<HTMLElement>('[data-slot]');
    const next = { key: el.dataset.inspect!, slot: slotEl ? Number(slotEl.dataset.slot) : null };
    hoverTimer = setTimeout(() => (hovered = lastShown = next), 120);
  }

  // One-time tips in the command bar (ui/tips.ts).
  let seenTips = $state(loadSeenTips());

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
  /**
   * What the bot did on its last turn, while your turn hasn't started moving: its lines are marked in the log (a
   * computer), or a button in the command bar opens them (a phone). Nothing is laid over the table.
   */
  const recap = $derived(
    myTurn && !req && viewing === null && cur && recapClosed !== cur.turn ? lastOpponentTurn(cur) : [],
  );
  const attacksLeft = $derived([...new Set(legal.filter((a) => a.t === 'attack').map((a) => (a as { name: string }).name))]);
  /** The card picked up from your hand (its text over the bot's side; what it does, in the dock). */
  const held = $derived(selected !== null && cur && !req && cur.players[0].hand.includes(selected) ? selected : null);
  const heldActions = $derived(held !== null ? hand.get(held) : undefined);
  const heldWhy = $derived(held !== null && myTurn && !heldActions ? whyNotPlayable(cur!, held) : null);
  /**
   * Your answers so far to the card being played (Energy Switch: which Pokémon, which Energy, then where): shown with
   * the next question, and the Pokémon picked are marked on the table. Same `pending.base` = the same play.
   */
  let chain = $state.raw<{ base: GameState; steps: { req: ChoiceRequest; picks: number[] }[] } | null>(null);
  const earlier = $derived(chain && cur?.pending && cur.pending.base === chain.base ? chain.steps : []);
  const earlierWords = $derived(
    earlier.flatMap((st) =>
      st.req.options.filter((o) => st.picks.includes(o.value)).map((o) => (st.req.hint === 'from' ? tx(`จาก ${o.label}`, `from ${o.label}`) : o.label)),
    ),
  );
  const chosenSlots = $derived(
    new Map<SlotId, string>(
      earlier.flatMap((st) =>
        st.req.options
          .filter((o) => o.slot !== undefined && st.picks.includes(o.value))
          .map((o) => [o.slot!, st.req.hint === 'from' ? tx('จาก', 'from') : tx('เลือกแล้ว', 'chosen')] as [SlotId, string]),
      ),
    ),
  );
  /**
   * A pick of an Energy (or Tool) attached to a Pokémon (Energy Switch, Crushing Hammer): made on the table, by tapping
   * it on its Pokémon. Every attached card that stands for an option (one option per name: any copy on that Pokémon).
   */
  const attachedPick = $derived.by(() => {
    if (!req || req.view || !req.options.length || !req.options.every((o) => o.card !== undefined) || !cur) return null;
    const where = new Map<CardId, SlotId>();
    for (const p of [0, 1] as const)
      for (const sl of slotsOf(cur.players[p])) {
        for (const e of sl.energy) where.set(e, sl.uid);
        if (sl.tool !== null) where.set(sl.tool, sl.uid);
      }
    if (!req.options.every((o) => where.has(o.card!))) return null;
    const m = new Map<CardId, number>();
    for (const [c, uid] of where) {
      const o =
        req.options.find((x) => x.card === c) ??
        req.options.find((x) => where.get(x.card!) === uid && keyOf(cur!, x.card!) === keyOf(cur!, c));
      if (o) m.set(c, o.value);
    }
    return m;
  });
  const menu = $derived(menuFor !== null && myTurn && !cur!.pending ? slotMenu(cur!, legal, menuFor) : null);
  /** What each usable attack in the pop-up would do to their Active (ui/preview.ts), in the menu's order. */
  const previews = $derived(
    menu ? menu.attacks.map((a) => (a.action?.t === 'attack' ? previewAttack(cur!, a.action) : null)) : [],
  );
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
    if (attachedPick && cur)
      for (const p of [0, 1] as const)
        for (const sl of slotsOf(cur.players[p]))
          if ([...sl.energy, sl.tool].some((c) => c !== null && attachedPick.has(c))) t.add(sl.uid);
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
  /** Which face-down Prize cards to take (engine/rules.ts takePrizes): picked full screen (PrizePick.svelte). */
  const prizeReq = $derived(req?.hint === 'prizes' ? req : null);
  /** The bot's Pokémon this play Knocked Out: in play before it, gone now (named over the Prize cards). */
  const knockedOut = $derived.by(() => {
    const p = prizeReq && cur?.pending;
    if (!p) return [];
    const now = new Set(slotsOf(cur!.players[1]).map((sl) => sl.uid));
    return slotsOf(p.base.players[1])
      .filter((sl) => !now.has(sl.uid))
      .map((sl) => topDef(p.base, sl).name);
  });
  /** The choice is made by tapping on the table (a Pokémon, an Energy on one), not in a box. */
  const onTable = $derived(!!req && !setupReq && (choiceKind === 'slot' || !!attachedPick));
  /**
   * Where each Prize card lies in its grid: a taken one leaves a gap, as at a real table (a Prize picked from the
   * middle leaves the middle empty). Remembered by card, in this script only (the page never sees which card a
   * Prize is). Per player: the Prize pile's index at each grid spot, or null.
   */
  const prizeSpot = new Map<CardId, number>();
  const prizeGrid = $derived.by(() => {
    if (!shownRaw) return null;
    return ([0, 1] as const).map((p) => {
      const prizes = shownRaw.players[p].prizes;
      const grid: (number | null)[] = Array(6).fill(null);
      const rest: number[] = [];
      prizes.forEach((c, i) => {
        const at = prizeSpot.get(c);
        if (at !== undefined && at < grid.length && grid[at] === null) grid[at] = i;
        else rest.push(i);
      });
      for (const i of rest) {
        const at = grid.indexOf(null);
        if (at < 0) break;
        grid[at] = i;
        prizeSpot.set(prizes[i]!, at);
      }
      return grid;
    }) as [(number | null)[], (number | null)[]];
  });
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

  /** The top line: whose turn it is, or the result; the two decks; the links at the end. */
  const topTitle = $derived(
    !cur
      ? ''
      : cur.winner !== null
        ? `${cur.winner === 0 ? tx('คุณชนะ', 'You win') : cur.winner === 1 ? tx('บอทชนะ', 'Bot wins') : tx('เสมอ', 'Draw')} · ${cur.winReason}`
        : viewing !== null
          ? tx('กำลังดูสนามย้อนหลัง', 'Viewing an earlier position')
          : watch
            ? tx(`ดูบอทเล่น · เทิร์น ${cur.turn}`, `Watching the bot · turn ${cur.turn}`)
            : `${tx('เทิร์น', 'Turn')} ${cur.turn} · ${actor(cur) === 0 ? tx('ตาคุณ', 'your turn') : tx('บอทกำลังคิด…', 'the bot is thinking…')}`,
  );
  const topSub = $derived(
    cur && cur.winner === null && viewing === null && !watch
      ? [`${mineName} vs ${botDeck?.name ?? ''}`, ...(resumedFrom ? [tx(`เล่นต่อจากเกมที่บันทึกไว้ (เทิร์น ${resumedFrom.turn})`, `Played on from a saved game (turn ${resumedFrom.turn})`)] : [])]
      : [],
  );
  const topLinks = $derived(
    cur && cur.winner !== null
      ? [
          ...(savedId !== null ? [{ href: href(`/review/?id=${savedId}`), label: tx('รีวิวเกมนี้', 'Review this game') }] : []),
          { href: href(`/decks/${botSlug}/`), label: tx(`ดูลิสต์ที่บอทใช้ (${botDeck?.name ?? ''})`, `The bot's list (${botDeck?.name ?? ''})`) },
        ]
      : [],
  );

  /** What the card text panel shows (computers). */
  const inspected = $derived(hovered ?? (held !== null && cur ? { key: keyOf(cur, held), slot: null } : lastShown));
  /** The tip for now, if one is still unseen (shown in the command bar, gone once you move). */
  const tip = $derived<TipId | null>(
    myTurn && !req && held === null && !confirmEnd && !watch && !testing
      ? nextTip({ free: true, canAttack: attacksLeft.length > 0, desktop: !narrow }, seenTips)
      : null,
  );
  /** A choice in a box over the table (ChoicePanel): its buttons are in the command bar. */
  const boxReq = $derived(req && !setupReq && !onTable && !prizeReq ? req : null);
  const bar = $derived(
    cur
      ? actionBar({
          s: cur,
          myTurn,
          legal,
          watch,
          viewing: viewing !== null,
          confirmEnd,
          confirmNew,
          attacksLeft,
          held:
            held !== null
              ? {
                  name: def(keyOf(cur, held)).name,
                  actions: heldActions,
                  why: heldWhy,
                  playLabel: heldActions?.kind === 'now' ? actionLabel(cur, heldActions.action) : undefined,
                }
              : undefined,
          setup: setupReq
            ? {
                step: setupReq.purpose === 'setup-active' ? 'active' : 'bench',
                hint: benchHint(setupReq, picks.length, benchLimit(cur, 0) - cur.players[0].bench.length),
                picked: picks.length,
              }
            : undefined,
          box: boxReq ? { req: boxReq, picks, cards: choiceKind === 'card' || !!boxReq.view?.length } : undefined,
          recap: narrow ? recap.length : 0,
          tip: tip ? tipText(tip) : null,
          prompt: req?.prompt,
        })
      : null,
  );

  /** A button of the command bar. */
  function onBar(id: BarAction) {
    if (!cur) return;
    switch (id) {
      case 'end':
        if (attacksLeft.length) confirmEnd = true;
        else step({ t: 'end' });
        break;
      case 'end-anyway':
        step({ t: 'end' });
        break;
      case 'back-to-attack':
        confirmEnd = false;
        menuFor = cur.players[0].active?.uid ?? null;
        menuAnchor = menuFor !== null ? (document.querySelector(`[data-slot="${menuFor}"] .card`)?.getBoundingClientRect() ?? null) : null;
        break;
      case 'stay':
        confirmNew = false;
        break;
      case 'leave':
        newGame(true);
        break;
      case 'cancel':
        selected = null;
        break;
      case 'play':
        if (heldActions?.kind === 'now') step(heldActions.action);
        break;
      case 'setup-clear':
      case 'box-clear':
        picks = [];
        break;
      case 'setup-confirm':
      case 'box-confirm':
        step({ t: 'choose', picks });
        break;
      case 'recap':
        recapOpen = true;
        break;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ opponent, speed, mine: mineId, anim: animLevel, sortHand, sound: soundOn }));
    } catch {
      /* ignore */
    }
  }

  /** A new game from the match sheet; `again`: against the same bot deck as the game just played (a new deal). */
  function start(again = false) {
    // Watching (the end-to-end tests) doesn't change your settings.
    if (!watch) saveSettings();
    showOver = false;
    if (fixedSeed === null) seed = Math.floor(Math.random() * 1e9);
    const same = again ? decks.find((d) => d.slug === botSlug) : undefined;
    const pick =
      same ??
      (opponent === 'random' ? pickOpponent(decks, (seed % 10007) / 10007, (Math.floor(seed / 10007) % 7919) / 7919) : oppChoice!);
    botSlug = pick.slug;
    minePlan = mineChoice.plan;
    mineName = mineChoice.name;
    redeals = [];
    savedId = null;
    resumedFrom = null;
    curBotSeed = seed ^ 0x2545f491;
    botFor(pick.slug, curBotSeed);
    if (watch) meBot = makeBot(planFor(minePlan), { seed: seed ^ 0x1b873593 });
    error = '';
    viewing = null;
    history = [];
    const myCards = mineChoice.cards!;
    gameDecks = [myCards, pick.cards];
    preloadDecks(myCards, pick.cards);
    states = [
      createGame({
        seed,
        decks: [
          { name: youName(), cards: myCards },
          { name: botName(), cards: pick.cards },
        ],
        names: [youName(), botName()],
        rules: { twinShotelsPiercesBenchShields: pierce, pickPrizes: true },
      }),
    ];
    loaded = false;
    unfinished = null;
  }

  /** Back to the match sheet; a game still being played is only left once the dock's question is answered. */
  function newGame(sure = false) {
    sideOpen = false;
    menuOpen = false;
    if (!sure && cur && cur.winner === null && !watch) {
      confirmNew = true;
      return;
    }
    confirmNew = false;
    showOver = false;
    menuOpen = false;
    if (cur && cur.winner === null) clearCurrent();
    states = [];
  }

  /** The bot for a game: it thinks in a Web Worker (src/bots/worker.ts) so its search never freezes the page. */
  function botFor(slug: string, botSeed: number, policy = DEFAULT_POLICY) {
    bot?.dispose();
    // Watching a game plays it with the bots the simulator uses (the bot without look-ahead).
    bot = remoteBot({ slug, oppSlug: minePlan, seed: botSeed, policy, fast: watch });
  }

  /** Go on with the game left unfinished in this browser: the same deal and moves, so the very same position. */
  function goOn(c: CurrentGame) {
    const g = c.game;
    seed = g.seed;
    botSlug = g.opponent;
    minePlan = g.mine ?? 'player';
    mineName = g.mineName ?? tx('ลิสต์ของคุณ', 'Your list');
    gameDecks = g.decks;
    preloadDecks(...g.decks);
    redeals = (g.redeals ?? []).slice();
    savedId = null;
    showOver = false;
    error = '';
    viewing = null;
    resumedFrom = c.resumedFrom ?? null;
    botFor(g.opponent, c.botSeed, g.policy);
    curBotSeed = c.botSeed;
    history = g.actions.slice();
    states = replay(g);
    loaded = false;
    unfinished = null;
  }

  /** Pick a saved game up at state `at` (your turn): the same seed, lists and moves up to there. */
  async function resume(id: number, at: number) {
    const g = await getGame(id);
    if (!g) {
      error = tx('ไม่เจอเกมที่บันทึกไว้', 'Saved game not found');
      return;
    }
    const all = replay(g);
    const upto = Math.max(0, Math.min(at, g.actions.length));
    seed = g.seed;
    botSlug = g.opponent;
    minePlan = g.mine ?? 'player';
    mineName = g.mineName ?? tx('ลิสต์ของคุณ', 'Your list');
    gameDecks = g.decks;
    preloadDecks(...g.decks);
    savedId = null;
    showOver = false;
    error = '';
    viewing = null;
    resumedFrom = { id, turn: all[upto]!.turn };
    curBotSeed = g.seed ^ 0x2545f491 ^ upto;
    botFor(g.opponent, curBotSeed, g.policy);
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

  /** The bot's seed for this game (kept with an unfinished game, so it goes on the same way). */
  let curBotSeed = 0;
  /** The game as a record (seed, lists, moves, re-deals): saved when it ends, kept in this browser until then. */
  function record(s: GameState): SavedGame {
    return {
      savedAt: Date.now(),
      seed,
      opponent: botSlug,
      opponentName: botDeck?.name ?? botSlug,
      mine: minePlan,
      mineName,
      mode: 'real',
      redeals: redeals.slice(),
      rules: { ...s.rules },
      policy: { ...DEFAULT_POLICY },
      decks: [gameDecks[0].slice(), gameDecks[1].slice()],
      actions: $state.snapshot(history) as Action[],
      winner: s.winner,
      reason: s.winReason,
      turns: s.turn,
    };
  }
  // After every move of a game being played, it is kept in this browser (review/current.ts); not while watching the
  // bots, nor a position the tests built.
  $effect(() => {
    const s = cur;
    void history;
    if (!s || watch || loaded) return;
    if (s.winner !== null) clearCurrent();
    else untrack(() => saveCurrent({ game: record(s), botSeed: curBotSeed, turn: s.turn, resumedFrom }));
  });

  // A finished game of yours is saved for the review page (watch-mode games only with &save=1).
  let saving = false;
  $effect(() => {
    const s = cur;
    if (!s || s.winner === null || savedId !== null || saving || (watch && !params.has('save'))) return;
    saving = true;
    saveGame(record(s))
      .then((id) => (savedId = id))
      .catch(() => (error = tx('บันทึกเกมไม่ได้', "The game couldn't be saved")))
      .finally(() => (saving = false));
  });

  function step(a: Action) {
    fx?.finish();
    drag = null;
    confirmEnd = false;
    // A move of yours answers "ทิ้งเกมนี้?" with no; the bot's moves leave the question up. A tip shown is now seen.
    if (cur && actor(cur) === 0) {
      recapClosed = cur.turn;
      confirmNew = false;
      if (tip) {
        seenTips = new Set([...seenTips, tip]);
        saveSeenTips(seenTips);
      }
    }
    // The action goes into the history (saved to IndexedDB) and the state (posted to the bot's worker), which take
    // plain data only; `picks` of the choice box and setup bar is a $state proxy, and so could any other action be.
    a = $state.snapshot(a);
    if (a.t === 'choose' && cur?.pending) {
      const st = { req: cur.pending.request, picks: a.picks };
      const base = cur.pending.base;
      chain = chain && chain.base === base ? { base, steps: [...chain.steps, st] } : { base, steps: [st] };
    }
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

  $effect(() => setSound(soundOn && !watch));

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
  /** The Prize picker opens once the Knock Out has been shown. */
  let prizeOpen = $state(false);
  let prizeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (fxLayer && !fx) {
      fx = new Fx(fxLayer, document.body);
      fx.cue = (e, inMs) => cueSound(e, inMs);
    }
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
      if (idx === animated) {
        prizeOpen = list[idx]!.pending?.request.hint === 'prizes';
        return;
      }
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
      } else {
        fx?.finish();
        // Nothing animated: the sounds that matter, at once.
        if (soundOn && !watch && v === null && animated >= 0 && idx > animated) {
          const from = animated;
          for (const e of list.slice(from, idx).flatMap((s, i) => animEvents(s, list[from + i + 1]!, history[from + i]))) {
            const voice = voiceFor(e);
            if (voice && KEY_VOICES.has(voice)) playVoice(voice);
          }
        }
      }
      animated = idx;
      // A short beat after the animations before the bot moves again.
      busyUntil = total ? performance.now() + total + 150 : 0;
      clearTimeout(overTimer);
      if (next.winner === null) showOver = false;
      else if (!showOver) overTimer = setTimeout(() => (showOver = true), total + (total ? 400 : 0));
      clearTimeout(prizeTimer);
      prizeOpen = false;
      if (next.pending?.request.hint === 'prizes') prizeTimer = setTimeout(() => (prizeOpen = true), total);
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
        // Ignore an answer for a position that is gone (a new game).
        if (!stale && cur === s) step(a);
      } catch (e) {
        if (!stale) error = tx(`บอทเกิดข้อผิดพลาด: ${(e as Error).message}`, `Bot error: ${(e as Error).message}`);
      }
    }, delay);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  });

  // Test hook: Playwright reads the engine state to compare with the screen, or sets up a position to play from.
  if (testing)
    (window as unknown as { __tcg: unknown }).__tcg = {
      state: () => cur,
      history: () => history,
      load: (s: GameState) => {
        loaded = true;
        states = [s];
        history = [];
        selected = null;
        picks = [];
      },
    };
  if (watch) start();
  else if (params.has('resume')) void resume(Number(params.get('resume')), Number(params.get('at') ?? 0));

  function onHand(c: CardId) {
    if (setupReq) {
      const o = optionOf(c);
      if (o) pick(o.value);
      return;
    }
    menuFor = null;
    const ca = hand.get(c);
    // As at a real table, a tap picks the card up; a card that needs no target is played by tapping it again (or
    // the button in the dock), one that does by tapping the Pokémon. Dragging plays it at once.
    if (selected === c) {
      if (ca?.kind === 'now') step(ca.action);
      else selected = null;
      return;
    }
    // Any card can be picked up to read it (HandDetail), playable or not.
    selected = c;
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
    if (sl) zoomTo(topKey(shown!, sl), sl.uid);
  }

  function pick(v: number) {
    if (!req) return;
    // One Pokémon / Energy tapped on the table, your Active at setup, or one of a few words: that's the answer. A card
    // picked from a box is marked first and confirmed (so it can be looked at; a real game asks too).
    if (req.max === 1 && req.min === 1 && (onTable || !!setupReq || choiceKind !== 'card')) {
      step({ t: 'choose', picks: [v] });
      return;
    }
    if (req.max === 1 && !req.repeat && !picks.includes(v)) {
      picks = [v];
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

  function press(e: PointerEvent, key: string, drops: Map<string, Drop>, card?: CardId, slot: SlotId | null = null) {
    trackPress(e, {
      canDrag: drops.size > 0,
      onLongPress: () => zoomTo(key, slot),
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
          label: active ? tx('วางเป็นตัวหลัก', 'Make Active') : tx('ลง Bench', 'Bench'),
          run: () => (active ? step({ t: 'choose', picks: [v] }) : !picks.includes(v) && pick(v)),
        });
      }
    } else if (myTurn && !req) {
      for (const [zone, a] of handDrops(hand.get(c))) drops.set(zone, { label: describeAction(cur, a), run: () => step(a) });
    }
    press(e, keyOf(cur, c), drops, c);
  }

  /** Keyboard on a computer (ui/play.ts keyCommand): E end turn, A attacks, 1–9 hand card, Enter confirm, Esc close. */
  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    const typing = !!el && (!!el.closest('input, select, textarea') || el.isContentEditable);
    const cmd = keyCommand({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, typing });
    // A sheet (the menu, the bot's last turn) or "วิธีเล่น" over the game takes the keys.
    if (!cmd || !cur || howto || drag || menuOpen || recapOpen) return;
    if (cmd.t === 'close') {
      // The topmost thing first.
      if (zoom) (zoom = null), (zoomSlot = null);
      else if (discardOf !== null) discardOf = null;
      else if (menuFor !== null) menuFor = null;
      else if (confirmNew) confirmNew = false;
      else if (confirmEnd) confirmEnd = false;
      else if (selected !== null) selected = null;
      else if (recap.length) recapClosed = cur.turn;
      return;
    }
    if (!myTurn || zoom || discardOf !== null) return;
    // Enter on a focused button presses that button.
    if (cmd.t === 'confirm' && el?.closest('button, a, [role="button"]')) return;
    e.preventDefault();
    if (cmd.t === 'end') {
      if (req || menuFor !== null) return;
      if (confirmEnd || !attacksLeft.length) step({ t: 'end' });
      else confirmEnd = true;
    } else if (cmd.t === 'attack') {
      const a = cur.players[0].active;
      if (req || !a || !slotMenu(cur, legal, a.uid)) return;
      selected = null;
      menuFor = a.uid;
      menuAnchor = document.querySelector(`[data-slot="${a.uid}"] .card`)?.getBoundingClientRect() ?? null;
    } else if (cmd.t === 'confirm') {
      if (req && !setupReq) {
        if (picks.length > 0 && picks.length >= req.min && picks.length <= req.max) step({ t: 'choose', picks });
      } else if (confirmEnd) step({ t: 'end' });
      else if (selected !== null) {
        const ca = hand.get(selected);
        if (ca?.kind === 'now') step(ca.action);
      }
    } else if (cmd.t === 'hand') {
      // Your Prize spots by number while they are picked.
      if (prizeReq) {
        const at = prizeOpen ? prizeGrid?.[0][cmd.index] : undefined;
        if (at !== null && at !== undefined) pick(at);
        return;
      }
      if (req && !setupReq) return;
      const own = cur.players[0].hand;
      const c = (sortHand ? sortedHand(cur, own) : own)[cmd.index];
      if (c !== undefined) onHand(c);
    }
  }

  function onSlotPress(uid: SlotId, e: PointerEvent) {
    if (!shown || !cur) return;
    const sl = [0, 1].flatMap((p) => slotsOf(shown!.players[p as PlayerId])).find((x) => x.uid === uid);
    if (!sl) return;
    const drops = new Map<string, Drop>();
    if (grabbable.has(uid)) {
      for (const [zone, a] of slotDrops(cur, legal, uid)) drops.set(zone, { label: describeAction(cur, a), run: () => step(a) });
    }
    press(e, topKey(shown, sl), drops, undefined, uid);
  }
</script>

<svelte:window onkeydown={onKey} />

{#if !cur}
  <section class="setup" aria-labelledby="setup-title">
    <header class="sheet-head">
      <div>
        <p class="eyebrow">{tx('ตั้งค่าเกม', 'Game setup')}</p>
        <h1 id="setup-title">{tx('เลือกเด็ค แล้วลงสนาม', 'Pick the decks and play')}</h1>
      </div>
      <button type="button" class="link" onclick={() => (howto = true)}>{tx('วิธีเล่น', 'How to play')}</button>
    </header>

    {#if unfinished}
      {@const g = unfinished.game}
      <div class="unfinished" role="region" aria-label={tx('เกมที่ค้างไว้', 'Unfinished game')}>
        <div>
          <strong>{tx('มีเกมที่ค้างไว้', 'You have an unfinished game')}</strong>
          <span>{tx('เทิร์น', 'Turn')} {unfinished.turn} · {g.mineName ?? tx('ลิสต์ของคุณ', 'Your list')} vs {g.opponentName}</span>
        </div>
        <span class="acts">
          <Button onclick={() => (clearCurrent(), (unfinished = null))}>{tx('ทิ้งเกมนี้', 'Discard')}</Button>
          <Button variant="primary" onclick={() => goOn(unfinished!)}>{tx('เล่นต่อเกมที่ค้างไว้', 'Play it on')}</Button>
        </span>
      </div>
    {/if}

    <div class="match">
      <div class="corner you">
        <span class="who">{tx('คุณ', 'You')}</span>
        <div class="fan" aria-hidden="true">
          {#each mineChoice.cards ? headline(mineChoice.cards, mineChoice.name) : [] as k, j (k)}
            <span class="fc" style:--o={FAN[j]} style:z-index={3 - j}><CardFace cardKey={k} /></span>
          {/each}
        </div>
        <label>
          {tx('เด็คของคุณ', 'Your deck')}
          <select bind:value={mineId}>
            <optgroup label={tx('เด็คใน meta', 'Meta decks')}>
              {#each decks as d}<option value={d.slug}>{d.name}</option>{/each}
            </optgroup>
            {#if myDecks.length}
              <optgroup label={tx('เด็คของฉัน', 'My decks')}>
                {#each choices.filter((c) => c.id.startsWith('my:')) as c}
                  <option value={c.id} disabled={!c.cards}>{c.name}{c.cards ? '' : tx(' (ลิสต์นี้ยังเล่นไม่ได้)', ' (list not playable)')}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        </label>
        <a class="more" href={href('/builder/')}>{tx('+ จัดเด็คของคุณเอง', '+ Build your own deck')}</a>
      </div>

      <div class="vs" aria-hidden="true"><span>VS</span></div>

      <div class="corner them">
        <span class="who">{tx('บอท', 'Bot')}</span>
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
          {tx('คู่แข่ง', 'Opponent')}
          <select bind:value={opponent}>
            <option value="random">{tx('สุ่มตามสัดส่วนเด็คใน meta', 'Random, by meta share')}</option>
            {#each decks as d}
              <option value={d.slug}>{d.rank}. {d.name} · {d.metaShare?.toFixed(1)}%</option>
            {/each}
          </select>
        </label>
        <a class="more" href={href(oppChoice ? `/decks/${oppChoice.slug}/` : '/decks/')}>{tx('ดูลิสต์ของบอท', "The bot's list")}</a>
      </div>
    </div>

    <div class="prefs">
      <Segmented label={tx('ความเร็วบอท', 'Bot speed')} options={SPEED_OPTIONS} bind:value={speed} />
      <Segmented label={tx('ภาพเคลื่อนไหว', 'Animation')} options={ANIM_OPTIONS} bind:value={animLevel} />
      <Button variant="primary" class="start" onclick={() => start()}>{tx('เริ่มเกม', 'Start')}</Button>
    </div>
  </section>
{:else if shown}
  {#snippet choice()}
    <ChoicePanel s={cur!} req={req!} {picks} onpick={pick} onzoom={(k) => zoomTo(k)} />
  {/snippet}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="game" class:dragging onpointerover={onPointerOver}>
    <div class="rotate" role="status">
      <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="14" y="6" width="20" height="36" rx="3" /><path d="M40 20a14 14 0 0 1-6 14M38 34h-4v-4" /></svg>
      <strong>{tx('หมุนจอเป็นแนวตั้งเพื่อเล่น', 'Turn your screen upright to play')}</strong>
      <span>{tx('จอนี้เตี้ยเกินไป วางสนามได้ไม่ครบ (ถ้าใช้คอมพิวเตอร์ ลองขยายหน้าต่างให้สูงขึ้น)', 'This screen is too short for the whole table (on a computer, make the window taller)')}</span>
    </div>
    <div class="main">
      <TopBar
        title={topTitle}
        result={cur.winner !== null}
        sub={topSub}
        links={topLinks}
        back={viewing !== null ? () => (viewing = null) : null}
        {menuOpen}
        logOpen={sideOpen}
        {narrow}
        onmenu={() => (menuOpen = !menuOpen)}
        onlog={() => (sideOpen = !sideOpen)}
      />

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
        pickable={attachedPick}
        pickedValues={new Set(picks)}
        onpickcard={pick}
        {prizeGrid}
        choosing={onTable}
        chosen={chosenSlots}
        {ready}
        onzoom={(k) => zoomTo(k)}
        onzoomslot={(uid, k) => zoomTo(k, uid)}
        ondiscard={(p) => (discardOf = p)}
        onpress={onSlotPress}
        canUseStadium={canStadium}
        onstadium={() => step({ t: 'stadium' })}
      />

      <!-- Picking cards or an option opens a box over the table (its buttons are in the command bar); a Pokémon or an
           attached Energy is tapped on the table itself. The card picked up from your hand: its text in the side
           column on a computer, over the bot's side on a phone. -->
      {#if boxReq}
        <div class="choice-layer">{@render choice()}</div>
      {:else if held !== null && narrow}
        <div class="detail-layer">
          <HandDetail s={cur} card={held} onclose={() => (selected = null)} onzoom={(k) => zoomTo(k)} />
        </div>
      {/if}
      {#if error}<p class="error">{error}</p>{/if}
      </div>

      <div class="dock">
        <!-- The command bar: always there and always the same height (the table above never moves). -->
        <div class="cmd">
          {#if !confirmNew && req && !setupReq && onTable}
            <ChoiceBar
              {req}
              {picks}
              earlier={earlierWords}
              onsubmit={() => step({ t: 'choose', picks })}
              onclear={() => (picks = [])}
              onzoom={(k) => zoomTo(k)}
            />
          {:else if bar}
            <ActionBar {bar} onaction={onBar} />
          {/if}
        </div>

        <HandView
          s={shown}
          playable={handPlayable}
          {selected}
          {marked}
          lifted={drag?.card ?? null}
          sort={sortHand}
          dimUnplayable={myTurn || !!setupReq}
          onpick={onHand}
          onpress={onHandPress}
          onzoom={(k) => zoomTo(k)}
        />
      </div>
    </div>

    {#if narrow && sideOpen}
      <div class="side-backdrop" role="presentation" onclick={() => (sideOpen = false)}></div>
    {/if}
    <!-- Computers: the card text panel and the log. Phones: the log in a drawer. -->
    <aside class="side" class:open={sideOpen} aria-label={narrow ? tx('บันทึกเกม', 'Game log') : undefined}>
      {#if narrow}
        <div class="side-head">
          <strong>{tx('บันทึกเกม', 'Game log')}</strong>
          <IconButton icon="close" label={tx('ปิด', 'Close')} onclick={() => (sideOpen = false)} />
        </div>
      {:else}
        <Inspector
          cardKey={inspected?.key ?? null}
          info={inspected?.slot != null && shown ? slotInfo(shown, inspected.slot) : null}
          held={!hovered && held !== null}
          onzoom={(k) => zoomTo(k)}
        />
      {/if}
      <LogPanel log={cur.log} {viewing} recent={recap.length ? cur.turn - 1 : null} onview={(st) => (viewing = st)} />
    </aside>
  </div>
{/if}

{#if menuOpen && cur}
  <Sheet title={tx('เมนูเกม', 'Game menu')} onclose={() => (menuOpen = false)}>
    <div class="menu">
      <div class="menu-acts">
        <Button wide onclick={() => newGame()}>{tx('เกมใหม่', 'New game')}</Button>
        <Button wide onclick={() => ((howto = true), (menuOpen = false))}>{tx('วิธีเล่น', 'How to play')}</Button>
      </div>
      <Segmented label={tx('ความเร็วบอท', 'Bot speed')} options={SPEED_OPTIONS} bind:value={speed} onchange={saveSettings} />
      <Segmented label={tx('ภาพเคลื่อนไหว', 'Animation')} options={ANIM_OPTIONS} bind:value={animLevel} onchange={saveSettings} />
      <div class="switches">
        <Switch label={tx('เสียง', 'Sound')} bind:checked={soundOn} onchange={saveSettings} />
        <Switch label={tx('เรียงการ์ดในมือ', 'Sort your hand')} bind:checked={sortHand} onchange={saveSettings} />
      </div>
      <nav class="menu-links" aria-label={tx('ไปหน้าอื่น', 'Other pages')}>
        <a href={href(`/decks/${botSlug}/`)}>{tx('ดูลิสต์ที่บอทใช้', "The bot's list")} ({botDeck?.name ?? ''})</a>
        <a href={href('/review/')}>{tx('ประวัติเกม', 'Game history')}</a>
        <a href={href('/')}>{tx('กลับหน้าแรก', 'Home')}</a>
      </nav>
      {#if cur.winner === null && !watch}<p class="menu-note">{tx('เกมที่ยังไม่จบจะเก็บไว้ในเบราว์เซอร์นี้ ปิดหน้าไปแล้วกลับมาเล่นต่อได้', 'An unfinished game is kept in this browser: close the page and come back to it later')}</p>{/if}
    </div>
  </Sheet>
{/if}

{#if recapOpen && recap.length}
  <Sheet title={tx('เทิร์นที่แล้วบอทเล่นอะไรไป', "The bot's last turn")} onclose={() => (recapOpen = false)}>
    <ul class="recap-list" aria-label={tx('เทิร์นที่แล้วของบอท', "The bot's last turn")}>
      {#each recap as line}<li>{line}</li>{/each}
    </ul>
  </Sheet>
{/if}

<FxLayer bind:layer={fxLayer} />

{#if howto}<HowTo onclose={() => (howto = false)} />{/if}

{#if prizeReq && prizeOpen && prizeGrid}
  <PrizePick
    req={prizeReq}
    {knockedOut}
    grid={prizeGrid[0]}
    {picks}
    onpick={pick}
    onsubmit={() => step({ t: 'choose', picks })}
    onclear={() => (picks = [])}
  />
{/if}

{#if showOver && cur && cur.winner !== null && viewing === null}
  <GameOver
    winner={cur.winner}
    reason={reasonText(cur.winReason)}
    botDeck={botDeck?.name ?? ''}
    botHref={href(`/decks/${botSlug}/`)}
    reviewHref={savedId !== null ? href(`/review/?id=${savedId}`) : null}
    onagain={resumedFrom === null ? () => start(true) : undefined}
    onnew={() => newGame(true)}
    onclose={() => (showOver = false)}
  />
{/if}

{#if menu}
  {@const sl = slotsOf(cur!.players[0]).find((x) => x.uid === menu.uid)}
  <PokemonMenu
    {menu}
    {previews}
    info={slotInfo(cur!, menu.uid)}
    anchor={menuAnchor}
    hp={{ left: sl ? Math.max(0, maxHp(cur!, sl) - sl.damage) : 0, max: sl ? maxHp(cur!, sl) : 0 }}
    onact={(a) => ((menuFor = null), step(a))}
    onzoom={(k) => zoomTo(k)}
    onclose={() => (menuFor = null)}
  />
{/if}

{#if zoom}
  <CardInfo
    cardKey={zoom}
    info={zoomSlot !== null && shown ? slotInfo(shown, zoomSlot) : null}
    onclose={() => ((zoom = null), (zoomSlot = null))}
  />
{/if}

{#if drag}
  <div
    class="drag-ghost"
    class:touch={drag.touch}
    class:ok={drag.over !== null}
    style:transform={`translate(${drag.x}px, ${drag.y}px)`}
    style:--tilt={`${drag.tilt.toFixed(1)}deg`}
  >
    <div class="ghost-face"><CardFace cardKey={drag.key} /></div>
    <span class="ghost-label">{drag.over ? drag.drops.get(drag.over)!.label : tx('ลากไปวางที่ช่องที่สว่าง', 'Drag to a lit spot')}</span>
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
    <div class="discard" role="dialog" aria-label={tx('กองทิ้ง', 'Discard pile')}>
      <h3>{discardOf === 0 ? tx('กองทิ้งของคุณ', 'Your discard pile') : tx('กองทิ้งของบอท', "The bot's discard pile")} ({shown.players[discardOf].discard.length})</h3>
      <div class="grid">
        {#each shown.players[discardOf].discard as c, i (c)}
          <button
            type="button"
            data-inspect={keyOf(shown, c)}
            onclick={(e) => (e.stopPropagation(), zoomTo(keyOf(shown, c)))}
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
  /* The match sheet: your corner, VS, the bot's corner, then the settings and start. */
  .setup {
    max-width: 960px;
    margin: 0 auto;
    border: 1px solid var(--rule);
    background: var(--card-bg);
    border-radius: var(--radius-xl);
    /* clip, not hidden: hidden would make the sheet a scroll box, and the start row couldn't stick to the screen. */
    overflow: clip;
  }
  .sheet-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 32px 32px 24px;
    border-bottom: 1px solid var(--rule);
  }
  .sheet-head h1 {
    margin: 0;
    font-size: 30px;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .sheet-head .eyebrow {
    margin: 0 0 4px;
  }
  .sheet-head .link {
    flex: none;
    white-space: nowrap;
  }
  .match {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr);
  }
  .corner {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px 32px 32px;
  }
  .who {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
  }
  .who::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--mine);
  }
  .them .who::before {
    background: var(--theirs);
  }
  .fan {
    position: relative;
    height: clamp(8.5rem, 22vw, 10.5rem);
    margin: 8px 0;
  }
  .fc {
    position: absolute;
    bottom: 0;
    left: calc(50% - 3.3rem + var(--o) * 3.6rem);
    width: 6.6rem;
    border-radius: var(--radius);
    box-shadow:
      0 0 0 1px #ffffff14,
      -8px 0 16px -8px #000;
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
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--primary);
    color: var(--primary-ink);
    font-weight: 600;
    font-size: 24px;
    line-height: 1;
    box-shadow: 0 0 0 4px var(--card-bg);
  }
  .more {
    align-self: flex-start;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
    text-underline-offset: 4px;
    transition: color 0.3s var(--ease);
  }
  .more:hover {
    color: var(--ink-strong);
  }
  /* A hairline down the middle with VS on it. */
  .vs {
    position: relative;
    display: grid;
    place-items: center;
  }
  .vs::before {
    content: '';
    position: absolute;
    top: 24px;
    bottom: 24px;
    left: 50%;
    width: 1px;
    background: var(--rule);
  }
  .vs span {
    position: relative;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--card-bg);
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
  }
  .prefs {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px 16px;
    padding: 24px 32px;
    border-top: 1px solid var(--rule);
    background: var(--raised);
  }
  .prefs :global(.start) {
    margin-left: auto;
    padding: 8px 24px;
    font-size: 16px;
    line-height: 24px;
  }
  @media (max-width: 720px) {
    .match {
      grid-template-columns: 1fr;
    }
    .vs {
      height: 40px;
    }
    .vs::before {
      top: 50%;
      bottom: auto;
      left: 24px;
      right: 24px;
      width: auto;
      height: 1px;
    }
    .sheet-head,
    .corner,
    .prefs {
      padding-left: 16px;
      padding-right: 16px;
    }
    /* The settings and "เริ่มเกม" stay at the bottom of the screen while the sheet scrolls. */
    .prefs {
      position: sticky;
      bottom: 0;
      /* Over the decks' card fans (their cards are stacked up to z-index 3). */
      z-index: 5;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding-top: 12px;
      padding-bottom: calc(12px + env(safe-area-inset-bottom));
    }
    .prefs :global(.start) {
      grid-column: 1 / -1;
      margin: 0;
    }
  }
  .corner label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 500;
  }
  .corner select {
    padding: 8px 12px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink-strong);
    font: inherit;
    border-radius: var(--radius);
    transition: border-color 0.3s var(--ease);
  }
  .corner select:hover {
    border-color: var(--line-strong);
  }
  button {
    padding: 4px 12px;
    border: 1px solid var(--line);
    background: var(--control);
    color: var(--ink-strong);
    font: inherit;
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    cursor: pointer;
    border-radius: var(--radius);
    transition:
      background-color 0.3s var(--ease),
      border-color 0.3s var(--ease),
      transform 0.3s var(--ease);
  }
  button:hover:not(:disabled) {
    background: var(--control-hover);
  }
  button:active:not(:disabled) {
    transform: scale(0.98);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* A game fills the screen like the real game: status line, table, then your hand. Nothing scrolls
     except the side column. */
  :global(html.playing),
  :global(html.playing body) {
    overflow: hidden;
    /* No pull-to-refresh or swipe-back bounce while a game is on. */
    overscroll-behavior: none;
  }
  .game {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(300px, 24vw, 380px);
    gap: 12px;
    height: 100dvh;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
    background-color: var(--paper);
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
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
    border-radius: var(--radius-lg);
    background: #000000b3;
  }
  .choice-layer :global(.choice) {
    width: min(780px, 100%);
    max-height: 100%;
    overflow-y: auto;
  }
  /* Looking through a pile (the whole deck for a search) takes the table. */
  .choice-layer :global(.choice.zone) {
    width: min(1060px, 100%);
  }
  /* The bot's last turn in a few lines, top left over its side; it leaves with your first move. */
  /* The card picked up from the hand: its text over the opponent's side (top right), no taller than that half, so
     your Pokémon, where it is played, stay free to tap. Wide enough that the longest card text fits. */
  .detail-layer {
    position: absolute;
    right: 10px;
    top: 10px;
    z-index: 5;
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    width: min(720px, calc(100% - 20px));
    pointer-events: none;
  }
  /* From 10px under the top of the table down to its middle line at most. */
  .detail-layer > :global(*) {
    max-height: calc(50cqh - 10px);
    pointer-events: auto;
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--ink-soft);
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .link:hover:not(:disabled) {
    background: none;
    color: var(--ink-strong);
  }
  /* The command bar: one height whatever it says, so the table above keeps its size from turn to turn. What is
     going on at the left (two lines at most), the buttons at the right. */
  .cmd {
    --cmd-h: 56px;
    flex: 0 0 var(--cmd-h);
    height: var(--cmd-h);
    min-width: 0;
  }
  .cmd > :global(*) {
    height: 100%;
  }
  /* The once-a-turn plays: free ones outlined, used ones ticked and filled, a barred one struck through. */
  /* A question before something that can't be taken back (ending the turn with an attack left, leaving the game). */
  /* Ending the turn: the one big button, as on a game screen. */
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
    padding: 4px 8px;
    border-radius: var(--radius);
    background: #000000e6;
    color: #fff;
    font-size: 12px;
    line-height: 16px;
    white-space: nowrap;
  }
  .drag-ghost.touch .ghost-label {
    transform: translate(-50%, 18px);
  }
  .drag-ghost.ok .ghost-label {
    background: var(--accent);
    color: var(--accent-ink);
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
    border: 1px solid color-mix(in srgb, var(--stamp) 45%, transparent);
    border-radius: var(--radius);
    background: var(--card-bg);
    color: var(--stamp);
    font-size: 14px;
    line-height: 20px;
    box-shadow: var(--shadow-lg);
  }
  /* The card text panel above the log (computers); the log alone in a drawer (phones). */
  .side {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow: hidden;
  }
  .side-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--ink-strong);
    font-size: 16px;
    line-height: 24px;
  }
  /* A game left unfinished, offered at the top of the match sheet. */
  .unfinished {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 16px;
    align-items: center;
    justify-content: space-between;
    margin: 0;
    padding: 16px 32px;
    border-bottom: 1px solid var(--rule);
    background: color-mix(in srgb, var(--accent) 8%, var(--card-bg));
  }
  .unfinished div {
    display: flex;
    flex-direction: column;
  }
  .unfinished strong {
    color: var(--ink-strong);
    font-weight: 600;
  }
  .unfinished span {
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
  }
  .unfinished .acts {
    display: flex;
    gap: 8px;
  }
  /* The game menu (a sheet). */
  .menu {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .menu-acts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .switches {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 4px 0;
  }
  .menu-links {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .menu-links a {
    padding: 6px 0;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
    text-decoration: none;
    transition: color 0.3s var(--ease);
  }
  .menu-links a:hover {
    color: var(--ink-strong);
  }
  .menu-note {
    margin: 0;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
  }
  .recap-list {
    margin: 0;
    padding-left: 20px;
    font-size: 14px;
    line-height: 24px;
  }
  .side-backdrop {
    position: fixed;
    inset: 0;
    z-index: 35;
    background: #00000099;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 16px;
    background: #000000b3;
  }
  .discard {
    width: min(860px, 100%);
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 24px;
    border: 1px solid var(--line);
    background: var(--card-bg);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg);
  }
  .discard h3 {
    margin: 0 0 16px;
    font-size: 20px;
    line-height: 28px;
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
      box-shadow: -12px 0 30px -12px #0004;
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
    .detail-layer {
      left: 6px;
      right: 6px;
      top: 6px;
      width: auto;
    }
    .detail-layer > :global(*) {
      max-height: calc(50cqh - 6px);
    }
  }
  /* Touch screens: everything pressed with a finger is at least 44px (cards and log lines aside). */
  @media (pointer: coarse) {
    button {
      min-height: 44px;
    }
  }
  /* A phone on its side (or a very short window): the table can't fit, so ask for the other way round. */
  .rotate {
    display: none;
  }
  @media (orientation: landscape) and (max-height: 479px) {
    .rotate {
      position: fixed;
      inset: 0;
      z-index: 70;
      display: grid;
      place-content: center;
      gap: 8px;
      padding: 24px;
      background: var(--paper);
      color: var(--ink-soft);
      text-align: center;
      font-size: 14px;
      line-height: 20px;
    }
    .rotate strong {
      color: var(--ink-strong);
      font-size: 20px;
      line-height: 28px;
      font-weight: 600;
    }
    .rotate svg {
      justify-self: center;
      width: 48px;
      height: 48px;
      fill: none;
      stroke: var(--ink-strong);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }
</style>
