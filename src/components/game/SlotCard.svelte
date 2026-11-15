<script lang="ts">
  // One Pokémon in play, drawn as on the table: HP and damage on the card, attached Energy peeking out
  // below it, the Tool peeking out above it, conditions and ability buttons on top.
  // The container sets the width (Active Spot or a Bench cell).
  import { maxHp, provides, toolKey } from '../../engine/rules';
  import { keyOf, topKey } from '../../engine/state';
  import type { GameState, Slot } from '../../engine/types';
  import { def } from '../../engine/db';
  import CardFace from './CardFace.svelte';

  let {
    s,
    pokemon: slot,
    active = false,
    target = false,
    picked = 0,
    abilities = [],
    over = false,
    grab = false,
    onclick,
    onability,
    onzoom,
    onpress,
  }: {
    s: GameState;
    pokemon: Slot;
    active?: boolean;
    target?: boolean;
    picked?: number;
    abilities?: string[];
    /** A dragged card is over this Pokémon and can be dropped here. */
    over?: boolean;
    /** This Pokémon can be dragged (to retreat). */
    grab?: boolean;
    onclick?: () => void;
    onability?: (name: string) => void;
    onzoom?: (key: string) => void;
    onpress?: (e: PointerEvent) => void;
  } = $props();

  const key = $derived(topKey(s, slot));
  const hp = $derived(maxHp(s, slot));
  const left = $derived(Math.max(0, hp - slot.damage));
  const health = $derived(left / hp > 0.5 ? 'ok' : left / hp > 0.25 ? 'hurt' : 'low');
  const energy = $derived(slot.energy.map((e) => ({ id: e, type: provides(keyOf(s, e)), key: keyOf(s, e) })));
  const tool = $derived(toolKey(s, slot));
  const LETTER: Record<string, string> = {
    Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F',
    Darkness: 'D', Metal: 'M', Dragon: 'N', Fairy: 'Y', Colorless: 'C',
  };
</script>

<div
  class="slot"
  class:active
  class:target
  class:over
  class:grab
  class:picked={picked > 0}
  data-drop={`slot:${slot.uid}`}
  data-slot={slot.uid}
  style:--left={left}
  style:--max={hp}
  style:--dmg={slot.damage}
  style:--pct={`${(left / hp) * 100}%`}
>
  <button
    type="button"
    class="card"
    data-card={slot.stack[slot.stack.length - 1]}
    aria-label={`${def(key).name} HP ${left}/${hp}`}
    onclick={onclick}
    onpointerdown={onpress}
    oncontextmenu={(e) => {
      e.preventDefault();
      onzoom?.(key);
    }}
  >
    <CardFace cardKey={key} />
    {#if tool}<span class="tool" data-card={slot.tool} title={def(tool).name}>{def(tool).name}</span>{/if}
    {#if slot.damage > 0}<span class="dmg mono" aria-hidden="true"></span>{/if}
    {#if picked > 0}<span class="pick mono">{picked > 1 ? `×${picked}` : '✓'}</span>{/if}
    {#if slot.conditions.length}<span class="cond">{slot.conditions.map((c) => (c === 'poisoned' ? 'พิษ' : 'สับสน')).join(' ')}</span>{/if}
    <span class={`hp ${health}`} aria-hidden="true"><span class="mono"></span></span>
  </button>
  {#if energy.length}
    <span class="energy" class:many={energy.length > 4}>
      {#each energy as e (e.id)}
        <span class="pip" data-card={e.id} style={`--c:var(--t-${e.type.toLowerCase()})`} title={def(e.key).name}>{LETTER[e.type]}</span>
      {/each}
    </span>
  {/if}
  {#if abilities.length}
    <span class="abilities">
      {#each abilities as name}
        <button type="button" class="ability" onclick={() => onability?.(name)}>✦ {name}</button>
      {/each}
    </span>
  {/if}
</div>

<style>
  /* Registered so the hit animation can count HP down and drain the bar (src/ui/anim/fx.ts). */
  @property --pct {
    syntax: '<percentage>';
    inherits: true;
    initial-value: 100%;
  }
  @property --left {
    syntax: '<integer>';
    inherits: true;
    initial-value: 0;
  }
  @property --dmg {
    syntax: '<integer>';
    inherits: true;
    initial-value: 0;
  }
  .slot {
    position: relative;
    width: 100%;
    counter-reset: left var(--left) max var(--max) dmg var(--dmg);
    transition: --pct 0.35s ease;
  }
  .hp .mono::after {
    content: counter(left) '/' counter(max);
  }
  .dmg::after {
    content: counter(dmg);
  }
  .card {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    border-radius: 7px;
    transition: transform 0.12s ease;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .card:hover {
    transform: translateY(-3px);
  }
  .card :global(.face) {
    box-shadow:
      0 1px 0 #ffffff30 inset,
      0 6px 14px -6px #000c;
  }
  .grab .card {
    cursor: grab;
    /* Dragging the Pokémon must not scroll the page on touch. */
    touch-action: none;
  }
  .slot.over .card {
    outline: 4px solid #fff;
    outline-offset: 3px;
    transform: scale(1.06);
    animation: none;
    box-shadow: 0 0 0 9px #f2c94c66;
  }
  .target .card {
    outline: 3px solid var(--target, #f2c94c);
    outline-offset: 2px;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .picked .card {
    outline: 3px solid var(--stamp);
    outline-offset: 2px;
  }
  @keyframes pulse {
    50% {
      outline-color: transparent;
    }
  }
  .hp {
    position: absolute;
    left: 7%;
    right: 7%;
    bottom: 4%;
    height: max(13px, 11%);
    max-height: 17px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    border: 1px solid #0009;
    background: linear-gradient(to right, var(--fill) var(--pct), #1b1f1ccc var(--pct));
    color: #fff;
    font-size: 0.66rem;
    font-weight: 600;
    line-height: 1;
    text-shadow: 0 1px 1px #000c;
    box-shadow: 0 1px 3px #0008;
  }
  .hp.ok {
    --fill: #3f9b5a;
  }
  .hp.hurt {
    --fill: #c8941f;
  }
  .hp.low {
    --fill: #c3352b;
  }
  .dmg {
    position: absolute;
    top: 24%;
    right: -7px;
    min-width: 28px;
    padding: 2px 6px;
    border: 2px solid #fff;
    border-radius: 999px;
    background: #c3352b;
    color: #fff;
    font-weight: 700;
    font-size: 0.82rem;
    line-height: 1.2;
    text-align: center;
    box-shadow: 0 2px 5px #000a;
  }
  .tool {
    position: absolute;
    top: -9px;
    left: 8%;
    max-width: 84%;
    padding: 1px 6px;
    border: 1px solid #0007;
    border-radius: 4px 4px 2px 2px;
    background: linear-gradient(#e9e3d4, #c9c1ad);
    color: #2a261e;
    font-size: 0.6rem;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 1px 2px #0007;
  }
  .pick {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 1px 6px;
    background: var(--stamp);
    color: #fff;
    border-radius: 4px;
    font-size: 0.8rem;
  }
  .cond {
    position: absolute;
    top: 14%;
    left: 4px;
    padding: 1px 5px;
    background: #6b2f8a;
    color: #fff;
    font-size: 0.68rem;
    border-radius: 3px;
    box-shadow: 0 1px 2px #0008;
  }
  /* Attached Energy peeks out from under the card. */
  .energy {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% - 7px);
    z-index: 2;
    display: flex;
    justify-content: center;
    gap: 2px;
    pointer-events: none;
  }
  .energy.many .pip + .pip {
    margin-left: -6px;
  }
  .pip {
    display: inline-grid;
    place-items: center;
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    border-radius: 50%;
    border: 1.5px solid #f3eee2;
    background: var(--c);
    color: #fff;
    font-family: var(--font-mono);
    font-size: 0.52rem;
    font-weight: 700;
    box-shadow: 0 1px 2px #000a;
    pointer-events: auto;
  }
  .abilities {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: max-content;
    max-width: 140%;
    transform: translate(-50%, -50%);
  }
  .ability {
    padding: 3px 8px;
    border: 1.5px solid #fff6d6;
    border-radius: 999px;
    background: linear-gradient(#e0ad2c, #b9831a);
    color: #1c1508;
    font: inherit;
    font-size: 0.66rem;
    font-weight: 700;
    line-height: 1.2;
    cursor: pointer;
    box-shadow:
      0 0 0 3px #f2c94c44,
      0 3px 8px #000b;
    animation: glow 1.6s ease-in-out infinite;
  }
  .ability:hover {
    background: linear-gradient(#f2c94c, #cf961f);
  }
  @keyframes glow {
    50% {
      box-shadow:
        0 0 0 6px #f2c94c22,
        0 3px 8px #000b;
    }
  }
  .mono {
    font-family: var(--font-mono);
  }
  @media (max-width: 700px) {
    .hp {
      font-size: 0.56rem;
    }
    .dmg {
      min-width: 22px;
      padding: 1px 4px;
      font-size: 0.7rem;
    }
    .pip {
      width: 13px;
      height: 13px;
      font-size: 0.48rem;
    }
    .tool {
      top: -7px;
      font-size: 0.5rem;
      padding: 0 4px;
    }
    .ability {
      padding: 2px 6px;
      font-size: 0.58rem;
    }
  }
</style>
