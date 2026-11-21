<script module lang="ts">
  /** Your turn as it went, or the bot's turn from the same start. */
  export type LineKind = 'mine' | 'bot';
</script>

<script lang="ts">
  // One of your turns played again on the table, full screen: your turn as it went, or the bot's turn from the
  // same start (TurnReview.alt.actions, replayed on the real cards). A step is one of the player's moves with
  // the choices it asked for; stepping forward plays it with the play screen's animations (ui/anim), the play
  // button steps on its own. Every card that was hidden then is shown at the side.
  import { tick, untrack } from 'svelte';
  import type { TurnReview } from '../../analysis/review';
  import { actor, apply } from '../../engine/actions';
  import { keyOf } from '../../engine/state';
  import type { Action, CardId, GameState, PlayerId, SlotId } from '../../engine/types';
  import { animEvents } from '../../ui/anim/events';
  import { Fx, snapshot } from '../../ui/anim/fx';
  import { describeAction } from '../../ui/play';
  import { slotInfo, type SlotInfo } from '../../ui/slot-info';
  import Board from '../game/Board.svelte';
  import CardFace from '../game/CardFace.svelte';
  import CardInfo from '../game/CardInfo.svelte';
  import FxLayer from '../game/FxLayer.svelte';
  import HandView from '../game/HandView.svelte';

  let {
    states,
    actions,
    turns,
    turn,
    line: startLine = 'mine',
    autoplay = false,
    onturn,
    onclose,
  }: {
    /** The replayed game (record.ts replay()) and its actions. */
    states: GameState[];
    actions: Action[];
    /** Your reviewed turns, in order. */
    turns: TurnReview[];
    turn: number;
    line?: LineKind;
    /** Start playing at once (the "ดูบอทเล่น" button). */
    autoplay?: boolean;
    onturn?: (turn: number) => void;
    onclose: () => void;
  } = $props();

  interface Line {
    states: GameState[];
    actions: Action[];
    /** The state shown at each position: 0 is the start of the turn, k the state after move k. */
    stops: number[];
    /** Move k's label (ui/play.ts describeAction). */
    labels: string[];
  }

  /** `me`'s own moves (not answers to choices) cut the turn into steps; a step ends where the next move starts. */
  function lineOf(st: GameState[], acts: Action[], me: PlayerId): Line {
    const starts: number[] = [];
    for (let i = 0; i < acts.length; i++) if (actor(st[i]!) === me && acts[i]!.t !== 'choose') starts.push(i);
    const n = st.length - 1;
    return {
      states: st,
      actions: acts,
      stops: starts.length ? [0, ...starts.slice(1), n] : [n],
      labels: starts.map((i) => describeAction(st[i]!, acts[i]!)),
    };
  }

  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const points = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}`;
  const VERDICT = {
    'missed-win': { label: '✗ พลาดชัด: มีทางชนะ', cls: 'bad' },
    'missed-ko': { label: '✗ พลาดชัด: มีทาง KO มากกว่า', cls: 'bad' },
    better: { label: '▲ น่าจะมีทางที่ดีกว่า', cls: 'warn' },
    ok: { label: '● ไม่พบจุดพลาด', cls: 'ok' },
  } as const;
  /** The pause between steps when playing, by speed; the fast speed also halves the animations. */
  const PAUSE = { 1: 900, 2: 400 } as const;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** The turn shown, by number: the list still grows while the review runs. */
  // svelte-ignore state_referenced_locally
  let cur = $state(turn);
  // svelte-ignore state_referenced_locally
  let kind = $state<LineKind>(startLine);
  let pos = $state(0);
  let playing = $state(false);
  let speed = $state<1 | 2>(1);
  let zoom = $state<{ key: string; info: SlotInfo | null } | null>(null);
  let pile = $state<PlayerId | null>(null);

  const index = $derived(Math.max(0, turns.findIndex((x) => x.turn === cur)));
  const t = $derived(turns[index]!);
  const me = $derived(actor(states[t.span.start]!));
  const mine = $derived(lineOf(states.slice(t.span.start, t.span.end + 1), actions.slice(t.span.start, t.span.end), me));
  /** The bot's turn, replayed from the same start; null when it plays like you (or can't be replayed). */
  const bot = $derived.by((): Line | null => {
    if (!t.alt?.actions) return null;
    try {
      const st = [states[t.span.start]!];
      for (const a of t.alt.actions) st.push(apply(st[st.length - 1]!, a, { trusted: true }));
      return lineOf(st, t.alt.actions, me);
    } catch {
      return null;
    }
  });
  const L = $derived(kind === 'bot' && bot ? bot : mine);
  const last = $derived(L.stops.length - 1);
  const shown = $derived(L.states[L.stops[pos] ?? 0]!);
  const ended = $derived(pos === last);
  const who = $derived(kind === 'bot' && bot ? 'บอท' : 'คุณ');
  const split = $derived(t.alt ? t.alt.split : -1);
  const caption = $derived(pos === 0 ? `ต้นเทิร์น ${t.turn}` : `${who}: ${L.labels[pos - 1] ?? ''}`);
  /** Your hand isn't dimmed here: nothing is played from it. */
  const handAll = $derived(new Set<CardId>(shown.players[0].hand));
  const NONE = new Set<SlotId>();
  const EMPTY = new Map<SlotId, never>();
  const hidden = $derived([
    ['มือบอท', shown.players[1].hand],
    ['Prize ของบอท', shown.players[1].prizes],
    ['Prize ของคุณ', shown.players[0].prizes],
  ] as const);

  let dialog: HTMLDialogElement | undefined = $state();
  let playButton: HTMLButtonElement | undefined = $state();
  let layer: HTMLDivElement | undefined = $state();
  let fx: Fx | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every jump, so a step still waiting for the DOM doesn't animate over a newer position. */
  let moveId = 0;

  $effect(() => {
    const d = dialog;
    if (!d) return;
    if (!d.open) d.showModal();
    // Space then plays (on the close button it would close).
    untrack(() => playButton?.focus());
    const start = untrack(() => autoplay) ? setTimeout(play, 600) : undefined;
    return () => {
      clearTimeout(start);
      stop();
      fx?.finish();
    };
  });
  $effect(() => {
    if (layer && dialog && !fx) fx = new Fx(layer, dialog);
    if (fx) fx.level = reducedMotion ? 'off' : speed === 2 ? 'fast' : 'full';
  });

  /** Show position `to`; one step forward is animated. Returns the animation's length (ms). */
  async function go(to: number, animate = false): Promise<number> {
    to = Math.max(0, Math.min(last, to));
    const id = ++moveId;
    fx?.finish();
    if (!animate || to !== pos + 1 || !fx || !dialog) {
      pos = to;
      return 0;
    }
    const line = L;
    const from = line.stops[pos]!;
    const next = line.stops[to]!;
    const before = snapshot(dialog);
    pos = to;
    await tick();
    if (id !== moveId) return 0;
    const events = [];
    for (let i = from; i < next; i++) events.push(...animEvents(line.states[i]!, line.states[i + 1]!, line.actions[i]));
    return fx.play(events, { prev: line.states[from]!, next: line.states[next]!, before });
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
  function play() {
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
  function jump(to: number, animate = false) {
    stop();
    void go(to, animate);
  }

  /** Your turn or the bot's: keep the position up to where they part, so the two can be compared there. */
  function pick(k: LineKind) {
    if (k === kind) return;
    stop();
    fx?.finish();
    const keep = split >= 0 ? Math.min(pos, split) : 0;
    kind = k;
    pos = keep;
  }
  function toTurn(i: number) {
    if (i < 0 || i >= turns.length) return;
    stop();
    fx?.finish();
    cur = turns[i]!.turn;
    kind = 'mine';
    pos = 0;
    pile = null;
    onturn?.(turns[i]!.turn);
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape' && zoom) {
      // The card closes first; keep the replay open.
      e.preventDefault();
      zoom = null;
      return;
    }
    if (zoom || e.altKey || e.ctrlKey || e.metaKey) return;
    const onButton = (e.target as HTMLElement).closest('button, a, input, select');
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

<svelte:window onkeydowncapture={(e) => dialog?.open && onkey(e)} />

<dialog
  bind:this={dialog}
  class="replay"
  aria-label={`รีเพลย์เทิร์น ${t.turn}`}
  oncancel={(e) => {
    e.preventDefault();
    if (zoom) zoom = null;
    else onclose();
  }}
>
  <div class="rp">
    <div class="first">
    <header class="top">
      <button type="button" class="icon close" aria-label="ปิด" title="ปิด (Esc)" onclick={onclose}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <strong class="title">เทิร์น {t.turn}</strong>
      <span class={`badge ${VERDICT[t.verdict].cls}`}>{VERDICT[t.verdict].label}</span>
      <span class="mono win" title="win% ตอนเริ่มเทิร์น → หลังจบเทิร์นที่คุณเล่น">{pct(t.before)} → {pct(t.win.p)}</span>
      <span class="turn-nav">
        <button type="button" class="ghost" disabled={index === 0} onclick={() => toTurn(index - 1)}>‹ <span class="lw">เทิร์น</span>ก่อน</button>
        <button type="button" class="ghost" disabled={index === turns.length - 1} onclick={() => toTurn(index + 1)}><span class="lw">เทิร์น</span>ถัดไป ›</button>
      </span>
    </header>

    <div class="stage">
      <div class="seg" role="tablist" aria-label="ดูเทิร์นนี้แบบ">
        <button type="button" role="tab" aria-selected={kind === 'mine'} class:on={kind === 'mine'} onclick={() => pick('mine')}>
          คุณเล่น <span class="mono">{pct(t.win.p)}</span>
        </button>
        {#if bot && t.alt}
          <button type="button" role="tab" aria-selected={kind === 'bot'} class:on={kind === 'bot'} onclick={() => pick('bot')}>
            บอทจะเล่น <span class="mono">{pct(t.alt.win.p)}</span>
            <span class="mono diff" class:up={t.alt.diff > 0}>{points(t.alt.diff)}</span>
          </button>
        {:else}
          <span class="same">บอทก็เล่นแบบเดียวกัน</span>
        {/if}
      </div>

      <div class="table">
        <Board
          s={shown}
          targets={NONE}
          picks={EMPTY}
          abilities={EMPTY}
          onslot={() => {}}
          onzoom={zoomCard}
          onzoomslot={zoomSlot}
          ondiscard={(p) => (pile = pile === p ? null : p)}
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
          <button type="button" class="icon primary" bind:this={playButton} aria-label={playing ? 'หยุด' : 'เล่น'} title={playing ? 'หยุด (Space)' : 'เล่น (Space)'} onclick={toggle}>
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
          {#if ended}
            <span class="result">
              {shown.winner === me ? '· ชนะเกม' : shown.winner !== null ? '· จบเกม' : `· หลังจบเทิร์น win% ${pct(kind === 'bot' && t.alt ? t.alt.win.p : t.win.p)}`}
            </span>
          {/if}
        </p>
        <div class="progress" aria-hidden="true"><span style:width={`${last ? (pos / last) * 100 : 100}%`}></span></div>
      </div>
    </div>
    </div>

    <aside class="side" aria-label="รายละเอียดเทิร์น">
      <h3>{kind === 'bot' && bot ? 'บอทจะเล่นแบบนี้' : 'ที่คุณเล่น'}</h3>
      <ol class="steps">
        <li class:on={pos === 0}>
          <button type="button" onclick={() => jump(0)}><span class="no mono">0</span>ต้นเทิร์น</button>
        </li>
        {#each L.labels as label, k (k)}
          <li class:on={pos === k + 1} class:done={pos > k + 1} class:split={k === split}>
            <button type="button" onclick={() => jump(k + 1, pos === k)}><span class="no mono">{k + 1}</span>{label}</button>
            {#if k === split}
              <p class="part">
                {#if kind === 'bot' && bot}
                  บอทเล่นต่างจากคุณตรงนี้{t.alt?.why ? `: ${t.alt.why}` : ''}
                {:else if bot}
                  ตรงนี้บอทจะเล่นต่างออกไป
                {/if}
              </p>
            {/if}
          </li>
        {/each}
        {#if !L.labels.length}<li class="muted">จบเทิร์นโดยไม่ทำอะไร</li>{/if}
      </ol>
      {#if bot && t.alt}
        <p class="muted">
          {kind === 'bot' ? 'ถ้าเล่นแบบบอท' : 'ถ้าเล่นแบบบอทแทน'} win% {pct(t.alt.win.p)} ({points(t.alt.diff)} จุดจากที่คุณเล่น)
        </p>
      {/if}
      {#if t.missed}
        <p class="bad-text">
          {t.missed.kind === 'win' ? 'มีทางชนะเกมในเทิร์นนี้' : `มีทาง KO ได้ ${t.missed.prizes} Prize (คุณได้ ${t.missed.took})`}:
          {t.missed.line.join(' → ')}
        </p>
      {/if}

      {#if pile !== null}
        {@const ids = shown.players[pile].discard}
        <h4>
          กองทิ้ง{pile === 0 ? 'ของคุณ' : 'ของบอท'} ({ids.length})
          <button type="button" class="link" onclick={() => (pile = null)}>ซ่อน</button>
        </h4>
        <div class="cards">
          {#each ids as c (c)}
            <button type="button" onclick={() => zoomCard(keyOf(shown, c))}><CardFace cardKey={keyOf(shown, c)} /></button>
          {/each}
        </div>
      {/if}
      <p class="muted small">การ์ดที่ตอนนั้นมองไม่เห็น เปิดให้ดูทั้งหมด</p>
      {#each hidden as [label, ids] (label)}
        <h4>{label} ({ids.length})</h4>
        <div class="cards">
          {#each ids as c (c)}
            <button type="button" onclick={() => zoomCard(keyOf(shown, c))}><CardFace cardKey={keyOf(shown, c)} /></button>
          {/each}
        </div>
      {/each}
      <p class="keys muted small">← → ทีละขั้น · Space เล่น/หยุด · Esc ปิด</p>
    </aside>
  </div>

  <FxLayer bind:layer />
  {#if zoom}<CardInfo cardKey={zoom.key} info={zoom.info} onclose={() => (zoom = null)} />{/if}
</dialog>

<style>
  :global(html:has(dialog.replay[open])) {
    overflow: hidden;
  }
  .replay {
    width: 100vw;
    max-width: none;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: var(--paper);
    color: var(--ink);
  }
  .replay::backdrop {
    background: #000;
  }
  .rp {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 8px 12px;
    height: 100%;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  }
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
    line-height: 16px;
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  /* The header and the table: grid items on wide screens, the first screen on narrow ones. */
  .first {
    display: contents;
  }
  /* Header: the turn, its verdict and win%, the other turns. */
  .top {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    min-width: 0;
  }
  .title {
    color: var(--ink-strong);
    font-size: 18px;
    line-height: 28px;
    font-weight: 600;
  }
  .win {
    color: var(--ink-soft);
    font-size: 14px;
  }
  .turn-nav {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }
  .badge {
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
  }
  .badge.bad {
    background: var(--stamp);
    color: #fff;
  }
  .badge.warn {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .badge.ok {
    border: 1px solid var(--line);
    color: var(--ink-soft);
  }

  button {
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    opacity: 0.4;
  }
  .ghost,
  .speed {
    padding: 4px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--control);
    color: var(--ink-strong);
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    transition: background-color 0.3s var(--ease);
  }
  .ghost:not(:disabled):hover,
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
  .close {
    width: 36px;
    height: 36px;
  }

  /* The table: Board.svelte sizes its cards from this box (container query units). */
  .stage {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
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

  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    align-self: flex-start;
    padding: 4px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
  }
  .seg button {
    display: inline-flex;
    gap: 8px;
    align-items: baseline;
    padding: 4px 12px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    transition: background-color 0.3s var(--ease);
  }
  .seg button.on {
    background: var(--control);
    color: var(--ink-strong);
  }
  .seg .diff {
    font-size: 12px;
    color: var(--stamp);
  }
  .seg .diff.up {
    color: var(--accent);
  }
  .same {
    padding: 4px 12px;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
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
  .speed {
    min-width: 48px;
    margin-left: 6px;
    font-family: var(--font-mono);
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
    color: var(--ink-faint);
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

  /* The side: the moves (each one a jump), where the bot parts from you, the hidden cards. */
  .side {
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
    font-size: 14px;
    line-height: 20px;
  }
  .side h3 {
    margin: 0 0 12px;
    color: var(--ink-strong);
    font-size: 16px;
    line-height: 24px;
  }
  .side h4 {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin: 16px 0 8px;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
  }
  .side p {
    margin: 12px 0 0;
  }
  .steps {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .steps button {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--ink-faint);
    text-align: left;
    transition:
      background-color 0.3s var(--ease),
      color 0.3s var(--ease);
  }
  .steps button:hover {
    background: var(--raised);
  }
  .steps .done button {
    color: var(--ink-soft);
  }
  .steps .on button {
    background: var(--control);
    color: var(--ink-strong);
    font-weight: 500;
  }
  .no {
    flex: 0 0 auto;
    min-width: 16px;
    color: var(--ink-faint);
    font-size: 12px;
  }
  /* Where your turn and the bot's part. */
  .steps .split button {
    text-decoration: underline 2px var(--stamp);
    text-underline-offset: 4px;
  }
  .steps .part {
    margin: 2px 0 6px 32px;
    color: var(--ink);
    font-size: 12px;
    line-height: 16px;
  }
  .bad-text {
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--stamp) 40%, transparent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--stamp) 10%, transparent);
    color: var(--ink);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    gap: 6px;
  }
  .cards button {
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-soft);
    font-size: 12px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .keys {
    margin-top: 24px;
  }
  @media (hover: none) {
    .keys {
      display: none;
    }
  }

  /* Narrow screens: the table, hand and controls fill the first screen; the moves and cards follow below. */
  @media (max-width: 900px) {
    .replay {
      overflow-y: auto;
    }
    .rp {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto;
      height: auto;
      padding: 0 8px calc(8px + env(safe-area-inset-bottom));
    }
    .first {
      display: flex;
      flex-direction: column;
      gap: 6px;
      height: 100dvh;
      padding: 6px 0 8px;
    }
    .stage {
      flex: 1 1 0;
    }
    .side {
      overflow: visible;
    }
    .turn-nav {
      margin-left: 0;
    }
    .win {
      display: none;
    }
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
      width: 36px;
      height: 36px;
    }
    .icon.primary {
      width: 44px;
      height: 44px;
    }
    .caption {
      justify-content: center;
      font-size: 14px;
      line-height: 20px;
    }
    .top .badge,
    .lw {
      display: none;
    }
  }
</style>
