<script lang="ts">
  // A pending choice for you: pick cards, Pokémon on the board (highlighted there too), or an option.
  import { fly } from 'svelte/transition';
  import { motion } from '../../ui/anim/motion';
  import { keyOf } from '../../engine/state';
  import type { ChoiceRequest, GameState } from '../../engine/types';
  import CardFace from './CardFace.svelte';

  let {
    s,
    req,
    picks,
    onpick,
    onsubmit,
    onclear,
    onzoom,
  }: {
    s: GameState;
    req: ChoiceRequest;
    picks: number[];
    onpick: (v: number) => void;
    onsubmit: () => void;
    onclear: () => void;
    onzoom: (key: string) => void;
  } = $props();

  const kind = $derived(req.options[0]?.slot !== undefined ? 'slot' : req.options[0]?.card !== undefined ? 'card' : 'label');
  const ready = $derived(picks.length >= req.min && picks.length <= req.max);
  const counts = $derived(picks.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<number, number>()));
  const needs = $derived(
    req.min === req.max ? `เลือก ${req.max}` : req.min === 0 ? `เลือกได้ไม่เกิน ${req.max}` : `เลือก ${req.min}–${req.max}`,
  );
</script>

<div class="choice" role="dialog" aria-label={req.prompt} in:fly={{ y: 14, duration: motion(240) }}>
  <div class="head">
    <strong>{req.prompt}</strong>
    {#if kind !== 'label'}<span class="need">{needs} · เลือกแล้ว {picks.length}</span>{/if}
  </div>

  {#if kind === 'card'}
    <div class="cards">
      {#each req.options as o (o.value)}
        {@const k = keyOf(s, o.card!)}
        <button
          type="button"
          class="opt"
          class:on={counts.has(o.value)}
          onclick={() => onpick(o.value)}
          oncontextmenu={(e) => {
            e.preventDefault();
            onzoom(k);
          }}
        >
          <CardFace cardKey={k} />
          {#if counts.has(o.value)}
            <span class="badge">{req.ordered ? picks.indexOf(o.value) + 1 : '✓'}</span>
          {/if}
        </button>
      {/each}
    </div>
  {:else if kind === 'slot'}
    <p class="hint">กดเลือก Pokémon ที่ไฮไลต์บนสนาม{req.repeat ? ' (กดซ้ำได้)' : ''}</p>
    <div class="labels">
      {#each req.options as o (o.value)}
        <button type="button" class="lbl" class:on={counts.has(o.value)} onclick={() => onpick(o.value)}>
          {o.label}{counts.get(o.value) ? ` ×${counts.get(o.value)}` : ''}
        </button>
      {/each}
    </div>
  {:else}
    <div class="labels">
      {#each req.options as o (o.value)}
        <button type="button" class="lbl big" class:on={counts.has(o.value)} onclick={() => onpick(o.value)}>{o.label}</button>
      {/each}
    </div>
  {/if}

  {#if !(req.max === 1 && req.min === 1)}
    <div class="actions">
      <button type="button" class="ghost" onclick={onclear} disabled={picks.length === 0}>ล้าง</button>
      <button type="button" class="go" onclick={onsubmit} disabled={!ready}>ยืนยัน</button>
    </div>
  {/if}
</div>

<style>
  .choice {
    padding: 12px;
    border: 2px solid var(--ink);
    background: var(--card-bg);
    box-shadow: 6px 6px 0 color-mix(in srgb, var(--ink) 25%, transparent);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: baseline;
    margin-bottom: 8px;
  }
  .need {
    font-size: 0.8rem;
    color: var(--ink-soft);
    font-family: var(--font-mono);
  }
  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    max-height: 340px;
    overflow-y: auto;
  }
  .opt {
    position: relative;
    width: 86px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: 7px;
  }
  .opt.on {
    outline: 3px solid var(--stamp);
    outline-offset: 2px;
  }
  .badge {
    position: absolute;
    top: 4px;
    left: 4px;
    min-width: 20px;
    padding: 0 5px;
    background: var(--stamp);
    color: #fff;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  .hint {
    margin: 0 0 6px;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .lbl {
    padding: 6px 12px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .lbl.big {
    padding: 8px 16px;
    font-family: var(--font-display);
    font-weight: 600;
  }
  .lbl.on {
    background: var(--ink);
    color: var(--paper);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
  }
  .go,
  .ghost {
    padding: 6px 16px;
    border: 1.5px solid var(--ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .go {
    background: var(--ink);
    color: var(--paper);
  }
  .ghost {
    background: transparent;
    color: var(--ink);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
