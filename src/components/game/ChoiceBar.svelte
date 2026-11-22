<script lang="ts">
  // A choice made on the table (a Pokémon: your new Active, Boss's Orders' target, where Energy goes; an Energy
  // attached to a Pokémon): only a short bar with what is asked, the card asking, and what this card's earlier
  // questions were answered with. You tap on the table itself; a pick of several has its buttons here.
  import { tx } from '../../i18n';
  import { fly } from 'svelte/transition';
  import { CARDS } from '../../engine/db';
  import type { ChoiceRequest } from '../../engine/types';
  import { motion } from '../../ui/anim/motion';
  import CardFace from './CardFace.svelte';

  let {
    req,
    picks,
    earlier,
    onsubmit,
    onclear,
    onzoom,
  }: {
    req: ChoiceRequest;
    picks: number[];
    /** This card's earlier questions in this play, as the words of what was picked ("จาก Dreepy", "Fire Energy"). */
    earlier: string[];
    onsubmit: () => void;
    onclear: () => void;
    onzoom: (key: string) => void;
  } = $props();

  const single = $derived(req.min === 1 && req.max === 1);
  const ready = $derived(picks.length >= req.min && picks.length <= req.max);
  const onEnergy = $derived(req.options.length > 0 && req.options[0]!.slot === undefined);
  const how = $derived(onEnergy ? tx('แตะพลังงานบน Pokémon ที่สว่าง', 'Tap an Energy on a lit Pokémon') : tx('แตะ Pokémon ที่สว่างบนสนาม', 'Tap a lit Pokémon on the table'));
  const source = $derived(req.source && CARDS[req.source] ? req.source : null);
</script>

<div class="bar" role="status" aria-label={req.prompt} in:fly={{ y: 10, duration: motion(180) }}>
  {#if source}
    <button type="button" class="src" title={tx('การ์ดที่กำลังใช้', 'The card being played')} onclick={() => onzoom(source)}><CardFace cardKey={source} /></button>
  {/if}
  <div class="what">
    {#if earlier.length}
      <span class="earlier">{#each earlier as e}<span class="chip">{e}</span>{/each}<span class="arrow">→</span></span>
    {/if}
    <strong
      >{req.prompt}{#if !single}<span class="count" title={tx('เลือกแล้ว', 'chosen')}>{picks.length}{req.max < 99 ? `/${req.max}` : ''}</span
        >{/if}</strong
    >
    <span class="how">{how}{req.repeat ? tx(' (แตะซ้ำได้)', ' (tap again for more)') : ''}</span>
  </div>
  {#if !single}
    <div class="acts">
      <button type="button" class="ghost" onclick={onclear} disabled={picks.length === 0}>{tx('ล้าง', 'Clear')}</button>
      <button type="button" class="go" onclick={onsubmit} disabled={!ready}>{tx('ยืนยัน', 'Confirm')}</button>
    </div>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 4px 0 12px;
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--accent) 8%, var(--card-bg));
    color: var(--ink);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .src {
    flex: none;
    width: 32px;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  /* Two lines at most: the command bar keeps one height (Game.svelte .cmd). */
  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    align-content: center;
    gap: 0 10px;
    min-width: 0;
    max-height: 100%;
    overflow: hidden;
    flex: 1;
    font-size: 14px;
    line-height: 20px;
  }
  .earlier {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .chip {
    padding: 0 8px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    font-size: 12px;
    line-height: 18px;
    font-weight: 600;
  }
  .arrow {
    color: var(--ink-soft);
  }
  .how {
    font-size: 12px;
    line-height: 20px;
    color: var(--ink-soft);
  }
  /* How many are picked of how many, right after what is asked. */
  .count {
    margin-left: 8px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  /* A phone: what is asked and the count only (the lit cards show where to tap), so two lines hold it. */
  @media (max-width: 600px) {
    .how {
      display: none;
    }
  }
  .acts {
    display: flex;
    gap: 6px;
  }
  .go,
  .ghost {
    padding: 6px 14px;
    border-radius: var(--radius);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .go {
    border: 1px solid var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .ghost {
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  @media (pointer: coarse) {
    .go,
    .ghost {
      min-height: 44px;
    }
  }
</style>
