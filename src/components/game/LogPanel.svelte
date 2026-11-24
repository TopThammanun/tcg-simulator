<script lang="ts">
  // Game log in Thai. Click a line to see the board at that moment (PLAN.md: ย้อนดูสนามตอนนั้นได้). When your turn
  // starts, the bot's turn just played is marked (`recent`): what it did, without a box over the table.
  import { tx } from '../../i18n';
  import { fly } from 'svelte/transition';
  import type { LogEntry } from '../../engine/types';
  import { motion } from '../../ui/anim/motion';

  let {
    log,
    viewing,
    recent = null,
    onview,
  }: { log: LogEntry[]; viewing: number | null; recent?: number | null; onview: (step: number) => void } = $props();

  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    void log.length;
    if (box && viewing === null) box.scrollTop = box.scrollHeight;
  });
</script>

<div class="log" bind:this={box} aria-label={tx('บันทึกเกม', 'Game log')}>
  {#each log as e, i (i)}
    <button
      type="button"
      class="line"
      class:turn={e.text.startsWith('—')}
      class:me={e.player === 0}
      class:bot={e.player === 1}
      class:at={viewing === e.step}
      class:recent={recent !== null && e.turn === recent}
      onclick={() => onview(e.step)}
      in:fly={{ x: -10, duration: motion(220) }}
    >
      {e.text}
    </button>
  {/each}
</div>

<style>
  /* Fills what the side column has left under the card text panel; it scrolls itself. */
  .log {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 120px;
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--line);
    background: var(--card-bg);
    font-size: 12px;
    line-height: 16px;
    border-radius: var(--radius-lg);
  }
  .line {
    padding: 4px 8px;
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
    border-left-color: var(--primary);
  }
  .line.bot {
    border-left-color: var(--theirs);
  }
  .line.turn {
    margin-top: 6px;
    font-weight: 600;
    background: var(--paper-deep);
  }
  /* The bot's turn just played, when yours starts. */
  .line.recent {
    background: color-mix(in srgb, var(--theirs) 10%, transparent);
  }
  .line.at {
    background: color-mix(in srgb, var(--primary) 14%, transparent);
  }
</style>
