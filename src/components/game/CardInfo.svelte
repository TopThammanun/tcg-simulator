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
      {#if info}
        <section class="state" aria-label="สถานะในสนาม">
          <div class="row">
            <span class="where">{info.owner === 0 ? 'ของคุณ' : 'ของบอท'} · {info.active ? 'ตัวหลัก' : 'Bench'}</span>
            <span class="hp mono" class:low={info.hp.left * 3 <= info.hp.max}>HP {info.hp.left}/{info.hp.max}</span>
          </div>
          <div class="hpbar"><span style:width={`${(info.hp.left / info.hp.max) * 100}%`}></span></div>
          <dl>
            <dt>พลังงาน</dt>
            <dd>
              {#if info.energy.length}
                {#each info.energy as e}<span class="chip" style={`--c:var(--t-${e.type.toLowerCase()})`}>{e.name}</span>{/each}
              {:else}ไม่มี{/if}
            </dd>
            {#if info.tool}<dt>Tool</dt><dd><span class="chip tool">{info.tool}</span></dd>{/if}
            {#if info.under.length}<dt>ใต้การ์ด</dt><dd>{info.under.join(' → ')}</dd>{/if}
            {#each info.conditions as c}<dt class="warn">{c.name}</dt><dd>{c.does}</dd>{/each}
            {#each info.marks as m}<dt class="warn">ผลที่ติดอยู่</dt><dd>{m}</dd>{/each}
          </dl>
        </section>
      {/if}
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
  /* In play: a band above the card text. */
  .state {
    margin-bottom: 14px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--paper);
    border: 1px solid var(--rule);
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-weight: 600;
  }
  .where {
    color: var(--ink-soft);
    font-size: 0.85rem;
  }
  .hp {
    font-size: 1rem;
  }
  .hp.low {
    color: var(--stamp);
  }
  .hpbar {
    height: 6px;
    margin: 6px 0 10px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--ink) 15%, transparent);
    overflow: hidden;
  }
  .hpbar span {
    display: block;
    height: 100%;
    background: #3fae5a;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 0.86rem;
  }
  dt {
    color: var(--ink-soft);
    font-weight: 600;
  }
  dt.warn {
    color: var(--stamp);
  }
  dd {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
  }
  .chip {
    padding: 0 7px;
    border-radius: 2px;
    background: var(--c, var(--primary));
    color: #fff;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .chip.tool {
    background: var(--ink-soft);
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
