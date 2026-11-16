<script lang="ts">
  // "ภัยเทิร์นหน้า": if you end your turn now, what the opponent can do on theirs (src/analysis/threat.ts).
  // The report arrives a batch of samples at a time; `stale` = it is for your previous move this turn.
  import type { ThreatReport } from '../../analysis/threat';

  let { report, done, stale = false }: { report: ThreatReport | null; done: boolean; stale?: boolean } = $props();

  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const rows = $derived(report ? [...report.slots].sort((a, b) => b.chance - a.chance || b.hit - a.hit) : []);
  const heat = (p: number) => (p >= 0.5 ? 'hot' : p >= 0.15 ? 'warm' : p > 0 ? 'cool' : '');
</script>

<section class="threat" class:stale aria-label="ภัยเทิร์นหน้า">
  <h3>ภัยเทิร์นหน้า <span class="sub">ถ้าจบเทิร์นตอนนี้</span></h3>
  {#if !report || !report.samples}
    <p class="muted">กำลังคำนวณ…</p>
  {:else}
    <p class="sum">
      {#if report.expected === 0}
        ไม่มีทาง KO ในแบบที่จำลอง
      {:else}
        เขาน่าจะได้ <strong class="mono">{report.expected.toFixed(1)}</strong> Prize
        {#if report.winChance >= 0.01}· <strong class="lose">ชนะเกมเทิร์นหน้า {pct(report.winChance)}</strong>{/if}
      {/if}
    </p>
    <ul class="rows">
      {#each rows as x (x.uid)}
        <li class={heat(x.chance)}>
          <div class="row">
            <span class="name">{x.name}{x.active ? ' · ตัวหลัก' : ''}</span>
            <span class="mono ko">{x.ko ? `KO ${pct(x.chance)}` : '—'}</span>
          </div>
          {#if x.ko}
            <p class="how">ส่วนใหญ่: {x.lines[0]?.label || 'ผลระหว่างเทิร์น (เช่น พิษ)'} · เสีย {x.prizes} Prize</p>
          {:else if x.hit}
            <p class="how">รอด แต่โดนเฉลี่ย {Math.round(x.damage / x.hit)} ใน {pct(x.hit / report.samples)} ของแบบที่จำลอง</p>
          {/if}
        </li>
      {/each}
    </ul>
    <p class="note">
      จำลอง {report.samples} แบบ{done ? '' : '…'} สุ่มมือและเด็คของเขาจากการ์ดที่คุณยังไม่เห็น (ตาม list อ้างอิง) แล้วให้บอทแบบกฎที่คิดเร็วเล่นเทิร์นของเขา
      {#if report.calibrated}ตัวเลขปรับตามผลจริงจากเกมกับบอทของเด็คนี้แล้ว{/if}
      เป็นค่าประมาณ
    </p>
  {/if}
</section>

<style>
  .threat {
    padding: 10px 12px;
    border: 1.5px solid var(--stamp);
    background: var(--card-bg);
    font-size: 0.85rem;
    transition: opacity 0.15s ease;
  }
  .threat.stale {
    opacity: 0.55;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 0.95rem;
  }
  .sub {
    margin-left: 4px;
    color: var(--ink-soft);
    font-size: 0.75rem;
    font-weight: 400;
  }
  .sum {
    margin: 0 0 6px;
    line-height: 1.45;
  }
  .lose {
    color: var(--stamp);
  }
  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rows li {
    padding: 4px 0 4px 8px;
    border-left: 3px solid var(--rule);
    border-bottom: 1px dashed var(--rule);
  }
  .rows li.cool {
    border-left-color: #8a8f8b;
  }
  .rows li.warm {
    border-left-color: #c8941f;
  }
  .rows li.hot {
    border-left-color: var(--stamp);
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .hot .ko {
    color: var(--stamp);
    font-weight: 700;
  }
  .warm .ko {
    font-weight: 700;
  }
  .how {
    margin: 2px 0 0;
    color: var(--ink-soft);
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .muted {
    margin: 0;
    color: var(--ink-soft);
  }
  .note {
    margin: 8px 0 0;
    color: var(--ink-soft);
    font-size: 0.72rem;
    line-height: 1.4;
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
