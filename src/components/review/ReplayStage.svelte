<script lang="ts">
  // One turn played again on the table: the play screen's Board and hand, stepped through with buttons (a step is one
  // of the player's moves with the choices it asked for), stepping forward playing the move with the play screen's
  // animations (ui/anim), or playing on its own. Embedded in the review page on a computer, inside ReplayViewer (full
  // screen) on a phone. Which line (yours, the bot's) and the turn are the parent's: it passes the Line and binds `pos`.
  import { tick, untrack } from 'svelte';
  import { keyOf } from '../../engine/state';
  import type { CardId, PlayerId, SlotId } from '../../engine/types';
  import { animEvents } from '../../ui/anim/events';
  import { Fx, snapshot } from '../../ui/anim/fx';
  import { slotInfo, type SlotInfo } from '../../ui/slot-info';
  import type { Line } from '../../review/summary';
  import Board from '../game/Board.svelte';
  import CardInfo from '../game/CardInfo.svelte';
  import FxLayer from '../game/FxLayer.svelte';
  import HandView from '../game/HandView.svelte';

  let {
    line,
    pos = $bindable(0),
    who,
    endText = '',
    autoplay = false,
    keys = 'global',
    ondiscard,
  }: {
    line: Line;
    /** The step shown: 0 is the start of the turn, k the state after move k. */
    pos?: number;
    /** Whose line it is, for the caption ("คุณ", "บอท"). */
    who: string;
    /** Said after the last step (the turn's win%, the game won). */
    endText?: string;
    autoplay?: boolean;
    /** global: ← → Home End and Space anywhere on the page (the full-screen viewer); focus: only once the stage has it. */
    keys?: 'global' | 'focus';
    ondiscard?: (p: PlayerId) => void;
  } = $props();

  /** The pause between steps when playing, by speed; the fast speed also halves the animations. */
  const PAUSE = { 1: 900, 2: 400 } as const;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NONE = new Set<SlotId>();
  const EMPTY = new Map<SlotId, never>();

  let playing = $state(false);
  let speed = $state<1 | 2>(1);
  let zoom = $state<{ key: string; info: SlotInfo | null } | null>(null);
  const last = $derived(line.stops.length - 1);
  const shown = $derived(line.states[line.stops[pos] ?? 0]!);
  const ended = $derived(pos === last);
  const caption = $derived(pos === 0 ? 'ต้นเทิร์น' : `${who}: ${line.moves[pos - 1]?.label ?? ''}`);
  /** Your hand isn't dimmed here: nothing is played from it. */
  const handAll = $derived(new Set<CardId>(shown.players[0].hand));

  let root: HTMLDivElement | undefined = $state();
  let layer: HTMLDivElement | undefined = $state();
  let playButton: HTMLButtonElement | undefined = $state();
  let fx: Fx | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every jump, so a step still waiting for the DOM doesn't animate over a newer position. */
  let moveId = 0;

  $effect(() => {
    if (layer && root && !fx) fx = new Fx(layer, root);
    if (fx) fx.level = reducedMotion ? 'off' : speed === 2 ? 'fast' : 'full';
  });
  // Another line or turn: whatever was playing stops.
  $effect(() => {
    void line;
    untrack(() => {
      stop();
      fx?.finish();
      if (pos > line.stops.length - 1) pos = 0;
    });
  });
  $effect(() => {
    const start = untrack(() => autoplay) ? setTimeout(play, 600) : undefined;
    if (untrack(() => keys) === 'global') untrack(() => playButton?.focus());
    return () => {
      clearTimeout(start);
      stop();
      fx?.finish();
    };
  });

  /** Show position `to`; one step forward is animated. Returns the animation's length (ms). */
  async function go(to: number, animate = false): Promise<number> {
    to = Math.max(0, Math.min(last, to));
    const id = ++moveId;
    fx?.finish();
    if (!animate || to !== pos + 1 || !fx || !root) {
      pos = to;
      return 0;
    }
    const l = line;
    const from = l.stops[pos]!;
    const next = l.stops[to]!;
    const before = snapshot(root);
    pos = to;
    await tick();
    if (id !== moveId) return 0;
    const events = [];
    for (let i = from; i < next; i++) events.push(...animEvents(l.states[i]!, l.states[i + 1]!, l.actions[i]));
    return fx.play(events, { prev: l.states[from]!, next: l.states[next]!, before });
  }

  function stop() {
    playing = false;
    clearTimeout(timer);
  }
  async function advance() {
    if (!playing) return;
    if (pos >= last) {
      playing = false;
      return;
    }
    const ms = await go(pos + 1, true);
    if (pos >= last) playing = false;
    else if (playing) timer = setTimeout(advance, ms + PAUSE[speed]);
  }
  export function play() {
    clearTimeout(timer);
    playing = true;
    if (pos < last) void advance();
    else {
      // From the end: back to the start of the turn, a beat, then on.
      void go(0);
      timer = setTimeout(advance, PAUSE[speed]);
    }
  }
  const toggle = () => (playing ? stop() : play());
  /** Go to step `to` (a step forward animated when `animate`). */
  export function jump(to: number, animate = false) {
    stop();
    void go(to, animate);
  }

  function onkey(e: KeyboardEvent) {
    if (zoom) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        zoom = null;
      }
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea, [contenteditable]')) return;
    const inside = !!root?.contains(target);
    if (keys === 'focus' && !inside) return;
    const onButton = target.closest('button, a');
    if (e.key === 'ArrowRight') jump(pos + 1, true);
    else if (e.key === 'ArrowLeft') jump(pos - 1);
    else if (e.key === 'Home') jump(0);
    else if (e.key === 'End') jump(last);
    else if ((e.key === ' ' || e.key === 'k') && !(onButton && e.key === ' ')) toggle();
    else return;
    e.preventDefault();
  }
  const zoomSlot = (uid: SlotId, key: string) => (zoom = { key, info: slotInfo(shown, uid) });
  const zoomCard = (key: string) => (zoom = { key, info: null });
</script>

<svelte:window onkeydowncapture={onkey} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="stage" bind:this={root} tabindex={keys === 'focus' ? 0 : undefined} aria-label="สนามของเทิร์นนี้">
  <div class="table">
    <Board
      s={shown}
      targets={NONE}
      picks={EMPTY}
      abilities={EMPTY}
      onslot={() => {}}
      onzoom={zoomCard}
      onzoomslot={zoomSlot}
      ondiscard={(p) => ondiscard?.(p)}
    />
  </div>
  <div class="hand-box">
    <HandView s={shown} playable={handAll} selected={null} onpick={(c) => zoomCard(keyOf(shown, c))} onzoom={zoomCard} />
  </div>

  <div class="controls">
    <div class="buttons" role="group" aria-label="เล่นซ้ำ">
      <button type="button" class="icon" aria-label="ต้นเทิร์น" title="ต้นเทิร์น (Home)" disabled={pos === 0} onclick={() => jump(0)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 6l-8 6 8 6z" /></svg>
      </button>
      <button type="button" class="icon" aria-label="ย้อนหนึ่งขั้น" title="ย้อน (←)" disabled={pos === 0} onclick={() => jump(pos - 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button
        type="button"
        class="icon primary"
        bind:this={playButton}
        aria-label={playing ? 'หยุด' : 'เล่น'}
        title={playing ? 'หยุด (Space)' : 'เล่น (Space)'}
        onclick={toggle}
      >
        {#if playing}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5l11 7-11 7z" /></svg>
        {/if}
      </button>
      <button type="button" class="icon" aria-label="ถัดไปหนึ่งขั้น" title="ถัดไป (→)" disabled={ended} onclick={() => jump(pos + 1, true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
      <button type="button" class="icon" aria-label="จบเทิร์น" title="จบเทิร์น (End)" disabled={ended} onclick={() => jump(last)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M6 6l8 6-8 6z" /></svg>
      </button>
      <button type="button" class="speed" aria-label={`ความเร็ว ×${speed}`} title="ความเร็ว" onclick={() => (speed = speed === 1 ? 2 : 1)}>×{speed}</button>
    </div>
    <p class="caption" aria-live="polite">
      <span class="mono step">{pos}/{last}</span>
      <span class="what">{caption}</span>
      {#if ended && endText}<span class="result">· {endText}</span>{/if}
    </p>
    <div class="progress" aria-hidden="true"><span style:width={`${last ? (pos / last) * 100 : 100}%`}></span></div>
  </div>

  <FxLayer bind:layer />
  {#if zoom}<CardInfo cardKey={zoom.key} info={zoom.info} onclose={() => (zoom = null)} />{/if}
</div>

<style>
  /* The table: Board.svelte sizes its cards from this box (container query units). */
  /* It fills what its parent (a column of a set height) leaves under the tabs. */
  .stage {
    position: relative;
    flex: 1 1 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
    outline: none;
  }
  .stage:focus-visible {
    outline: 2px solid var(--ink-strong);
    outline-offset: 4px;
    border-radius: var(--radius-lg);
  }
  .table {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    container-type: size;
  }
  /* Nothing is played from the hand here: no "playable" glow, a tap reads the card. */
  .hand-box :global(.hcard.grab) {
    cursor: zoom-in;
  }
  .hand-box :global(.hcard.grab .cardbox .face) {
    box-shadow: 0 3px 8px -2px #0008;
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    opacity: 0.4;
  }
  .speed {
    min-width: 48px;
    margin-left: 6px;
    padding: 4px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--control);
    color: var(--ink-strong);
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 20px;
    transition: background-color 0.3s var(--ease);
  }
  .speed:hover {
    background: #313131;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--control);
    color: var(--ink-strong);
    transition:
      background-color 0.3s var(--ease),
      transform 0.3s var(--ease);
  }
  .icon:not(:disabled):hover {
    background: #313131;
  }
  .icon:not(:disabled):active {
    transform: scale(0.96);
  }
  .icon svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .icon svg .fill {
    fill: currentColor;
    stroke: none;
  }
  .icon.primary {
    width: 48px;
    height: 48px;
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .icon.primary:hover {
    border-color: var(--press);
    background: var(--press);
  }
  /* Play controls under the hand: buttons, what was just played, how far into the turn. */
  .controls {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 16px;
    align-items: center;
    padding: 8px 12px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
  }
  .buttons {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .caption {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    align-items: baseline;
    min-width: 0;
    margin: 0;
    font-size: 16px;
    line-height: 24px;
  }
  .caption .step {
    color: var(--ink-soft);
    font-size: 12px;
  }
  .caption .what {
    color: var(--ink-strong);
    font-weight: 500;
  }
  .caption .result {
    color: var(--ink-soft);
    font-size: 14px;
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .progress {
    grid-column: 1 / -1;
    height: 2px;
    overflow: hidden;
    border-radius: 1px;
    background: var(--control);
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--ink-strong);
    transition: width 0.3s var(--ease);
  }
  @media (max-width: 520px) {
    .controls {
      grid-template-columns: minmax(0, 1fr);
      padding: 8px;
    }
    .buttons {
      justify-content: center;
    }
    .icon {
      width: 40px;
      height: 40px;
    }
    .icon.primary {
      width: 48px;
      height: 48px;
    }
    .caption {
      justify-content: center;
      font-size: 14px;
      line-height: 20px;
    }
  }
  @media (pointer: coarse) {
    .icon,
    .speed {
      min-width: 44px;
      min-height: 44px;
    }
  }
</style>
