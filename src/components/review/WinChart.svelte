<script lang="ts">
  // Win% after each of your turns: one line, a marker per turn (a cross for a clear mistake, a triangle
  // for "probably better", a dot otherwise), 50% as the reference. Hover for a turn's readout; the turn list
  // below the chart is its table view (and where a turn is picked).
  import type { TurnReview } from '../../analysis/review';

  let { turns, selected = null }: { turns: TurnReview[]; selected?: number | null } = $props();

  // Drawn at the box's real width (text stays 11px), a fixed height.
  let W = $state(640);
  const H = 180;
  const pad = { l: 40, r: 14, t: 14, b: 26 };
  const pts = $derived([...turns].sort((a, b) => a.turn - b.turn));
  const x = (i: number) => pad.l + (pts.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (pts.length - 1));
  const y = (p: number) => pad.t + (1 - p) * (H - pad.t - pad.b);
  const path = $derived(pts.map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(t.win.p).toFixed(1)}`).join(' '));
  let hover = $state<number | null>(null);
  const VERDICT: Record<string, string> = {
    'missed-win': 'พลาดชัด: มีทางชนะ',
    'missed-ko': 'พลาดชัด: มีทาง KO มากกว่า',
    better: 'น่าจะมีทางที่ดีกว่า',
    ok: 'ไม่พบจุดพลาด',
  };

  function move(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    hover = pts.length ? best : null;
  }
  const shown = $derived(hover !== null ? pts[hover] : null);
</script>

<figure class="chart">
  <figcaption>win% หลังจบเทิร์นของคุณ</figcaption>
  <div class="plot" bind:clientWidth={W}>
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="กราฟ win% หลังจบเทิร์นของคุณแต่ละเทิร์น"
      onpointermove={move}
      onpointerleave={() => (hover = null)}
    >
      {#each [0, 0.5, 1] as g}
        <line class="grid" class:mid={g === 0.5} x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} />
        <text class="tick" x={pad.l - 6} y={y(g) + 4} text-anchor="end">{g * 100}%</text>
      {/each}
      {#each pts as t, i (t.turn)}
        <text class="tick" x={x(i)} y={H - 8} text-anchor="middle">{t.turn}</text>
      {/each}
      {#if hover !== null}<line class="cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />{/if}
      <path class="line" d={path} />
      {#each pts as t, i (t.turn)}
        {@const cx = x(i)}
        {@const cy = y(t.win.p)}
        <g class={`mark ${t.verdict}`} class:sel={selected === t.turn}>
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
    {#if shown}
      <div class="tip" style:left={`${(x(hover!) / W) * 100}%`} style:top={`${(y(shown.win.p) / H) * 100}%`}>
        <strong>{Math.round(shown.win.p * 100)}%</strong> หลังเทิร์น {shown.turn}
        <span>{VERDICT[shown.verdict]}</span>
      </div>
    {/if}
  </div>
  <p class="key">
    <span class="k"><svg viewBox="0 0 12 12" aria-hidden="true"><path class="x" d="M2,2L10,10M10,2L2,10" /></svg>พลาดชัด</span>
    <span class="k"><svg viewBox="0 0 12 12" aria-hidden="true"><path class="tri" d="M6,1L11,10H1Z" /></svg>น่าจะมีทางที่ดีกว่า</span>
    <span class="k"><svg viewBox="0 0 12 12" aria-hidden="true"><circle class="dot" cx="6" cy="6" r="4" /></svg>ไม่พบจุดพลาด</span>
  </p>
</figure>

<style>
  .chart {
    margin: 32px 0 0;
    padding: 16px;
    border: 1px solid var(--rule);
    background: var(--card-bg);
    --critical: var(--stamp);
    --warning: var(--accent);
    border-radius: var(--radius-xl);
  }
  figcaption {
    margin-bottom: 8px;
    color: var(--ink-strong);
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
  }
  .plot {
    position: relative;
  }
  svg {
    display: block;
    cursor: crosshair;
    touch-action: pan-y;
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
    font-size: 11px;
  }
  .cross {
    stroke: var(--ink-soft);
    stroke-width: 1;
  }
  .line {
    fill: none;
    stroke: var(--primary);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .dot {
    fill: var(--primary);
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
    background: var(--paper);
    color: var(--ink);
    font-size: 0.78rem;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 4px 10px -4px #0008;
  }
  .tip span {
    display: block;
    color: var(--ink-soft);
  }
  .key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 4px 0 0;
    color: var(--ink-soft);
    font-size: 0.78rem;
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
</style>
