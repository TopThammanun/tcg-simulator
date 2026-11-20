<script module lang="ts">
  export interface BoardDrag {
    /** Zones that accept the dragged card. */
    drops: Set<string>;
    over: string | null;
    /** What dropping on the board does (shown when `play` accepts it). */
    label: string;
  }
</script>

<script lang="ts">
  // The table, laid out like a playmat: each side has its Prize cards on the player's left, deck and
  // discard on the right, the Active Pokémon facing the other side and the Bench behind it. The bot sits
  // across the table (mirrored, its hand peeking in at the top); the Stadium sits between the Actives.
  // Drop zones for drag and drop: every Pokémon (`slot:<uid>`), your Active Spot and Bench, the board (`play`).
  import { benchLimit, stadiumKey } from '../../engine/rules';
  import { keyOf } from '../../engine/state';
  import type { CardId, GameState, PlayerId, Slot, SlotId } from '../../engine/types';
  import { def } from '../../engine/db';
  import CardBack from './CardBack.svelte';
  import CardFace from './CardFace.svelte';
  import SlotCard from './SlotCard.svelte';

  let {
    s,
    targets,
    picks,
    abilities,
    drag = null,
    grabbable = new Set(),
    ghostActive,
    ghostBench = [],
    onghost,
    ready = new Set(),
    pickable = null,
    pickedValues = new Set(),
    onpickcard,
    prizeGrid = null,
    prizePick = null,
    choosing = false,
    chosen = new Map(),
    onslot,
    onzoom,
    ondiscard,
    onpress,
    canUseStadium = false,
    onstadium,
  }: {
    s: GameState;
    targets: Set<SlotId>;
    picks: Map<SlotId, number>;
    abilities: Map<SlotId, string[]>;
    drag?: BoardDrag | null;
    /** Your Pokémon that can be dragged (to retreat). */
    grabbable?: Set<SlotId>;
    /** Setup: the Basic dropped on your Active Spot / Bench, not placed yet. */
    ghostActive?: string;
    ghostBench?: string[];
    /** Take a Basic placed during setup back to the hand. */
    onghost?: (i: number) => void;
    /** Your Pokémon with an attack or Ability to use now (tap them for the pop-up). */
    ready?: Set<SlotId>;
    /** Energy / Tools on the Pokémon that answer the choice now (card -> option), tapped on the table. */
    pickable?: Map<CardId, number> | null;
    /** The options marked so far (a pick of several). */
    pickedValues?: Set<number>;
    onpickcard?: (value: number) => void;
    /** Each player's Prize grid: the Prize pile's index at each spot, or null for a gap (default: filled in order). */
    prizeGrid?: [(number | null)[], (number | null)[]] | null;
    /** Your Prize cards are being picked: tap one (its pile index); the ones marked so far. */
    prizePick?: { picked: Set<number>; onpick: (index: number) => void } | null;
    /** A choice is made on the table now: the Pokémon that aren't options step back. */
    choosing?: boolean;
    /** Pokémon picked earlier for the card being played, with a word ("จาก"). */
    chosen?: Map<SlotId, string>;
    onslot: (uid: SlotId) => void;
    onzoom: (key: string) => void;
    ondiscard: (p: PlayerId) => void;
    onpress?: (uid: SlotId, e: PointerEvent) => void;
    canUseStadium?: boolean;
    onstadium?: () => void;
  } = $props();

  const PRIZES = 6;
  const stadium = $derived(stadiumKey(s));
  const accepts = (zone: string) => drag?.drops.has(zone) ?? false;
  const isOver = (zone: string) => drag?.over === zone;
  /** A thicker stack for a bigger deck. */
  const stackShadow = (n: number) => {
    const layers = Math.min(5, Math.ceil(n / 10));
    const edges = Array.from({ length: layers }, (_, i) => `${(i + 1) * 1.5}px ${(i + 1) * 1.5}px 0 ${i % 2 ? '#1b2338' : '#d8cfb8'}`);
    return [...edges, `${layers * 1.5 + 1}px ${layers * 1.5 + 3}px 6px #0009`].join(', ');
  };
</script>

{#snippet slotCard(p: PlayerId, sl: Slot, active: boolean)}
  <SlotCard
    {s}
    pokemon={sl}
    {active}
    target={targets.has(sl.uid) || accepts(`slot:${sl.uid}`)}
    over={isOver(`slot:${sl.uid}`)}
    grab={p === 0 && grabbable.has(sl.uid)}
    picked={picks.get(sl.uid) ?? 0}
    abilities={abilities.get(sl.uid) ?? []}
    ready={p === 0 && ready.has(sl.uid)}
    {pickable}
    {pickedValues}
    {onpickcard}
    dim={choosing && !targets.has(sl.uid)}
    chosen={chosen.get(sl.uid)}
    onclick={() => onslot(sl.uid)}
    onpress={(e) => onpress?.(sl.uid, e)}
    {onzoom}
  />
{/snippet}

{#snippet side(p: PlayerId)}
  {@const ps = s.players[p]}
  {@const mine = p === 0}
  {@const top = ps.discard[ps.discard.length - 1]}
  {@const ghosts = mine ? ghostBench : []}
  {@const open = Math.max(0, benchLimit(s, p) - ps.bench.length - ghosts.length)}
  <section class="side" class:mine class:theirs={!mine} aria-label={mine ? 'สนามของคุณ' : 'สนามของบอท'}>
    <div class="prizes" title="Prize ที่เหลือ">
      <div class="prize-grid" class:picking={mine && !!prizePick} data-zone={`prizes-${p}`}>
        {#each { length: PRIZES } as _, i}
          {@const at = prizeGrid ? prizeGrid[p][i] : i < ps.prizes.length ? i : null}
          {#if mine && prizePick && at !== null && at !== undefined}
            <button
              type="button"
              class="prize-slot pick"
              class:on={prizePick.picked.has(at)}
              aria-label={`เก็บ Prize ใบที่ ${i + 1}`}
              onclick={() => prizePick.onpick(at)}><CardBack /></button
            >
          {:else}
            <span class="prize-slot">{#if at !== null && at !== undefined}<CardBack />{/if}</span>
          {/if}
        {/each}
      </div>
      <span class="count"><span class="n mono">{ps.prizes.length}</span><span class="lbl">Prize</span></span>
    </div>

    <div class="piles">
      <div class="pile deck" title={`การ์ดในเด็ค ${ps.deck.length} ใบ`}>
        <span class="spot" data-zone={`deck-${p}`}>
          {#if ps.deck.length}<span class="stack" style:box-shadow={stackShadow(ps.deck.length)}><CardBack /></span>{/if}
          <span class="n mono">{ps.deck.length}</span>
        </span>
        <span class="lbl">เด็ค</span>
      </div>
      <button type="button" class="pile discard" onclick={() => ondiscard(p)} title={`ดูกองทิ้ง (${ps.discard.length} ใบ)`}>
        <span class="spot" data-zone={`discard-${p}`}>
          {#if top !== undefined}<CardFace cardKey={keyOf(s, top)} />{/if}
          <span class="n mono">{ps.discard.length}</span>
        </span>
        <span class="lbl">กองทิ้ง</span>
      </button>
    </div>

    <div
      class="active-spot"
      data-zone={`active-${p}`}
      data-drop={mine ? 'active' : undefined}
      class:accepts={mine && accepts('active') && !ps.active}
      class:over={mine && isOver('active') && !ps.active}
    >
      {#if ps.active}
        {@render slotCard(p, ps.active, true)}
      {:else if mine && ghostActive}
        <div class="ghost-card"><CardFace cardKey={ghostActive} /></div>
      {:else}
        <div class="empty">{mine && accepts('active') ? 'วางตัวหลักที่นี่' : 'ตัวหลัก'}</div>
      {/if}
    </div>

    <div class="bench" aria-label="Bench" data-zone={`bench-${p}`} data-drop={mine ? 'bench' : undefined} style:--n={benchLimit(s, p)}>
      {#each ps.bench as b (b.uid)}
        {@render slotCard(p, b, false)}
      {/each}
      {#each ghosts as k, i (i)}
        <button type="button" class="ghost-card" title="แตะเพื่อเอาคืน" onclick={() => onghost?.(i)}><CardFace cardKey={k} /></button>
      {/each}
      {#each { length: open } as _, i}
        {#if mine && i === 0 && accepts('bench')}
          <div class="bench-slot bench-drop" class:over={isOver('bench')}>+ Bench</div>
        {:else}
          <div class="bench-slot" aria-hidden="true"></div>
        {/if}
      {/each}
    </div>
  </section>
{/snippet}

<div
  class="board"
  data-zone="board"
  data-drop="play"
  class:play-ready={accepts('play')}
  class:play-over={isOver('play')}
  class:turn-mine={s.phase === 'main' && s.winner === null && s.current === 0}
  class:turn-theirs={s.phase === 'main' && s.winner === null && s.current === 1}
>
  <div class="their-half" aria-hidden="true"></div>
  <div class="midline" aria-hidden="true"><span class="emblem">◆</span></div>

  <div class="their-hand" data-zone="hand-1" title={`มือบอท ${s.players[1].hand.length} ใบ`}>
    <span class="fan">
      {#each { length: Math.min(12, s.players[1].hand.length) } as _, i}
        {@const n = Math.min(12, s.players[1].hand.length)}
        <span class="fan-card" style:--a={`${(i - (n - 1) / 2) * 5}deg`}><CardBack /></span>
      {/each}
    </span>
    <span class="hand-count">มือ <span class="mono">{s.players[1].hand.length}</span></span>
  </div>

  {@render side(1)}

  <div class="stadium-zone" data-zone="stadium">
    {#if stadium}
      <button
        type="button"
        class="stadium"
        data-card={s.stadium?.card}
        class:usable={canUseStadium}
        class:yours={s.stadium?.owner === 0}
        onclick={() => (canUseStadium ? onstadium?.() : onzoom(stadium))}
        oncontextmenu={(e) => {
          e.preventDefault();
          onzoom(stadium);
        }}
        title={canUseStadium ? 'ใช้ Academy at Night' : def(stadium).name}
      >
        <span class="stadium-card"><CardFace cardKey={stadium} /></span>
        <span class="stadium-name">{def(stadium).name}</span>
        <span class="owner">{s.stadium?.owner === 0 ? 'ของคุณ' : 'ของบอท'}</span>
      </button>
    {:else}
      <div class="stadium-empty">Stadium</div>
    {/if}
  </div>

  <div class="turn" aria-hidden="true">
    {#if s.phase === 'main' && s.winner === null}
      <span class="turn-no">เทิร์น {s.turn}</span>
      <span class="whose" class:you={s.current === 0}>{s.current === 0 ? 'ตาคุณ' : 'ตาบอท'}</span>
    {/if}
  </div>

  {@render side(0)}

  {#if accepts('play')}
    <div class="play-hint" aria-hidden="true">{isOver('play') ? `ปล่อยเพื่อ${drag?.label}` : 'ลากมาวางบนสนามเพื่อใช้'}</div>
  {/if}
</div>

<style>
  .board {
    --mat-ink: #e8efe9;
    --line: #ffffff26;
    --pad: 14px;
    --row-gap: 14px;
    /* Card sizes come from the space the table has (its container, .table in Game.svelte): the table
       always fits the screen. The height left over goes between the two Active Spots. */
    --active-w: clamp(56px, min(calc((100cqh - 108px) / 5.2), calc((100cqw - 100px) / 5.6)), 150px);
    --slot-w: calc(var(--active-w) * 0.72);
    --prize-w: calc(var(--active-w) * 0.37);
    --pile-w: calc(var(--active-w) * 0.57);
    --stadium-w: calc(var(--active-w) * 0.6);
    --fan-w: calc(var(--active-w) * 0.37);
    --side-col: max(84px, calc(var(--active-w) * 0.95));
    position: relative;
    display: grid;
    height: 100%;
    grid-template-columns: var(--side-col) minmax(0, 1fr) var(--active-w) minmax(0, 1fr) var(--side-col);
    grid-template-rows: auto auto auto minmax(0, 1fr) minmax(0, 1fr) auto auto;
    grid-template-areas:
      'ohand  ohand   ohand   ohand  ohand'
      'opile  obench  obench  obench oprize'
      'opile  stadium oactive turn   oprize'
      '.      stadium .       turn   .'
      '.      stadium .       turn   .'
      'mprize stadium mactive turn   mpile'
      'mprize mbench  mbench  mbench mpile';
    column-gap: 12px;
    row-gap: var(--row-gap);
    padding: 0 var(--pad) 20px;
    border-radius: 14px;
    background-color: #1c3a80;
    background-image:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .06 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),
      radial-gradient(120% 70% at 50% 50%, #2d5bb5 0%, #1c3a80 55%, #0f2150 100%);
    color: var(--mat-ink);
    box-shadow:
      inset 0 0 0 1px #ffffff14,
      inset 0 0 60px #0007,
      0 14px 30px -18px #000c;
    overflow: hidden;
    transition: box-shadow 0.15s ease;
  }
  .board.play-ready {
    box-shadow:
      inset 0 0 0 2px #f2c94c88,
      inset 0 0 60px #0007;
  }
  .board.play-over {
    box-shadow:
      inset 0 0 0 4px #f2c94c,
      inset 0 0 60px #f2c94c33;
  }
  /* Over the bot's hand at the top edge, clear of the cards. */
  .play-hint {
    position: absolute;
    left: 50%;
    top: 6px;
    transform: translateX(-50%);
    padding: 6px 14px;
    border-radius: 999px;
    background: #1a150cdd;
    color: #f2c94c;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.9rem;
    white-space: nowrap;
    pointer-events: none;
    z-index: 5;
  }

  /* The bot's half of the mat is a shade darker; a line and a mark divide the table. */
  .their-half {
    grid-row: 1 / 5;
    grid-column: 1 / -1;
    margin: 0 calc(-1 * var(--pad)) calc(-1 * var(--row-gap) / 2);
    background: linear-gradient(#0000002e, #00000014);
    pointer-events: none;
  }
  .midline {
    grid-row: 4 / 6;
    grid-column: 1 / -1;
    align-self: center;
    position: relative;
    margin: 0 calc(-1 * var(--pad));
    border-top: 1px solid var(--line);
    pointer-events: none;
  }
  /* The side whose turn it is: a band of light along its half of the centre line. */
  .midline::before {
    content: '';
    position: absolute;
    left: 6%;
    right: 6%;
    top: -2px;
    height: 3px;
    border-radius: 3px;
    background: linear-gradient(90deg, transparent, var(--glow, #f2c94c), transparent);
    box-shadow: 0 0 14px 2px var(--glow, #f2c94c);
    opacity: 0;
    transition:
      opacity 0.4s ease,
      transform 0.4s ease;
  }
  .board.turn-mine .midline::before {
    opacity: 0.9;
    transform: translateY(calc(var(--row-gap) * 0.6));
  }
  .board.turn-theirs .midline::before {
    --glow: #e2574b;
    opacity: 0.7;
    transform: translateY(calc(var(--row-gap) * -0.6));
  }
  .emblem {
    position: absolute;
    left: 50%;
    top: 0;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    transform: translate(-50%, -50%);
    border: 1px solid #ffffff40;
    border-radius: 50%;
    background: #1f3f88;
    color: #e2574b;
    font-size: 10px;
  }

  .side {
    display: contents;
  }
  .theirs .prizes {
    grid-area: oprize;
    flex-direction: column-reverse;
  }
  .mine .prizes {
    grid-area: mprize;
  }
  .theirs .piles {
    grid-area: opile;
    flex-direction: column-reverse;
  }
  .mine .piles {
    grid-area: mpile;
  }
  .theirs .active-spot {
    grid-area: oactive;
  }
  .mine .active-spot {
    grid-area: mactive;
  }
  .theirs .bench {
    grid-area: obench;
  }
  .mine .bench {
    grid-area: mbench;
  }

  /* Prize cards: six face-down cards in two columns; a taken Prize leaves its outline. */
  .prizes {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .prize-grid {
    display: grid;
    grid-template-columns: repeat(2, var(--prize-w));
    gap: 5px;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .prize-slot {
    width: var(--prize-w);
    aspect-ratio: 63 / 88;
    border-radius: 4px;
    outline: 1px dashed #ffffff2a;
    outline-offset: -1px;
  }
  /* Taking Prize cards: each face-down card is a button; the marked ones lift. */
  .prize-grid.picking {
    position: relative;
    z-index: 4;
  }
  .prize-slot.pick {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    animation: prize-pick 1.2s ease-in-out infinite;
    transition: transform 0.12s ease;
  }
  .prize-slot.pick:hover,
  .prize-slot.pick:focus-visible {
    transform: scale(1.08);
  }
  .prize-slot.pick.on {
    transform: translateY(-5px) scale(1.08);
    outline: 3px solid var(--stamp);
    animation: none;
  }
  @keyframes prize-pick {
    0%,
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
    50% {
      box-shadow: 0 0 12px 2px color-mix(in srgb, var(--accent) 70%, transparent);
    }
  }
  .count {
    display: flex;
    gap: 5px;
    align-items: baseline;
    padding: 0 10px;
    border-radius: 999px;
    background: #0005;
    font-size: 0.72rem;
  }
  .count .n {
    color: #f2c94c;
    font-size: 0.95rem;
    font-weight: 700;
  }

  /* Deck (a stack of backs) and discard (its top card face up). */
  .piles {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .pile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--mat-ink);
    font: inherit;
  }
  .pile.discard {
    cursor: pointer;
  }
  .pile.discard:hover .spot {
    transform: translateY(-2px);
  }
  .spot {
    position: relative;
    display: block;
    width: var(--pile-w);
    aspect-ratio: 63 / 88;
    border-radius: 6% / 4.3%;
    outline: 1px dashed #ffffff38;
    outline-offset: 2px;
    transition: transform 0.12s ease;
  }
  .stack {
    display: block;
    border-radius: 6% / 4.3%;
  }
  .spot .n {
    position: absolute;
    left: 50%;
    bottom: 6px;
    transform: translateX(-50%);
    min-width: 26px;
    padding: 0 6px;
    border-radius: 999px;
    background: #000c;
    color: #fff;
    font-size: 0.78rem;
    font-weight: 600;
    text-align: center;
  }
  .lbl {
    font-size: 0.66rem;
    letter-spacing: 0.04em;
    opacity: 0.75;
  }

  /* Active Spot and Bench, with the outlines printed on the mat. */
  .active-spot {
    position: relative;
    width: var(--active-w);
    border-radius: 10px;
  }
  .active-spot::before {
    content: '';
    position: absolute;
    inset: -6px;
    border: 1.5px solid var(--line);
    border-radius: 12px;
    pointer-events: none;
  }
  .theirs .active-spot {
    align-self: end;
  }
  .mine .active-spot {
    align-self: start;
  }
  .empty {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 63 / 88;
    padding: 4px;
    border-radius: 8px;
    font-size: 0.75rem;
    text-align: center;
    opacity: 0.55;
  }
  .active-spot.accepts .empty {
    outline: 2px dashed #f2c94c;
    color: #f2c94c;
    opacity: 1;
  }
  .active-spot.over .empty {
    background: #f2c94c33;
  }
  .bench {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, var(--slot-w)));
    justify-content: center;
    align-items: start;
    gap: 10px;
    border-radius: 8px;
  }
  .bench-slot {
    display: grid;
    place-items: center;
    aspect-ratio: 63 / 88;
    border: 1.5px dashed #ffffff26;
    border-radius: 8px;
  }
  .bench-drop {
    border: 2px dashed #f2c94c;
    color: #f2c94c;
    font-size: 0.75rem;
    font-weight: 600;
    transition:
      background 0.12s ease,
      transform 0.12s ease;
  }
  .bench-drop.over {
    background: #f2c94c33;
    transform: scale(1.06);
  }
  .ghost-card {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    opacity: 0.85;
    outline: 2px dashed #f2c94c;
    outline-offset: 2px;
    border-radius: 7px;
    cursor: pointer;
    animation: ghost-in 0.22s ease-out;
  }
  .ghost-card:hover {
    opacity: 0.6;
  }
  @keyframes ghost-in {
    from {
      transform: translateY(14px) scale(1.08);
      opacity: 0;
    }
  }

  /* The bot's hand peeks in from the top edge of the mat. */
  .their-hand {
    grid-area: ohand;
    justify-self: center;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    height: calc(var(--fan-w) * 0.95);
    overflow: hidden;
  }
  .fan {
    display: flex;
    padding: 0 6px;
  }
  .fan-card {
    width: var(--fan-w);
    margin-left: calc(var(--fan-w) * -0.55);
    transform: translateY(-42%) rotate(calc(-1 * var(--a)));
    transform-origin: 50% 0;
    filter: drop-shadow(0 2px 3px #0008);
  }
  .fan-card:first-child {
    margin-left: 0;
  }
  .hand-count {
    align-self: center;
    font-size: 0.7rem;
    opacity: 0.75;
  }

  .stadium-zone {
    grid-area: stadium;
    align-self: center;
    justify-self: center;
    position: relative;
    z-index: 1;
  }
  .stadium {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    max-width: 130px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--mat-ink);
    font: inherit;
    cursor: pointer;
  }
  .stadium-card {
    width: var(--stadium-w);
    border-radius: 6px;
    box-shadow: 0 0 0 2px #e2574b;
  }
  .stadium.yours .stadium-card {
    box-shadow: 0 0 0 2px #4fb3aa;
  }
  .stadium.usable .stadium-card {
    outline: 3px solid #f2c94c;
    outline-offset: 3px;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      outline-color: transparent;
    }
  }
  .stadium-name {
    font-size: 0.68rem;
    line-height: 1.2;
    text-align: center;
  }
  .owner {
    font-size: 0.6rem;
    opacity: 0.7;
  }
  .stadium-empty {
    display: grid;
    place-items: center;
    width: var(--stadium-w);
    aspect-ratio: 63 / 88;
    border: 1.5px dashed #ffffff22;
    border-radius: 6px;
    font-size: 0.62rem;
    opacity: 0.5;
  }

  .turn {
    grid-area: turn;
    align-self: center;
    justify-self: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    position: relative;
    z-index: 1;
    text-align: center;
  }
  .turn-no {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    opacity: 0.75;
  }
  .whose {
    padding: 4px 14px;
    border: 1px solid #ffffff30;
    border-radius: 999px;
    background: #0005;
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .whose.you {
    border-color: #f2c94c;
    background: #f2c94c;
    color: #1a150c;
    box-shadow: 0 0 0 4px #f2c94c33;
  }
  .mono {
    font-family: var(--font-mono);
  }

  @media (max-width: 700px) {
    /* Phones: the Bench takes the full width; Prizes and piles sit beside the Active. */
    .board {
      --pad: 8px;
      --row-gap: 10px;
      --active-w: clamp(44px, min(calc((100cqh - 100px) / 4.9), calc((100cqw - 40px) / 3.7)), 86px);
      --slot-w: calc(var(--active-w) * 0.74);
      --prize-w: calc(var(--active-w) * 0.23);
      --pile-w: calc(var(--active-w) * 0.44);
      --side-col: max(40px, calc(var(--active-w) * 0.56));
      --stadium-w: calc(var(--active-w) * 0.6);
      --fan-w: 24px;
      grid-template-areas:
        'ohand  ohand   ohand   ohand  ohand'
        'obench obench  obench  obench obench'
        'opile  stadium oactive turn   oprize'
        '.      stadium .       turn   .'
        '.      stadium .       turn   .'
        'mprize stadium mactive turn   mpile'
        'mbench mbench  mbench  mbench mbench';
      column-gap: 6px;
      padding-bottom: 14px;
      border-radius: 10px;
    }
    .bench {
      gap: 6px;
    }
    .prizes {
      gap: 3px;
    }
    .prize-grid {
      gap: 3px;
      padding: 3px;
      border-radius: 5px;
    }
    .prize-slot {
      border-radius: 2px;
    }
    .count {
      padding: 0 6px;
    }
    .count .lbl {
      display: none;
    }
    .count .n {
      font-size: 0.8rem;
    }
    .piles {
      gap: 6px;
    }
    .pile .lbl {
      display: none;
    }
    .spot .n {
      bottom: 3px;
      min-width: 0;
      padding: 0 4px;
      font-size: 0.62rem;
    }
    .active-spot::before {
      inset: -4px;
      border-radius: 9px;
    }
    .empty {
      font-size: 0.65rem;
    }
    .stadium {
      max-width: 80px;
    }
    .stadium-name {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      font-size: 0.56rem;
    }
    .owner {
      font-size: 0.54rem;
    }
    .turn-no {
      font-size: 0.62rem;
    }
    .whose {
      padding: 3px 8px;
      font-size: 0.72rem;
    }
    .hand-count {
      font-size: 0.62rem;
    }
  }
</style>
