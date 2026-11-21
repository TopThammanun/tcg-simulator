<script lang="ts">
  // A card's printed text as text (the image is too small to read on the table): name, kind, Abilities and attacks
  // with their cost, or the Trainer / Energy effect. Used by the card view (CardInfo) and the card picked up from the
  // hand (HandDetail).
  import { tx } from '../../i18n';
  import { def } from '../../engine/db';
  import EffectText from './EffectText.svelte';
  import Energy from './Energy.svelte';

  let { cardKey, compact = false }: { cardKey: string; compact?: boolean } = $props();
  const d = $derived(def(cardKey));
</script>

<div class="text" class:compact>
  <h3>{d.name}</h3>
  {#if d.category === 'pokemon'}
    {#snippet battle()}
      weak {#each d.weaknesses as w}<Energy type={w.type} />{w.value}{' '}{:else}—{/each} · resist
      {#each d.resistances as w}<Energy type={w.type} />{w.value}{' '}{:else}—{/each} · retreat {d.retreat}
    {/snippet}
    <p class="sub">
      {d.stage === 'Stage1' ? 'Stage 1' : d.stage === 'Stage2' ? 'Stage 2' : 'Basic'}{d.evolvesFrom ? tx(` · จาก ${d.evolvesFrom}`, ` · from ${d.evolvesFrom}`) : ''}
      · {d.hp} HP · {d.types.join('/')}{d.tera ? ' · Tera' : ''}{d.prizes > 1 ? ` · ${d.prizes} prize` : ''}
      <!-- Compact (the card picked up from the hand): weakness, resistance and retreat on the same line, to save one. -->
      {#if compact}<span class="mono"> · {@render battle()}</span>{/if}
    </p>
    {#each d.abilities as a}
      <p><span class="tag">Ability</span> <strong>{a.name}</strong><br /><EffectText text={a.effect} /></p>
    {/each}
    {#each d.attacks as a}
      <p>
        <span class="cost">
          {#each a.cost as c}<Energy type={c} />{:else}<i class="e free">0</i>{/each}
        </span>
        <strong>{a.name}</strong>
        <span class="mono dmg">{a.damage}</span>
        {#if a.effect}<br /><EffectText text={a.effect} />{/if}
      </p>
    {/each}
    {#if !compact}<p class="sub mono">{@render battle()}</p>{/if}
  {:else}
    <p class="sub">{d.category === 'trainer' ? d.trainerType : `${d.energyType} Energy`}{d.aceSpec ? ' · ACE SPEC' : ''}</p>
    {#if d.effect}<p class="effect"><EffectText text={d.effect} /></p>{/if}
  {/if}
</div>

<style>
  h3 {
    margin: 0 0 4px;
    padding-right: 28px;
  }
  .compact h3 {
    margin-bottom: 0;
    font-size: 16px;
    line-height: 24px;
    padding-right: 0;
  }
  .compact p {
    margin: 0 0 2px;
    font-size: 14px;
    line-height: 20px;
  }
  .compact p.sub {
    font-size: 12px;
    line-height: 18px;
  }
  .sub {
    color: var(--ink-soft);
    font-size: 14px;
  }
  .tag {
    padding: 0 5px;
    border-radius: var(--radius-sm);
    background: var(--stamp);
    color: #fff;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .cost {
    display: inline-flex;
    gap: 2px;
    vertical-align: -2px;
    margin-right: 4px;
  }
  .e.free {
    display: inline-grid;
    place-items: center;
    width: 1.2em;
    height: 1.2em;
    border-radius: 50%;
    background: var(--t-colorless);
    color: #fff;
    font-style: normal;
    font-size: 12px;
    font-weight: 700;
  }
  .dmg {
    float: right;
    font-weight: 700;
  }
  .effect {
    white-space: pre-line;
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
