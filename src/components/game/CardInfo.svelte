<script lang="ts">
  // Card detail: high-res image plus the English card text (PLAN.md: ดูการ์ด). A Pokémon in play also shows its
  // state (ui/slot-info.ts): HP left, Energy and Tool, conditions and what they do, effects on it, the cards under it.
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { def } from '../../engine/db';
  import { motion } from '../../ui/anim/motion';
  import type { SlotInfo } from '../../ui/slot-info';
  import CardFace from './CardFace.svelte';
  import CardText from './CardText.svelte';
  import SlotState from './SlotState.svelte';

  let { cardKey, info = null, onclose }: { cardKey: string; info?: SlotInfo | null; onclose: () => void } = $props();
  const d = $derived(def(cardKey));
</script>

<div
  class="backdrop"
  transition:fade={{ duration: motion(160) }}
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
>
  <div class="info" role="dialog" aria-label={d.name} in:scale={{ start: 0.85, duration: motion(220), easing: backOut }}>
    <button type="button" class="close" onclick={onclose} aria-label="ปิด">×</button>
    <div class="img"><CardFace {cardKey} size="high" /></div>
    <div class="text">
      {#if info}<SlotState {info} />{/if}
      <CardText {cardKey} />
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 16px;
    background: color-mix(in srgb, #15181d 60%, transparent);
  }
  .info {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 300px) 1fr;
    gap: 20px;
    width: min(820px, 100%);
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 20px;
    border: 1px solid var(--line);
    background: var(--card-bg);
    color: var(--ink);
    border-radius: var(--radius-xl);
  }
  .close {
    position: absolute;
    top: 6px;
    right: 8px;
    border: 0;
    background: none;
    color: var(--ink);
    font-size: 1.6rem;
    cursor: pointer;
  }
  .text {
    min-width: 0;
  }
  @media (max-width: 640px) {
    .info {
      grid-template-columns: 1fr;
    }
    .img {
      max-width: 240px;
      margin: 0 auto;
    }
  }
</style>
