<script lang="ts">
  // The pop-up for one of your Pokémon (tap it on the table): Abilities, attacks with their cost and
  // text (and why one can't be used), retreating. Reading never acts: an attack has its own button, and a retreat
  // is picked and then confirmed. Next to the card on wide screens, a sheet at the bottom on phones.
  import { scale } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { def } from '../../engine/db';
  import type { Action } from '../../engine/types';
  import type { SlotMenu } from '../../ui/menu';
  import { previewText, type AttackPreview } from '../../ui/preview';
  import type { SlotInfo } from '../../ui/slot-info';
  import { motion } from '../../ui/anim/motion';
  import CardFace from './CardFace.svelte';
  import EffectText from './EffectText.svelte';
  import Energy from './Energy.svelte';

  let {
    menu,
    previews = [],
    info = null,
    anchor,
    hp,
    onact,
    onzoom,
    onclose,
  }: {
    menu: SlotMenu;
    /** What each attack would do to their Active (ui/preview.ts), in the order of menu.attacks; null for none. */
    previews?: (AttackPreview | null)[];
    /** Its Energy, Tool, conditions and effects (ui/slot-info.ts). */
    info?: SlotInfo | null;
    /** The tapped card on screen. */
    anchor: DOMRect | null;
    hp: { left: number; max: number };
    onact: (a: Action) => void;
    onzoom: (key: string) => void;
    onclose: () => void;
  } = $props();

  const WIDTH = 330;
  let height = $state(0);
  let vw = $state(1024);
  let vh = $state(768);
  const sheet = $derived(vw <= 700 || !anchor);
  // Beside the card (right if it fits, else left), centred on it and kept on screen.
  const pos = $derived.by(() => {
    if (sheet || !anchor) return '';
    const right = anchor.right + 12 + WIDTH <= vw - 8;
    const left = right ? anchor.right + 12 : Math.max(8, anchor.left - 12 - WIDTH);
    const top = Math.min(Math.max(8, anchor.top + anchor.height / 2 - height / 2), Math.max(8, vh - height - 8));
    return `left:${left}px;top:${top}px;width:${WIDTH}px`;
  });
  const name = $derived(def(menu.key).name);
  /** The Benched Pokémon picked to come up when retreating (confirmed with its button). */
  let retreatTo = $state<number | null>(null);
  const retreatPick = $derived(menu.retreat?.options.find((o) => o.to === retreatTo) ?? null);
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" role="presentation" onclick={onclose}></div>
<div
  class="pmenu"
  class:sheet
  style={pos}
  role="dialog"
  aria-label={name}
  bind:clientHeight={height}
  transition:scale={{ start: 0.9, duration: motion(180), easing: backOut }}
>
  <header>
    <button type="button" class="thumb" onclick={() => onzoom(menu.key)} aria-label="ดูการ์ด"><CardFace cardKey={menu.key} /></button>
    <div class="title">
      <strong>{name}</strong>
      <span class="hp mono">HP {hp.left}/{hp.max}</span>
    </div>
    <button type="button" class="x" onclick={onclose} aria-label="ปิด">✕</button>
  </header>
  {#if info && (info.energy.length || info.tool || info.conditions.length || info.marks.length)}
    <div class="state">
      {#each info.energy as e}<span class="chip energy" style={`--c:var(--t-${e.type.toLowerCase()})`}><Energy type={e.type} />{e.name}</span>{/each}
      {#if info.tool}<span class="chip tool">{info.tool}</span>{/if}
      {#each info.conditions as c}<span class="chip cond" title={c.does}>{c.name}</span>{/each}
      {#each info.marks as m}<span class="chip cond">{m}</span>{/each}
    </div>
  {/if}

  {#each menu.abilities as ab}
    <section class="ability">
      <div class="row">
        <span class="tag">Ability</span>
        <strong>{ab.name}</strong>
        {#if ab.action}
          <button type="button" class="use" onclick={() => onact(ab.action!)}>ใช้</button>
        {:else}
          <span class="auto">{ab.passive ? 'ทำงานเอง' : 'ใช้ไม่ได้ตอนนี้'}</span>
        {/if}
      </div>
      <p class="text"><EffectText text={ab.effect} /></p>
    </section>
  {/each}

  {#if menu.active}
    <div class="attacks">
      {#each menu.attacks as atk, i}
        {@const pv = previews[i] ?? null}
        {@const pvText = pv ? previewText(pv) : null}
        <div class="attack" class:off={!atk.action}>
          <span class="line">
            <span class="cost">
              {#each atk.cost as c}<Energy type={c} />{/each}
              {#if atk.cost.length === 0}<i class="free">–</i>{/if}
            </span>
            <span class="aname">{atk.name}{atk.from ? ` (จาก ${atk.from})` : ''}</span>
            <span class="dmg mono">{atk.damage}</span>
          </span>
          {#if atk.effect}<span class="text"><EffectText text={atk.effect} /></span>{/if}
          {#if atk.reason}<span class="why">{atk.reason}</span>{/if}
          {#if pvText}<span class="pv" class:ko={pv!.ko > 0} class:sure={pv!.ko >= 1}>{pvText}</span>{/if}
          <button type="button" class="go" disabled={!atk.action} onclick={() => atk.action && onact(atk.action)}>
            โจมตี{atk.action ? ' · จบเทิร์น' : ''}
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if menu.retreat}
    <section class="retreat">
      <div class="row">
        <strong>{menu.active ? 'ถอย' : 'สลับขึ้นเป็นตัวหลัก'}</strong>
        <span class="rcost">ทิ้งพลังงาน {menu.retreat.cost} ใบ</span>
      </div>
      {#if menu.retreat.reason}
        <p class="why">{menu.retreat.reason}</p>
      {:else if menu.active}
        <p class="hint">เลือกตัวที่จะขึ้นมาแทน</p>
        <div class="bench">
          {#each menu.retreat.options as o (o.to)}
            <button type="button" class="pick" class:on={retreatTo === o.to} onclick={() => (retreatTo = o.to)} title={def(o.key).name}>
              <CardFace cardKey={o.key} />
              <span>{def(o.key).name}</span>
            </button>
          {/each}
        </div>
        <button type="button" class="use wide" disabled={!retreatPick} onclick={() => retreatPick && onact(retreatPick.action)}>
          {retreatPick ? `ถอย ให้ ${def(retreatPick.key).name} ขึ้นมาแทน` : 'แตะตัวที่จะขึ้นมาแทน'}
        </button>
      {:else}
        <button type="button" class="use wide" onclick={() => onact(menu.retreat!.options[0]!.action)}>สลับขึ้นมา</button>
      {/if}
    </section>
  {/if}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .pmenu {
    position: fixed;
    z-index: 41;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
    padding: 10px 12px 12px;
    border: 1px solid #ffffff24;
    border-radius: var(--radius-lg);
    background: #1f1f1ff5;
    color: #eceef1;
    box-shadow:
      0 0 0 1px #0006,
      0 24px 50px -16px #000e;
    font-size: 0.85rem;
    overscroll-behavior: contain;
  }
  .pmenu.sheet {
    left: 8px;
    right: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom));
    max-height: 72dvh;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .thumb {
    flex: 0 0 auto;
    width: 38px;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  /* Attached cards and what is on it, under the name. */
  .state {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .state .chip {
    padding: 0 7px;
    border-radius: 2px;
    background: var(--c, #ffffff22);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .state .chip.energy {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding-left: 2px;
  }
  .state .chip.tool {
    background: #ffffff2e;
  }
  .state .chip.cond {
    background: #c3352b;
  }
  .title {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .title strong {
    font-weight: 600;
    font-size: 1.05rem;
    line-height: 1.2;
  }
  .hp {
    color: #9fd6ac;
    font-size: 0.78rem;
  }
  .x {
    align-self: flex-start;
    padding: 2px 8px;
    border: 0;
    background: none;
    color: #eef3ef;
    font-size: 1rem;
    cursor: pointer;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tag {
    padding: 0 6px;
    border-radius: 3px;
    background: #c3352b;
    color: #fff;
    font-size: 0.68rem;
    font-weight: 700;
  }
  .text {
    margin: 0;
    color: #c9d4cf;
    font-size: 0.76rem;
    line-height: 1.4;
  }
  .ability {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-radius: 4px;
    background: #ffffff0a;
  }
  /* Using an Ability, retreating: ordinary buttons (the attack is the main one). */
  .use {
    margin-left: auto;
    padding: 6px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--control);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.3s var(--ease);
  }
  .use:hover:not(:disabled) {
    background: #313131;
  }
  .use.wide {
    margin: 0;
    align-self: flex-start;
  }
  .auto {
    margin-left: auto;
    color: #9aa7a2;
    font-size: 0.72rem;
  }
  .attacks {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .attack {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: var(--radius);
    background: #ffffff0a;
    color: #fff;
    text-align: left;
  }
  .attack.off {
    border-color: #ffffff1c;
    background: #ffffff06;
    color: #9aa7a2;
  }
  /* The attack itself: its own button, so reading the text never attacks. */
  .attack .go {
    align-self: flex-end;
    margin-top: 4px;
    padding: 6px 20px;
    border: 1px solid var(--primary);
    border-radius: var(--radius);
    background: var(--primary);
    color: var(--primary-ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.3s var(--ease);
  }
  .attack .go:hover:not(:disabled) {
    border-color: var(--press);
    background: var(--press);
  }
  .attack .go:disabled {
    border-color: var(--line);
    background: var(--control);
    color: var(--ink-soft);
    cursor: not-allowed;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cost {
    display: flex;
    gap: 2px;
  }
  .cost :global(.energy) {
    width: 19px;
    height: 19px;
  }
  .cost i.free {
    display: inline-grid;
    place-items: center;
    width: 19px;
    height: 19px;
    border: 1.5px solid #ffffff44;
    border-radius: 50%;
    font-family: var(--font-mono);
    font-size: 0.56rem;
    font-style: normal;
    font-weight: 700;
  }
  .aname {
    flex: 1;
    font-size: 1rem;
    font-weight: 600;
  }
  .dmg {
    font-family: var(--font-mono);
    font-size: 1.05rem;
    font-weight: 600;
    color: #f0d48a;
  }
  .attack.off .dmg {
    color: inherit;
  }
  /* What the attack would do to their Active: green for damage, gold for a Knock Out. */
  .pv {
    align-self: flex-start;
    padding: 2px 8px;
    border-radius: 2px;
    background: #ffffff1a;
    color: #cfe0ff;
    font-size: 0.74rem;
    font-weight: 600;
  }
  .pv.ko {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: #ffe08a;
  }
  .pv.sure {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .why {
    margin: 0;
    color: #ff9a8f;
    font-size: 0.74rem;
  }
  .retreat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid #ffffff1c;
  }
  .rcost {
    margin-left: auto;
    color: #c9d4cf;
    font-size: 0.75rem;
  }
  .hint {
    margin: 0;
    color: #c9d4cf;
    font-size: 0.75rem;
  }
  .bench {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pick {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    width: 64px;
    padding: 0;
    border: 0;
    background: none;
    color: #eef3ef;
    font: inherit;
    font-size: 0.62rem;
    line-height: 1.2;
    text-align: center;
    cursor: pointer;
  }
  .pick :global(.face) {
    transition: transform 0.12s ease;
  }
  .pick:hover :global(.face) {
    transform: translateY(-3px);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .pick.on :global(.face) {
    transform: translateY(-3px);
    box-shadow: 0 0 0 3px var(--accent);
  }
  .use:disabled {
    opacity: 0.5;
    cursor: default;
  }
  /* Touch screens: buttons a finger can hit (44px), the ones that act across the whole width. */
  @media (pointer: coarse) {
    .x {
      min-width: 44px;
      min-height: 44px;
      margin: -6px -8px 0 0;
    }
    .use,
    .attack .go {
      min-height: 44px;
    }
    .attack .go,
    .use.wide {
      align-self: stretch;
    }
    .ability .row .use {
      flex: 1 0 100%;
      order: 3;
      margin-left: 0;
    }
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
