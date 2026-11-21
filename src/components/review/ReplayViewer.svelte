<script module lang="ts">
  /** Your turn as it went, or the bot's turn from the same start. */
  export type LineKind = 'mine' | 'bot';
</script>

<script lang="ts">
  // One of your turns played again on the table, full screen (phones; the review page embeds the stage on a
  // computer): your turn as it went, or the bot's from the same start (TurnReview.alt.actions, replayed on the real
  // cards), stepped through on ReplayStage. Every card that was hidden then is shown below.
  import { untrack } from 'svelte';
  import type { TurnReview } from '../../analysis/review';
  import { keyOf } from '../../engine/state';
  import type { Action, GameState, PlayerId } from '../../engine/types';
  import { turnLines } from '../../review/summary';
  import CardFace from '../game/CardFace.svelte';
  import CardInfo from '../game/CardInfo.svelte';
  import ReplayStage from './ReplayStage.svelte';

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

  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const points = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}`;
  const VERDICT = {
    'missed-win': { label: '✗ พลาดชัด: มีทางชนะ', cls: 'bad' },
    'missed-ko': { label: '✗ พลาดชัด: มีทาง KO มากกว่า', cls: 'bad' },
    better: { label: '▲ น่าจะมีทางที่ดีกว่า', cls: 'warn' },
    ok: { label: '● ไม่พบจุดพลาด', cls: 'ok' },
  } as const;

  /** The turn shown, by number: the list still grows while the review runs. */
  // svelte-ignore state_referenced_locally
  let cur = $state(turn);
  // svelte-ignore state_referenced_locally
  let kind = $state<LineKind>(startLine);
  let pos = $state(0);
  let zoom = $state<string | null>(null);
  let pile = $state<PlayerId | null>(null);
  let stage: ReplayStage | undefined = $state();

  const index = $derived(Math.max(0, turns.findIndex((x) => x.turn === cur)));
  const t = $derived(turns[index]!);
  const lines = $derived(turnLines(states, actions, t));
  const me = $derived(lines.me);
  const bot = $derived(lines.bot);
  const L = $derived(kind === 'bot' && bot ? bot : lines.mine);
  const shown = $derived(L.states[L.stops[pos] ?? 0]!);
  const split = $derived(t.alt ? t.alt.split : -1);
  const endText = $derived(
    shown.winner === me ? 'ชนะเกม' : shown.winner !== null ? 'จบเกม' : `หลังจบเทิร์น win% ${pct(kind === 'bot' && t.alt ? t.alt.win.p : t.win.p)}`,
  );
  const hidden = $derived([
    ['มือบอท', shown.players[1].hand],
    ['Prize ของบอท', shown.players[1].prizes],
    ['Prize ของคุณ', shown.players[0].prizes],
  ] as const);

  let dialog: HTMLDialogElement | undefined = $state();
  $effect(() => {
    const d = dialog;
    if (d && !d.open) untrack(() => d.showModal());
  });

  /** Your turn or the bot's: keep the position up to where they part, so the two can be compared there. */
  function pick(k: LineKind) {
    if (k === kind) return;
    const keep = split >= 0 ? Math.min(pos, split) : 0;
    kind = k;
    pos = keep;
  }
  function toTurn(i: number) {
    if (i < 0 || i >= turns.length) return;
    cur = turns[i]!.turn;
    kind = 'mine';
    pos = 0;
    pile = null;
    onturn?.(turns[i]!.turn);
  }
</script>

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
        <span class="mono win" title="win% ก่อนเทิร์น → หลังเทิร์นที่คุณเล่น">{pct(t.before)} → {pct(t.win.p)}</span>
        <span class="turn-nav">
          <button type="button" class="ghost" disabled={index === 0} onclick={() => toTurn(index - 1)}>‹ <span class="lw">เทิร์น</span>ก่อน</button>
          <button type="button" class="ghost" disabled={index === turns.length - 1} onclick={() => toTurn(index + 1)}><span class="lw">เทิร์น</span>ถัดไป ›</button>
        </span>
      </header>

      <div class="stage-box">
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
        {#key `${t.turn}:${kind}`}
          <ReplayStage
            bind:this={stage}
            line={L}
            bind:pos
            who={kind === 'bot' && bot ? 'บอท' : 'คุณ'}
            {endText}
            autoplay={autoplay && kind === startLine && t.turn === turn}
            ondiscard={(p) => (pile = pile === p ? null : p)}
          />
        {/key}
      </div>
    </div>

    <aside class="side" aria-label="รายละเอียดเทิร์น">
      <h3>{kind === 'bot' && bot ? 'บอทจะเล่นแบบนี้' : 'ที่คุณเล่น'}</h3>
      <ol class="steps">
        <li class:on={pos === 0}>
          <button type="button" onclick={() => stage?.jump(0)}><span class="no mono">0</span>ต้นเทิร์น</button>
        </li>
        {#each L.moves as m, k (k)}
          <li class:on={pos === k + 1} class:done={pos > k + 1} class:split={k === split}>
            <button type="button" onclick={() => stage?.jump(k + 1, pos === k)}><span class="no mono">{k + 1}</span>{m.label}</button>
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
        {#if !L.moves.length}<li class="muted">จบเทิร์นโดยไม่ทำอะไร</li>{/if}
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
            <button type="button" onclick={() => (zoom = keyOf(shown, c))}><CardFace cardKey={keyOf(shown, c)} /></button>
          {/each}
        </div>
      {/if}
      <p class="muted small">การ์ดที่ตอนนั้นมองไม่เห็น เปิดให้ดูทั้งหมด</p>
      {#each hidden as [label, ids] (label)}
        <h4>{label} ({ids.length})</h4>
        <div class="cards">
          {#each ids as c (c)}
            <button type="button" onclick={() => (zoom = keyOf(shown, c))}><CardFace cardKey={keyOf(shown, c)} /></button>
          {/each}
        </div>
      {/each}
      <p class="keys muted small">← → ทีละขั้น · Space เล่น/หยุด · Esc ปิด</p>
    </aside>
  </div>

  {#if zoom}<CardInfo cardKey={zoom} onclose={() => (zoom = null)} />{/if}
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
  .ghost {
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
  .ghost:not(:disabled):hover {
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
  .close {
    width: 36px;
    height: 36px;
  }

  /* The tabs and the stage under them. */
  .stage-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
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
    color: var(--ink-soft);
    text-align: left;
    transition:
      background-color 0.3s var(--ease),
      color 0.3s var(--ease);
  }
  .steps button:hover {
    background: var(--raised);
  }
  .steps .done button {
    color: var(--ink);
  }
  .steps .on button {
    background: var(--control);
    color: var(--ink-strong);
    font-weight: 500;
  }
  .no {
    flex: 0 0 auto;
    min-width: 16px;
    color: var(--ink-soft);
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
    .stage-box {
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
    .top .badge,
    .lw {
      display: none;
    }
  }
</style>
