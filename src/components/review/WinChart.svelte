<script lang="ts">
  // Win% through the game: two points per turn of yours, where it started and where it ended (review/summary.ts
  // winPoints). Your turns are solid lines, the bot's turns in between dashed, so a drop shows whose turn it came in.
  // The end of each turn of yours is marked by its verdict (a cross for a clear mistake, a triangle for "probably
  // better", a dot otherwise) and is a button: click, tap or Enter picks that turn. The picked turn is shaded and
  // labelled; hovering shows any turn's numbers.
  import { tx } from '../../i18n';
  import type { TurnReview } from '../../analysis/review';
  import { winPoints } from '../../review/summary';

  let {
    turns,
    selected = null,
    onpick,
  }: { turns: TurnReview[]; selected?: number | null; onpick?: (turn: number) => void } = $props();

  // Drawn at the box's real width (text stays 11px); a phone's chart is a little shorter.
  let W = $state(640);
  const H = $derived(W < 480 ? 120 : 150);
  const pad = { l: 36, r: 12, t: 12, b: 24 };
  const data = $derived(winPoints(turns));
  const n = $derived(Math.max(1, data.points.length - 1));
  const x = (i: number) => pad.l + (data.points.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / n);
  const y = (p: number) => pad.t + (1 - p) * (H - pad.t - pad.b);
  const byTurn = $derived(new Map(turns.map((t) => [t.turn, t])));
  const ends = $derived(data.points.filter((p) => p.at === 'end'));
  let hover = $state<number | null>(null);
  const VERDICT: Record<string, string> = {
    'missed-win': tx('พลาดชัดเจน: มีทางชนะเกม', 'Clear slip: a win was there'),
    'missed-ko': tx('พลาดชัดเจน: มีทาง KO ที่ได้ Prize มากกว่า', 'Clear slip: a bigger Knock Out was there'),
    better: tx('น่าจะมีทางที่ดีกว่า', 'Likely a better way'),
    ok: tx('ไม่เจอจุดพลาด', 'No slip found'),
  };
  const pct = (p: number) => `${Math.round(p * 100)}%`;

  function move(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best: number | null = null;
    for (const p of ends) if (best === null || Math.abs(x(p.x) - px) < Math.abs(x(best) - px)) best = p.x;
    hover = best;
  }
  const hovered = $derived(hover !== null ? data.points.find((p) => p.x === hover) : null);
  const sel = $derived(selected !== null ? byTurn.get(selected) : undefined);
  const selPts = $derived(selected !== null ? data.points.filter((p) => p.turn === selected) : []);
</script>

<figure class="chart">
  <figcaption>
    <span>{tx('win% ตลอดเกม', 'Win% over the game')}</span>
    <span class="legend" aria-hidden="true"><i class="solid"></i>{tx('ตาคุณ', 'your turns')} <i class="dash"></i>{tx('ตาบอท', "the bot's")}</span>
  </figcaption>
  <div class="plot" bind:clientWidth={W}>
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={tx('กราฟ win% ตลอดเกม (กดจุดท้ายเทิร์นของคุณเพื่อเปิดเทิร์นนั้น)', 'Win% over the game (the point ending each of your turns opens that turn)')}
      onpointermove={move}
      onpointerleave={() => (hover = null)}
    >
      {#if selPts.length === 2}
        <rect class="band" x={x(selPts[0]!.x) - 6} y={pad.t} width={x(selPts[1]!.x) - x(selPts[0]!.x) + 12} height={H - pad.t - pad.b} rx="4" />
      {/if}
      {#each [0, 0.5, 1] as g}
        <line class="grid" class:mid={g === 0.5} x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} />
        <text class="tick" x={pad.l - 6} y={y(g) + 4} text-anchor="end">{g * 100}%</text>
      {/each}
      {#each ends as p (p.x)}
        <text class="tick" x={x(p.x)} y={H - 6} text-anchor="middle">{p.turn}</text>
      {/each}
      {#if hover !== null}<line class="cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />{/if}
      {#each data.segments as s, i (i)}
        <line class={`seg ${s.whose}`} x1={x(s.from.x)} y1={y(s.from.p)} x2={x(s.to.x)} y2={y(s.to.p)} />
      {/each}
      {#each data.points.filter((p) => p.at === 'start') as p (p.x)}
        <circle class="start" cx={x(p.x)} cy={y(p.p)} r="3" />
      {/each}
      {#each ends as p (p.x)}
        {@const t = byTurn.get(p.turn)!}
        {@const cx = x(p.x)}
        {@const cy = y(p.p)}
        <g
          class={`mark ${t.verdict}`}
          class:sel={selected === t.turn}
          role="button"
          tabindex="0"
          aria-label={`${tx('เทิร์น', 'Turn')} ${t.turn}: ${VERDICT[t.verdict]}, win% ${pct(t.before)} → ${pct(t.win.p)}`}
          onclick={() => onpick?.(t.turn)}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onpick?.(t.turn))}
        >
          <circle class="hit" {cx} {cy} r="16" />
          {#if t.verdict === 'missed-win' || t.verdict === 'missed-ko'}
            <path class="ring" d={`M${cx - 6},${cy - 6}L${cx + 6},${cy + 6}M${cx + 6},${cy - 6}L${cx - 6},${cy + 6}`} />
            <path class="x" d={`M${cx - 5},${cy - 5}L${cx + 5},${cy + 5}M${cx + 5},${cy - 5}L${cx - 5},${cy + 5}`} />
          {:else if t.verdict === 'better'}
            <path class="tri" d={`M${cx},${cy - 7}L${cx + 6.5},${cy + 5}L${cx - 6.5},${cy + 5}Z`} />
          {:else}
            <circle class="dot" {cx} {cy} r="4.5" />
          {/if}
        </g>
      {/each}
    </svg>
    {#if hovered}
      {@const t = byTurn.get(hovered.turn)!}
      <div class="tip" style:left={`${(x(hovered.x) / W) * 100}%`} style:top={`${(y(hovered.p) / H) * 100}%`}>
        <strong>{tx('เทิร์น', 'Turn')} {t.turn}</strong> {pct(t.before)} → {pct(t.win.p)}
        <span>{VERDICT[t.verdict]}</span>
      </div>
    {:else if sel}
      <p class="picked">{tx('เทิร์น', 'Turn')} {sel.turn} · {tx('ก่อนเทิร์น', 'before')} {pct(sel.before)} → {tx('หลังเทิร์น', 'after')} {pct(sel.win.p)}</p>
    {/if}
  </div>
  <p class="key">
    <span class="k"><svg viewBox="0 0 12 12" aria-hidden="true"><path class="x" d="M2,2L10,10M10,2L2,10" /></svg>{tx('พลาดชัดเจน', 'Clear slip')}</span>
    <span class="k"><svg viewBox="0 0 12 12" aria-hidden="true"><path class="tri" d="M6,1L11,10H1Z" /></svg>{tx('น่าจะมีทางที่ดีกว่า', 'Likely a better way')}</span>
    <span class="k"><svg viewBox="0 0 12 12" aria-hidden="true"><circle class="dot" cx="6" cy="6" r="4" /></svg>{tx('ไม่เจอจุดพลาด', 'No slip found')}</span>
    {#if onpick}<span class="k how">{tx('แตะจุดเพื่อดูเทิร์นนั้น', 'Tap a point to see that turn')}</span>{/if}
  </p>
</figure>

<style>
  .chart {
    margin: 0;
    padding: 12px 16px;
    border: 1px solid var(--rule);
    background: var(--card-bg);
    --critical: var(--stamp);
    --warning: var(--warn);
    border-radius: var(--radius-xl);
  }
  figcaption {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
    color: var(--ink-strong);
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
  }
  .legend {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    font-weight: 400;
  }
  .legend i {
    display: inline-block;
    width: 16px;
    margin-left: 6px;
    border-top: 2px solid var(--ink-strong);
  }
  .legend i.dash {
    border-top: 2px dashed var(--ink-soft);
  }
  .plot {
    position: relative;
  }
  svg {
    display: block;
    cursor: crosshair;
    touch-action: pan-y;
  }
  .band {
    fill: color-mix(in srgb, var(--ink-strong) 8%, transparent);
  }
  .grid {
    stroke: var(--rule);
    stroke-width: 1;
  }
  .grid.mid {
    stroke: var(--ink-soft);
  }
  .tick {
    fill: var(--ink-soft);
    font-family: var(--font-mono);
    font-size: var(--fs-card);
  }
  .cross {
    stroke: var(--ink-soft);
    stroke-width: 1;
  }
  .seg {
    stroke-width: 2;
    stroke-linecap: round;
  }
  .seg.mine {
    stroke: var(--ink-strong);
  }
  .seg.theirs {
    stroke: var(--ink-soft);
    stroke-dasharray: 3 4;
  }
  .start {
    fill: var(--card-bg);
    stroke: var(--ink-soft);
    stroke-width: 1.5;
  }
  .dot {
    fill: var(--ink-strong);
    stroke: var(--card-bg);
    stroke-width: 2;
  }
  .ring {
    stroke: var(--card-bg);
    stroke-width: 6;
    stroke-linecap: round;
  }
  .x {
    stroke: var(--critical);
    stroke-width: 3;
    stroke-linecap: round;
  }
  .tri {
    fill: var(--warning);
    stroke: var(--card-bg);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  /* A point is a button: a bigger invisible circle to hit, a ring when focused from the keyboard. */
  .mark {
    cursor: pointer;
    outline: none;
  }
  .hit {
    fill: transparent;
  }
  .mark:focus-visible .hit {
    stroke: var(--ink-strong);
    stroke-width: 2;
  }
  .mark.sel .dot,
  .mark.sel .tri {
    stroke: var(--ink);
  }
  .mark.sel .ring {
    stroke: var(--ink);
    stroke-width: 7;
  }
  .tip {
    position: absolute;
    transform: translate(-50%, calc(-100% - 12px));
    padding: 4px 8px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--ink);
    font-size: 12px;
    line-height: 16px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: var(--shadow-lg);
  }
  .tip span {
    display: block;
    color: var(--ink-soft);
  }
  .picked {
    position: absolute;
    top: 0;
    right: 0;
    margin: 0;
    padding: 2px 8px;
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--ink);
    font-size: 12px;
    line-height: 16px;
    pointer-events: none;
  }
  .key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 4px 0 0;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
  }
  .k {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .k svg {
    width: 12px;
    height: 12px;
    overflow: visible;
  }
  .how {
    margin-left: auto;
  }
  /* A phone: the marks' key is left out (the turn strip under the chart has the same marks, named). */
  @media (max-width: 640px) {
    .chart {
      padding: 10px 12px;
    }
    .key {
      display: none;
    }
  }
</style>
