<script lang="ts">
  // A card's printed text as text (the image is too small to read on the table): name, kind, Abilities and attacks
  // with their cost, or the Trainer / Energy effect. Used by the card view (CardInfo) and the card picked up from the
  // hand (HandDetail).
  import { def } from '../../engine/db';

  let { cardKey, compact = false }: { cardKey: string; compact?: boolean } = $props();
  const d = $derived(def(cardKey));
  const LETTER: Record<string, string> = {
    Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F',
    Darkness: 'D', Metal: 'M', Dragon: 'N', Fairy: 'Y', Colorless: 'C',
  };
</script>

<div class="text" class:compact>
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
        <span class="cost">
          {#each a.cost as c}<i class="e" style={`--c:var(--t-${c.toLowerCase()})`}>{LETTER[c]}</i>{:else}<i class="e free">0</i>{/each}
        </span>
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

<style>
  h3 {
    margin: 0 0 4px;
    padding-right: 28px;
  }
  .compact h3 {
    font-size: 1.05rem;
    padding-right: 0;
  }
  .compact p {
    margin: 0 0 6px;
    font-size: 0.86rem;
    line-height: 1.45;
  }
  .sub {
    color: var(--ink-soft);
    font-size: 0.85rem;
  }
  .tag {
    padding: 0 5px;
    border-radius: 4px;
    background: var(--stamp);
    color: #fff;
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }
  .cost {
    display: inline-flex;
    gap: 2px;
    vertical-align: -2px;
    margin-right: 4px;
  }
  .e {
    display: inline-grid;
    place-items: center;
    width: 1.15em;
    height: 1.15em;
    border-radius: 50%;
    background: var(--c, #ccc);
    color: #fff;
    font-style: normal;
    font-size: 0.72em;
    font-weight: 700;
    box-shadow: inset 0 0 0 1px #0003;
  }
  .e.free {
    background: #bbb;
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
