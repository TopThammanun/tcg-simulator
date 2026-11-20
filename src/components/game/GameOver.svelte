<script lang="ts">
  // The end of the game: "ชนะ!" with light and confetti, "แพ้", or a draw, over the table.
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
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
  const title = $derived(winner === 'draw' ? 'เสมอ' : won ? 'ชนะ!' : 'แพ้');
  const COLORS = ['#f2c94c', '#e2574b', '#4fb3aa', '#f3eee2', '#94509a', '#2b7bbd'];
  const confetti = Array.from({ length: 36 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: (i % 12) * 0.12,
    dur: 2.2 + ((i * 7) % 10) / 10,
    rot: (i * 53) % 360,
    color: COLORS[i % COLORS.length],
  }));
</script>

<div class="over" class:won class:lost={winner === 1} transition:fade={{ duration: motion(250) }}>
  {#if won}
    <div class="rays" aria-hidden="true"></div>
    <div class="confetti" aria-hidden="true">
      {#each confetti as c}
        <i style:left={`${c.left}%`} style:background={c.color} style:animation-delay={`${c.delay}s`} style:animation-duration={`${c.dur}s`} style:--r={`${c.rot}deg`}></i>
      {/each}
    </div>
  {/if}
  <div class="panel" role="dialog" aria-label="จบเกม" in:scale={{ duration: motion(420), start: 0.7, easing: backOut }}>
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
    background: radial-gradient(circle at 50% 45%, #1a150c99, #1a150cdd);
    overflow: hidden;
  }
  .over.lost {
    background: radial-gradient(circle at 50% 45%, #10121499, #101214e6);
  }
  .rays {
    position: absolute;
    left: 50%;
    top: 45%;
    width: 160vmax;
    height: 160vmax;
    margin: -80vmax 0 0 -80vmax;
    background: repeating-conic-gradient(from 0deg, #f2c94c2e 0deg 9deg, transparent 9deg 22deg);
    mask-image: radial-gradient(circle, #000 0 20%, transparent 55%);
    animation: spin 18s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .confetti i {
    position: absolute;
    top: -20px;
    width: 9px;
    height: 14px;
    border-radius: 2px;
    animation: fall linear infinite;
  }
  @keyframes fall {
    from {
      transform: translateY(0) rotate(var(--r));
    }
    to {
      transform: translateY(110vh) rotate(calc(var(--r) + 540deg));
    }
  }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    min-width: min(360px, 100%);
    padding: 26px 30px 22px;
    border: 2px solid var(--line);
    background: var(--card-bg);
    box-shadow: 0 30px 60px -20px #000c;
    text-align: center;
    border-radius: var(--radius);
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.6rem, 9vw, 4rem);
    font-weight: 700;
    line-height: 1;
    color: var(--ink);
  }
  .won .title {
    color: var(--stamp);
    text-shadow: 0 3px 0 #f2c94c;
  }
  .lost .title {
    color: var(--ink-soft);
  }
  .reason {
    margin: 0;
    color: var(--ink-soft);
  }
  .buttons {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  button {
    padding: 8px 18px;
    border: 1.5px solid var(--primary);
    background: var(--paper);
    color: var(--primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    border-radius: 999px;
  }
  .primary {
    background: var(--primary);
    color: var(--primary-ink);
    border-radius: 999px;
  }
  a {
    font-size: 0.85rem;
    color: var(--teal);
  }
  a.review {
    display: block;
    margin-bottom: 8px;
    font-size: 0.95rem;
    font-weight: 600;
  }
</style>
