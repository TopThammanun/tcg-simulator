<script lang="ts">
  // Your hand, held like in the game: every card shows, overlapping in a slight fan when there are many
  // (no scrolling). Cards that can't be played right now are dimmed (PLAN.md: ตาม legalActions).
  // Tap a card to select it, or drag it onto the board.
  import { def } from '../../engine/db';
  import { keyOf } from '../../engine/state';
  import type { CardId, GameState } from '../../engine/types';
  import CardFace from './CardFace.svelte';

  let {
    s,
    playable,
    selected,
    marked = new Set(),
    lifted = null,
    onpick,
    onzoom,
    onpress,
  }: {
    s: GameState;
    playable: Set<CardId>;
    selected: CardId | null;
    /** Basics already put on the Bench during setup: they leave the hand until confirmed or taken back. */
    marked?: Set<CardId>;
    /** The card being dragged (shown as a gap in the hand). */
    lifted?: CardId | null;
    onpick: (c: CardId) => void;
    onzoom: (key: string) => void;
    onpress?: (c: CardId, e: PointerEvent) => void;
  } = $props();

  const hand = $derived(s.players[0].hand);
  /** Fan: a small turn and drop towards the ends of the hand. */
  const fan = (i: number, n: number) => {
    const mid = (n - 1) / 2;
    const d = i - mid;
    return { rot: `${(d * Math.min(2, 14 / Math.max(n, 1))).toFixed(2)}deg`, dy: `${((d / Math.max(mid, 1)) ** 2 * 6).toFixed(1)}px` };
  };
</script>

<div class="hand" data-zone="hand-0" aria-label="การ์ดในมือ">
  {#each hand as c, i (c)}
    {@const k = keyOf(s, c)}
    {@const f = fan(i, hand.length)}
    <button
      type="button"
      class="hcard"
      data-card={c}
      style:--rot={f.rot}
      style:--dy={f.dy}
      class:sel={selected === c}
      class:marked={marked.has(c)}
      class:lifted={lifted === c}
      class:grab={playable.has(c)}
      aria-label={playable.has(c) ? def(k).name : `${def(k).name} (ใช้ตอนนี้ไม่ได้)`}
      onclick={() => onpick(c)}
      onpointerdown={(e) => onpress?.(c, e)}
      oncontextmenu={(e) => {
        e.preventDefault();
        onzoom(k);
      }}
    >
      <span class="cardbox"><CardFace cardKey={k} dim={!playable.has(c)} /></span>
    </button>
  {/each}
  {#if hand.length === 0}<span class="none">ไม่มีการ์ดในมือ</span>{/if}
</div>

<style>
  /* Each card's box shrinks when the hand is wider than the screen, while the card picture keeps its
     size: the cards overlap and the last one shows whole. */
  .hand {
    --w: var(--hand-w, clamp(64px, calc(12vh - 8px), 104px));
    display: flex;
    justify-content: center;
    min-height: calc(var(--w) * 1.4 + 34px);
    padding: 16px 22px 18px;
  }
  .hcard {
    position: relative;
    flex: 0 1 calc(var(--w) + 8px);
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    transform: translateY(calc(var(--dy, 0px) + var(--lift, 0px))) rotate(var(--rot, 0deg));
    transform-origin: 50% 140%;
    transition:
      transform 0.14s ease,
      opacity 0.12s ease;
    touch-action: none;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .hcard:last-child {
    flex: 0 0 var(--w);
  }
  .cardbox {
    position: relative;
    display: block;
    width: var(--w);
    border-radius: 6% / 4.3%;
  }
  .cardbox :global(.face) {
    box-shadow: 0 3px 8px -2px #0008;
  }
  .hcard.grab {
    cursor: grab;
  }
  .hcard.grab .cardbox :global(.face) {
    box-shadow:
      0 0 0 2px #f2c94caa,
      0 0 12px #f2c94c55,
      0 3px 8px -2px #0008;
  }
  /* A light sweeps across playable cards now and then. */
  .hcard.grab .cardbox::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(115deg, transparent 38%, #ffffff70 50%, transparent 62%) no-repeat;
    background-size: 260% 100%;
    background-position: 130% 0;
    pointer-events: none;
    animation: sheen 3.6s ease-in-out infinite;
  }
  .hcard.grab:nth-child(2n) .cardbox::after {
    animation-delay: 0.5s;
  }
  .hcard.grab:nth-child(3n) .cardbox::after {
    animation-delay: 1.1s;
  }
  @keyframes sheen {
    0%,
    62% {
      background-position: 130% 0;
    }
    100% {
      background-position: -30% 0;
    }
  }
  @media (hover: hover) {
    .hcard:hover {
      z-index: 3;
      --lift: -16px;
    }
  }
  .hcard[aria-disabled='true'] {
    cursor: default;
  }
  .hcard.sel {
    z-index: 3;
    --lift: -18px;
  }
  .hcard.sel .cardbox {
    outline: 3px solid #f2c94c;
    outline-offset: 2px;
  }
  .hcard.marked {
    display: none;
  }
  .hcard.lifted {
    opacity: 0.25;
    --lift: 0px;
  }
  .none {
    color: var(--ink-soft);
    font-size: 0.85rem;
    align-self: center;
  }
  @media (max-width: 700px) {
    .hand {
      --hand-w: min(66px, 17vw);
      padding-top: 12px;
    }
  }
</style>
