<script lang="ts">
  // A Pokémon in play, what the board draws small or not at all (ui/slot-info.ts): whose and where, HP left, Energy
  // and Tool by name, the cards under it, conditions and effects with what they do. In the zoomed card (CardInfo) and
  // the card text panel (Inspector).
  import { tx } from '../../i18n';
  import type { SlotInfo } from '../../ui/slot-info';

  let { info }: { info: SlotInfo } = $props();
</script>

<section class="state" aria-label={tx('สถานะในสนาม', 'In play')}>
  <div class="row">
    <span class="where">{info.owner === 0 ? tx('ของคุณ', 'Yours') : tx('ของบอท', "Bot's")} · {info.active ? tx('ตัวหลัก', 'Active') : 'Bench'}</span>
    <span class="hp mono" class:low={info.hp.left * 3 <= info.hp.max}>HP {info.hp.left}/{info.hp.max}</span>
  </div>
  <div class="hpbar"><span style:width={`${(info.hp.left / info.hp.max) * 100}%`}></span></div>
  <dl>
    <dt>{tx('พลังงาน', 'Energy')}</dt>
    <dd>
      {#if info.energy.length}
        {#each info.energy as e}<span class="chip" style={`--c:var(--t-${e.type.toLowerCase()})`}>{e.name}</span>{/each}
      {:else}{tx('ไม่มี', 'None')}{/if}
    </dd>
    {#if info.tool}<dt>Tool</dt><dd><span class="chip tool">{info.tool}</span></dd>{/if}
    {#if info.under.length}<dt>{tx('ใต้การ์ด', 'Under it')}</dt><dd>{info.under.join(' → ')}</dd>{/if}
    {#each info.conditions as c}<dt class="warn">{c.name}</dt><dd>{c.does}</dd>{/each}
    {#each info.marks as m}<dt class="warn">{tx('ผลที่ติดอยู่', 'Effect')}</dt><dd>{m}</dd>{/each}
  </dl>
</section>

<style>
  /* In play: a band above the card text. */
  .state {
    margin-bottom: 14px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--paper);
    border: 1px solid var(--rule);
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-weight: 600;
  }
  .where {
    color: var(--ink-soft);
    font-size: 14px;
  }
  .hp {
    font-size: 16px;
  }
  .hp.low {
    color: var(--stamp);
  }
  .hpbar {
    height: 6px;
    margin: 6px 0 10px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--ink) 15%, transparent);
    overflow: hidden;
  }
  .hpbar span {
    display: block;
    height: 100%;
    background: var(--hp-ok);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 14px;
  }
  dt {
    color: var(--ink-soft);
    font-weight: 600;
  }
  dt.warn {
    color: var(--stamp);
  }
  dd {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
  }
  .chip {
    padding: 0 7px;
    border-radius: var(--radius-sm);
    background: var(--c, var(--primary));
    color: #fff;
    font-size: 12px;
    font-weight: 600;
  }
  .chip.tool {
    background: var(--ink-soft);
  }
</style>
