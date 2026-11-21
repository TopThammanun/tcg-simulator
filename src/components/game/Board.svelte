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
  import { tx } from '../../i18n';
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
    choosing = false,
    chosen = new Map(),
    onslot,
    onzoom,
    onzoomslot,
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
    /** A choice is made on the table now: the Pokémon that aren't options step back. */
    choosing?: boolean;
    /** Pokémon picked earlier for the card being played, with a word ("จาก"). */
    chosen?: Map<SlotId, string>;
    onslot: (uid: SlotId) => void;
    onzoom: (key: string) => void;
    /** A Pokémon in play zoomed (right click / long press): the card and its state. */
    onzoomslot?: (uid: SlotId, key: string) => void;
    ondiscard: (p: PlayerId) => void;
    onpress?: (uid: SlotId, e: PointerEvent) => void;
    canUseStadium?: boolean;
    onstadium?: () => void;
  } = $props();

  const PRIZES = 6;
  /** Few enough cards left that decking out is near (no draw at the start of a turn loses the game). */
  const LOW_DECK = 5;
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
    onzoom={(k) => (onzoomslot ? onzoomslot(sl.uid, k) : onzoom(k))}
  />
{/snippet}

{#snippet side(p: PlayerId)}
  {@const ps = s.players[p]}
  {@const mine = p === 0}
  {@const top = ps.discard[ps.discard.length - 1]}
  {@const ghosts = mine ? ghostBench : []}
  {@const open = Math.max(0, benchLimit(s, p) - ps.bench.length - ghosts.length)}
  <section class="side" class:mine class:theirs={!mine} aria-label={mine ? tx('สนามของคุณ', 'Your side') : tx('สนามของบอท', "The bot's side")}>
    <div class="prizes" title={tx('Prize ที่เหลือ', 'Prize cards left')}>
      <div class="prize-grid" data-zone={`prizes-${p}`}>
        {#each { length: PRIZES } as _, i}
          {@const at = prizeGrid ? prizeGrid[p][i] : i < ps.prizes.length ? i : null}
          <span class="prize-slot">{#if at !== null && at !== undefined}<CardBack />{/if}</span>
        {/each}
      </div>
      <span class="count"><span class="n mono">{ps.prizes.length}</span><span class="lbl">Prize</span></span>
    </div>

    <div class="piles">
      <div
        class="pile deck"
        class:low={ps.deck.length <= LOW_DECK}
        title={tx(`การ์ดในเด็ค ${ps.deck.length} ใบ`, `${ps.deck.length} cards in the deck`) +
          (ps.deck.length <= LOW_DECK ? tx(' · ใกล้หมด: จั่วไม่ได้ตอนต้นเทิร์นเมื่อไหร่ แพ้ทันที', ' · running out: no card to draw at the start of a turn loses the game') : '')}
      >
        <span class="spot" data-zone={`deck-${p}`}>
          {#if ps.deck.length}<span class="stack" style:box-shadow={stackShadow(ps.deck.length)}><CardBack /></span>{/if}
          <span class="n mono">{ps.deck.length}</span>
        </span>
        <span class="lbl">{tx('เด็ค', 'Deck')}</span>
      </div>
      <button
        type="button"
        class="pile discard"
        data-inspect={top !== undefined ? keyOf(s, top) : undefined}
        onclick={() => ondiscard(p)}
        title={tx(`ดูกองทิ้ง (${ps.discard.length} ใบ)`, `Discard pile (${ps.discard.length})`)}
      >
        <span class="spot" data-zone={`discard-${p}`}>
          {#if top !== undefined}<CardFace cardKey={keyOf(s, top)} />{/if}
          <span class="n mono">{ps.discard.length}</span>
        </span>
        <span class="lbl">{tx('กองทิ้ง', 'Discard')}</span>
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
        <div class="empty">{mine && accepts('active') ? tx('วางตัวหลักที่นี่', 'Active Pokémon here') : tx('ตัวหลัก', 'Active')}</div>
      {/if}
    </div>

    <div class="bench" aria-label="Bench" data-zone={`bench-${p}`} data-drop={mine ? 'bench' : undefined} style:--n={benchLimit(s, p)}>
      {#each ps.bench as b (b.uid)}
        {@render slotCard(p, b, false)}
      {/each}
      {#each ghosts as k, i (i)}
        <button type="button" class="ghost-card" title={tx('แตะเพื่อเอาคืน', 'Tap to take it back')} onclick={() => onghost?.(i)}><CardFace cardKey={k} /></button>
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

  <div class="their-hand" data-zone="hand-1" title={tx(`มือบอท ${s.players[1].hand.length} ใบ`, `Bot's hand: ${s.players[1].hand.length} cards`)}>
    <span class="fan">
      {#each { length: Math.min(12, s.players[1].hand.length) } as _, i}
        {@const n = Math.min(12, s.players[1].hand.length)}
        <span class="fan-card" style:--a={`${(i - (n - 1) / 2) * 5}deg`}><CardBack /></span>
      {/each}
    </span>
    <span class="hand-count">{tx('มือ', 'Hand')} <span class="mono">{s.players[1].hand.length}</span></span>
  </div>

  {@render side(1)}

  <div class="stadium-zone" data-zone="stadium">
    {#if stadium}
      <button
        type="button"
        class="stadium"
        data-card={s.stadium?.card}
        data-inspect={stadium}
        class:usable={canUseStadium}
        class:yours={s.stadium?.owner === 0}
        onclick={() => (canUseStadium ? onstadium?.() : onzoom(stadium))}
        oncontextmenu={(e) => {
          e.preventDefault();
          onzoom(stadium);
        }}
        title={canUseStadium ? tx('ใช้ Academy at Night', 'Use Academy at Night') : def(stadium).name}
      >
        <span class="stadium-card"><CardFace cardKey={stadium} /></span>
        <span class="stadium-name">{def(stadium).name}</span>
        <span class="owner">{s.stadium?.owner === 0 ? tx('ของคุณ', 'yours') : tx('ของบอท', "bot's")}</span>
      </button>
    {:else}
      <div class="stadium-empty">Stadium</div>
    {/if}
  </div>

  <div class="turn" aria-hidden="true">
    {#if s.phase === 'main' && s.winner === null}
      <span class="whose" class:you={s.current === 0}>{s.current === 0 ? tx('ตาคุณ', 'Your turn') : tx('ตาบอท', "Bot's turn")}</span>
    {/if}
  </div>

  {@render side(0)}

  {#if accepts('play')}
    <div class="play-hint" aria-hidden="true">{isOver('play') ? tx(`ปล่อยเพื่อ${drag?.label}`, `Drop to play: ${drag?.label}`) : tx('ลากมาวางบนสนามเพื่อใช้', 'Drag onto the table to play')}</div>
  {/if}
</div>

<style>
  /* The deck nearly empty: its count turns red and pulses. */
  .pile.deck.low .n {
    background: var(--stamp);
    color: #fff;
    animation: low-deck 1.4s ease-in-out infinite;
  }
  @keyframes low-deck {
    50% {
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--stamp) 45%, transparent);
    }
  }
  .board {
    --mat-ink: var(--ink);
    --line: #ffffff1f;
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
    border-radius: var(--radius-lg);
    background: var(--card-bg);
    color: var(--mat-ink);
    box-shadow: inset 0 0 0 1px var(--rule);
    overflow: hidden;
    transition: box-shadow 0.3s var(--ease);
  }
  .board.play-ready {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .board.play-over {
    box-shadow: inset 0 0 0 3px var(--accent);
  }
  /* Over the bot's hand at the top edge, clear of the cards. */
  .play-hint {
    position: absolute;
    left: 50%;
    top: 6px;
    transform: translateX(-50%);
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--paper) 87%, transparent);
    color: var(--accent);
    font-weight: 600;
    font-size: 14px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 5;
  }

  /* The bot's half of the mat is a shade darker; a line and a mark divide the table. */
  .their-half {
    grid-row: 1 / 5;
    grid-column: 1 / -1;
    margin: 0 calc(-1 * var(--pad)) calc(-1 * var(--row-gap) / 2);
    background: #0000002e;
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
    height: 2px;
    background: var(--glow, var(--accent));
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
    --glow: var(--stamp);
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
    background: var(--card-bg);
    color: var(--stamp);
    font-size: var(--fs-card);
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
    border-radius: var(--radius);
  }
  .prize-slot {
    width: var(--prize-w);
    aspect-ratio: 63 / 88;
    border-radius: var(--radius-sm);
    outline: 1px dashed #ffffff2a;
    outline-offset: -1px;
  }
  .count {
    display: flex;
    gap: 5px;
    align-items: baseline;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    background: #0005;
    font-size: 12px;
  }
  .count .n {
    color: var(--accent);
    font-size: 16px;
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
    border-radius: var(--radius-sm);
    background: #000c;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    text-align: center;
  }
  .lbl {
    font-size: var(--fs-card);
    letter-spacing: 0.04em;
    opacity: 0.75;
  }

  /* Active Spot and Bench, with the outlines printed on the mat. */
  .active-spot {
    position: relative;
    width: var(--active-w);
    border-radius: var(--radius-lg);
  }
  .active-spot::before {
    content: '';
    position: absolute;
    inset: -6px;
    border: 1.5px solid var(--line);
    border-radius: var(--radius-lg);
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
    border-radius: var(--radius);
    font-size: 12px;
    text-align: center;
    opacity: 0.55;
  }
  .active-spot.accepts .empty {
    outline: 2px dashed var(--accent);
    color: var(--accent);
    opacity: 1;
  }
  .active-spot.over .empty {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .bench {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, var(--slot-w)));
    justify-content: center;
    align-items: start;
    gap: 10px;
    border-radius: var(--radius);
  }
  .bench-slot {
    display: grid;
    place-items: center;
    aspect-ratio: 63 / 88;
    border: 1.5px dashed #ffffff26;
    border-radius: var(--radius);
  }
  .bench-drop {
    border: 2px dashed var(--accent);
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    transition:
      background 0.12s ease,
      transform 0.12s ease;
  }
  .bench-drop.over {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    transform: scale(1.06);
  }
  .ghost-card {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    opacity: 0.85;
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius);
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
    font-size: var(--fs-card);
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
    border-radius: var(--radius);
    box-shadow: 0 0 0 2px var(--theirs);
  }
  .stadium.yours .stadium-card {
    box-shadow: 0 0 0 2px var(--mine);
  }
  .stadium.usable .stadium-card {
    outline: 3px solid var(--accent);
    outline-offset: 3px;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      outline-color: transparent;
    }
  }
  .stadium-name {
    font-size: var(--fs-card);
    line-height: 1.2;
    text-align: center;
  }
  .owner {
    font-size: var(--fs-card);
    opacity: 0.7;
  }
  .stadium-empty {
    display: grid;
    place-items: center;
    width: var(--stadium-w);
    aspect-ratio: 63 / 88;
    border: 1.5px dashed #ffffff22;
    border-radius: var(--radius);
    font-size: var(--fs-card);
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
  .whose {
    padding: 4px 14px;
    border: 1px solid #ffffff30;
    border-radius: var(--radius-sm);
    background: #0005;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  .whose.you {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
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
      border-radius: var(--radius-lg);
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
      border-radius: var(--radius-sm);
    }
    .prize-slot {
      border-radius: var(--radius-sm);
    }
    .count {
      padding: 0 6px;
    }
    .count .lbl {
      display: none;
    }
    .count .n {
      font-size: 12px;
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
      font-size: var(--fs-card);
    }
    .active-spot::before {
      inset: -4px;
      border-radius: var(--radius);
    }
    .empty {
      font-size: var(--fs-card);
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
      font-size: var(--fs-card);
    }
    .owner {
      font-size: var(--fs-card);
    }
    .whose {
      padding: 3px 8px;
      font-size: 12px;
    }
    .hand-count {
      font-size: var(--fs-card);
    }
  }
</style>
