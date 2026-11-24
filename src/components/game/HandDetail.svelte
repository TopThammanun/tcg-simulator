<script lang="ts">
  // The card picked up from your hand, as at a real table: its text to read, whole (no scrolling box inside). What
  // you can do with it (play it, tap a Pokémon, or why it can't be played now) is said in the dock, by your hand.
  import { tx } from '../../i18n';
  import { fly } from 'svelte/transition';
  import { keyOf } from '../../engine/state';
  import type { CardId, GameState } from '../../engine/types';
  import { motion } from '../../ui/anim/motion';
  import CardFace from './CardFace.svelte';
  import CardText from './CardText.svelte';

  let {
    s,
    card,
    onclose,
    onzoom,
  }: {
    s: GameState;
    card: CardId;
    onclose: () => void;
    onzoom: (key: string) => void;
  } = $props();
  const k = $derived(keyOf(s, card));
</script>

<aside class="detail" aria-label={tx('การ์ดที่หยิบจากมือ', 'Picked up from your hand')} in:fly={{ y: 18, duration: motion(200) }}>
  <button type="button" class="img" onclick={() => onzoom(k)} title={tx('ดูใบใหญ่', 'See it large')}><CardFace cardKey={k} /></button>
  <div class="body"><CardText cardKey={k} compact /></div>
  <button type="button" class="close" onclick={onclose} aria-label={tx('ปิด', 'Close')} title={tx('ปิด (Esc)', 'Close (Esc)')}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
  </button>
</aside>

<style>
  /* The picture at the top left with the text flowing round it and then under it at full width: the longest card
     text fits in half the table without a scroll box. */
  .detail {
    position: relative;
    display: flow-root;
    width: 100%;
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px;
    border-radius: var(--radius-lg);
    background: var(--card-bg);
    color: var(--ink);
    box-shadow: 0 10px 30px #0003;
    border: 1px solid var(--line);
  }
  .img {
    float: left;
    width: 96px;
    margin: 0 12px 4px 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  /* Room for the close button beside the name. */
  .body :global(h3) {
    padding-right: 36px;
  }
  .body :global(p:last-child) {
    margin-bottom: 0;
  }
  .close {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--ink-soft);
    cursor: pointer;
    transition:
      color 0.3s var(--ease),
      background-color 0.3s var(--ease);
  }
  .close:hover {
    background: var(--control);
    color: var(--ink-strong);
  }
  .close svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  @media (pointer: coarse) {
    .body :global(h3) {
      padding-right: 44px;
    }
    .close {
      top: 2px;
      right: 2px;
      width: 44px;
      height: 44px;
    }
  }
  @media (max-width: 600px) {
    .detail {
      padding: 10px;
    }
    .img {
      width: 56px;
      margin-right: 10px;
    }
  }
</style>
