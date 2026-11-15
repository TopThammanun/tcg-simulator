<script lang="ts">
  // Your hand. Cards that can't be played right now are dimmed (PLAN.md: ตาม legalActions).
  // Tap a card to select it, or drag it onto the board; on touch, swipe sideways to scroll the hand.
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
    /** Cards already picked for a pending choice (setup Bench). */
    marked?: Set<CardId>;
    /** The card being dragged (shown as a gap in the hand). */
    lifted?: CardId | null;
    onpick: (c: CardId) => void;
    onzoom: (key: string) => void;
    onpress?: (c: CardId, e: PointerEvent) => void;
  } = $props();

  const hand = $derived(s.players[0].hand);
</script>

<div class="hand" data-zone="hand-0" aria-label="การ์ดในมือ">
  {#each hand as c (c)}
    {@const k = keyOf(s, c)}
    <button
      type="button"
      class="hcard"
      data-card={c}
      class:sel={selected === c}
      class:marked={marked.has(c)}
      class:lifted={lifted === c}
      class:grab={playable.has(c)}
      aria-disabled={!playable.has(c)}
      onclick={() => onpick(c)}
      onpointerdown={(e) => onpress?.(c, e)}
      oncontextmenu={(e) => {
        e.preventDefault();
        onzoom(k);
      }}
    >
      <CardFace cardKey={k} dim={!playable.has(c)} />
      {#if marked.has(c)}<span class="tick">✓</span>{/if}
    </button>
  {/each}
  {#if hand.length === 0}<span class="none">ไม่มีการ์ดในมือ</span>{/if}
</div>

<style>
  .hand {
    display: flex;
    gap: 8px;
    padding: 12px 4px 4px;
    overflow-x: auto;
    min-height: 120px;
    scrollbar-width: thin;
  }
  .hcard {
    position: relative;
    flex: 0 0 auto;
    width: var(--hand-w, clamp(72px, calc(11vh - 4px), 96px));
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: 7px;
    transition:
      transform 0.12s ease,
      opacity 0.12s ease;
    /* Sideways swipes scroll the hand; vertical moves are drags. */
    touch-action: pan-x;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .hcard.grab {
    cursor: grab;
  }
  .hcard.grab :global(.face) {
    box-shadow:
      0 0 0 2px #f2c94caa,
      0 0 12px #f2c94c55,
      0 1px 3px #0005;
  }
  .hcard.grab::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 6% / 4.3%;
    background: linear-gradient(115deg, transparent 38%, #ffffff70 50%, transparent 62%) no-repeat;
    background-size: 260% 100%;
    background-position: 130% 0;
    pointer-events: none;
    animation: sheen 3.6s ease-in-out infinite;
  }
  .hcard.grab:nth-child(2n)::after {
    animation-delay: 0.5s;
  }
  .hcard.grab:nth-child(3n)::after {
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
  .hcard.grab:hover {
    transform: translateY(-6px);
  }
  .hcard[aria-disabled='true'] {
    cursor: default;
  }
  .hcard.sel {
    transform: translateY(-10px);
    outline: 3px solid #f2c94c;
    outline-offset: 2px;
  }
  .hcard.marked {
    transform: translateY(-8px);
    outline: 3px solid var(--stamp);
    outline-offset: 2px;
  }
  .hcard.lifted {
    opacity: 0.25;
    transform: none;
  }
  .tick {
    position: absolute;
    top: 4px;
    left: 4px;
    padding: 0 6px;
    background: var(--stamp);
    color: #fff;
    border-radius: 4px;
    font-size: 0.8rem;
  }
  .none {
    color: var(--ink-soft);
    font-size: 0.85rem;
    align-self: center;
  }
  @media (max-width: 700px) {
    .hand {
      --hand-w: 62px;
      gap: 6px;
      min-height: 96px;
      padding-top: 10px;
    }
    .hcard.grab:hover {
      transform: none;
    }
  }
</style>
