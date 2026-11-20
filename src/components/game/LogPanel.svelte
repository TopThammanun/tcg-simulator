<script lang="ts">
  // Game log in Thai. Click a line to see the board at that moment (PLAN.md: ย้อนดูสนามตอนนั้นได้).
  import { fly } from 'svelte/transition';
  import type { LogEntry } from '../../engine/types';
  import { motion } from '../../ui/anim/motion';

  let { log, viewing, onview }: { log: LogEntry[]; viewing: number | null; onview: (step: number) => void } = $props();

  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    void log.length;
    if (box && viewing === null) box.scrollTop = box.scrollHeight;
  });
</script>

<div class="log" bind:this={box} aria-label="บันทึกเกม">
  {#each log as e, i (i)}
    <button
      type="button"
      class="line"
      class:turn={e.text.startsWith('—')}
      class:me={e.player === 0}
      class:bot={e.player === 1}
      class:at={viewing === e.step}
      onclick={() => onview(e.step)}
      in:fly={{ x: -10, duration: motion(220) }}
    >
      {e.text}
    </button>
  {/each}
</div>

<style>
  .log {
    /* Keeps its height in the side column (which scrolls instead), however much sits above it. */
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    max-height: 420px;
    overflow-y: auto;
    border: 1.5px solid var(--line);
    background: var(--card-bg);
    font-size: 0.8rem;
    border-radius: var(--radius);
  }
  .line {
    padding: 2px 8px;
    border: 0;
    border-left: 3px solid transparent;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .line:hover {
    background: var(--paper-deep);
  }
  .line.me {
    border-left-color: var(--teal);
  }
  .line.bot {
    border-left-color: var(--stamp);
  }
  .line.turn {
    margin-top: 6px;
    font-family: var(--font-display);
    font-weight: 600;
    background: var(--paper-deep);
  }
  .line.at {
    background: color-mix(in srgb, var(--stamp) 18%, transparent);
  }
</style>
