<script lang="ts">
  // The end of the game: "ชนะ", "แพ้" or a draw, on a plain sheet over the table.
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { motion } from '../../ui/anim/motion';
  import type { PlayerId } from '../../engine/types';

  let {
    winner,
    reason,
    botDeck,
    botHref,
    reviewHref = null,
    onagain,
    onnew,
    onclose,
  }: {
    winner: PlayerId | 'draw';
    reason: string;
    botDeck: string;
    botHref: string;
    /** The saved game's review page (null until it is saved). */
    reviewHref?: string | null;
    /** Play the same two decks again, a new deal (none for a game picked up from a saved one). */
    onagain?: () => void;
    onnew: () => void;
    onclose: () => void;
  } = $props();

  const won = $derived(winner === 0);
  const title = $derived(winner === 'draw' ? 'เสมอ' : won ? 'ชนะ' : 'แพ้');
</script>

<div class="over" class:won class:lost={winner === 1} transition:fade={{ duration: motion(250) }}>
  <div class="panel" role="dialog" aria-label="จบเกม" in:scale={{ duration: motion(260), start: 0.96, easing: cubicOut }}>
    <p class="title">{title}</p>
    <p class="reason">{reason}</p>
    <div class="buttons">
      {#if onagain}<button type="button" class="primary" onclick={onagain}>เล่นอีกครั้ง (เด็คเดิม)</button>{/if}
      <button type="button" class:primary={!onagain} onclick={onnew}>{onagain ? 'เลือกเด็คใหม่' : 'เกมใหม่'}</button>
      <button type="button" onclick={onclose}>ดูสนาม</button>
    </div>
    {#if reviewHref}<a class="review" href={reviewHref}>วิจารณ์เกมนี้: เทิร์นไหนพลาด, win% ทั้งเกม →</a>{/if}
    <a href={botHref}>ดู list ที่บอทใช้ ({botDeck}) →</a>
  </div>
</div>

<style>
  .over {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: grid;
    place-items: center;
    padding: 16px;
    background: #000000b3;
  }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    min-width: min(400px, 100%);
    padding: 32px;
    border: 1px solid var(--line);
    background: var(--card-bg);
    box-shadow: var(--shadow-lg);
    text-align: center;
    border-radius: var(--radius-xl);
  }
  .lost .title {
    color: var(--stamp);
  }
  .title {
    margin: 0;
    font-size: 48px;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.02em;
    color: var(--ink-strong);
  }
  .reason {
    margin: 0;
    color: var(--ink-soft);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 8px;
  }
  button {
    padding: 8px 12px;
    border: 1px solid var(--line);
    background: var(--control);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    border-radius: var(--radius);
    transition:
      background-color 0.3s var(--ease),
      transform 0.3s var(--ease);
  }
  button:hover {
    background: #313131;
  }
  button:active {
    transform: scale(0.98);
  }
  .primary {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .primary:hover {
    border-color: var(--press);
    background: var(--press);
  }
  a {
    font-size: 0.85rem;
    color: var(--primary);
    text-underline-offset: 3px;
  }
  a.review {
    display: block;
    margin: 6px 0 4px;
    font-size: 0.95rem;
    font-weight: 600;
  }
</style>
