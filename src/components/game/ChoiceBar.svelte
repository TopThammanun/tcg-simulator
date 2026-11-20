<script lang="ts">
  // A choice made on the table (a Pokémon: your new Active, Boss's Orders' target, where Energy goes; an Energy
  // attached to a Pokémon; your face-down Prize cards): only a short bar with what is asked, the card asking, and what this card's earlier
  // questions were answered with. You tap on the table itself; a pick of several has its buttons here.
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
  const how = $derived(
    req.hint === 'prizes' ? 'แตะ Prize ที่จะเก็บ (คว่ำอยู่: ใบไหนก็ได้)' : onEnergy ? 'แตะพลังงานบน Pokémon ที่สว่าง' : 'แตะ Pokémon ที่สว่างบนสนาม',
  );
  const source = $derived(req.source && CARDS[req.source] ? req.source : null);
</script>

<div class="bar" role="status" aria-label={req.prompt} in:fly={{ y: 10, duration: motion(180) }}>
  {#if source}
    <button type="button" class="src" title="การ์ดที่กำลังใช้" onclick={() => onzoom(source)}><CardFace cardKey={source} /></button>
  {/if}
  <div class="what">
    {#if earlier.length}
      <span class="earlier">{#each earlier as e}<span class="chip">{e}</span>{/each}<span class="arrow">→</span></span>
    {/if}
    <strong>{req.prompt}</strong>
    <span class="how">
      {how}{req.repeat ? ' (แตะซ้ำได้)' : ''}{single
        ? ''
        : ` · เลือกแล้ว ${picks.length}${req.max < 99 ? `/${req.max}` : ''}`}
    </span>
  </div>
  {#if !single}
    <div class="acts">
      <button type="button" class="ghost" onclick={onclear} disabled={picks.length === 0}>ล้าง</button>
      <button type="button" class="go" onclick={onsubmit} disabled={!ready}>ยืนยัน</button>
    </div>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--card-bg);
    color: var(--ink);
    border: 2px solid var(--accent);
    box-shadow: 0 4px 0 color-mix(in srgb, var(--accent) 50%, #000);
  }
  .src {
    flex: none;
    width: 40px;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    min-width: 0;
    flex: 1;
  }
  .earlier {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .chip {
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .arrow {
    color: var(--ink-soft);
  }
  .how {
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .acts {
    display: flex;
    gap: 6px;
  }
  .go,
  .ghost {
    padding: 6px 14px;
    border-radius: 999px;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .go {
    border: 0;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .ghost {
    border: 1.5px solid color-mix(in srgb, var(--ink) 25%, transparent);
    background: transparent;
    color: var(--primary);
    border-radius: 999px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
