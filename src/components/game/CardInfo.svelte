<script lang="ts">
  // Card detail: high-res image plus the English card text (PLAN.md: ดูการ์ด).
  import { fade, scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { def } from '../../engine/db';
  import { motion } from '../../ui/anim/motion';
  import CardFace from './CardFace.svelte';

  let { cardKey, onclose }: { cardKey: string; onclose: () => void } = $props();
  const d = $derived(def(cardKey));
  const LETTER: Record<string, string> = {
    Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F',
    Darkness: 'D', Metal: 'M', Dragon: 'N', Fairy: 'Y', Colorless: 'C',
  };
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
      <h3>{d.name}</h3>
      {#if d.category === 'pokemon'}
        <p class="sub">
          {d.stage === 'Stage1' ? 'Stage 1' : d.stage === 'Stage2' ? 'Stage 2' : 'Basic'}{d.evolvesFrom ? ` · จาก ${d.evolvesFrom}` : ''}
          · {d.hp} HP · {d.types.join('/')}{d.tera ? ' · Tera' : ''}{d.prizes > 1 ? ` · ${d.prizes} prize` : ''}
        </p>
        {#each d.abilities as a}
          <p><span class="tag">Ability</span> <strong>{a.name}</strong><br />{a.effect}</p>
        {/each}
        {#each d.attacks as a}
          <p>
            <span class="mono">[{a.cost.map((c) => LETTER[c]).join('') || '0'}]</span>
            <strong>{a.name}</strong>
            <span class="mono dmg">{a.damage}</span>
            {#if a.effect}<br />{a.effect}{/if}
          </p>
        {/each}
        <p class="sub mono">
          weak {d.weaknesses.map((w) => `${LETTER[w.type]}${w.value}`).join(' ') || '—'} · resist
          {d.resistances.map((w) => `${LETTER[w.type]}${w.value}`).join(' ') || '—'} · retreat {d.retreat}
        </p>
      {:else}
        <p class="sub">{d.category === 'trainer' ? d.trainerType : `${d.energyType} Energy`}{d.aceSpec ? ' · ACE SPEC' : ''}</p>
        {#if d.effect}<p class="effect">{d.effect}</p>{/if}
      {/if}
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
    background: color-mix(in srgb, #1a150c 60%, transparent);
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
    border: 2px solid var(--ink);
    background: var(--card-bg);
    color: var(--ink);
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
  h3 {
    margin: 0 0 4px;
    padding-right: 28px;
  }
  .sub {
    color: var(--ink-soft);
    font-size: 0.85rem;
  }
  .tag {
    padding: 0 4px;
    background: var(--stamp);
    color: #fff;
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }
  .dmg {
    float: right;
  }
  .effect {
    white-space: pre-line;
  }
  .mono {
    font-family: var(--font-mono);
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
