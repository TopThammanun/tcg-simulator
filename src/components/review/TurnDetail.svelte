<script lang="ts">
  // One reviewed turn, read at a glance: its verdict and win% before → after (with what win% means a tap away), a clear
  // mistake's line, and where your turn and the bot's part: the moves you both made alike folded into one line, then
  // the two ways from there as cards, and why the bot plays its way. A turn with nothing to see is one line.
  import { BETTER_BY, type TurnReview, type Verdict } from '../../analysis/review';
  import type { Line, Move } from '../../review/summary';
  import CardFace from '../game/CardFace.svelte';

  let {
    t,
    mine,
    bot,
    gameId,
    onwatch,
  }: {
    t: TurnReview;
    mine: Line | null;
    bot: Line | null;
    gameId: number;
    /** Phones: open the turn on the table, full screen (a computer has it beside this). */
    onwatch?: (line: 'mine' | 'bot') => void;
  } = $props();

  const VERDICT: Record<Verdict, { label: string; cls: string }> = {
    'missed-win': { label: '✗ พลาดชัด: มีทางชนะ', cls: 'bad' },
    'missed-ko': { label: '✗ พลาดชัด: มีทาง KO มากกว่า', cls: 'bad' },
    better: { label: '▲ น่าจะมีทางที่ดีกว่า', cls: 'warn' },
    ok: { label: '● ไม่พบจุดพลาด', cls: 'ok' },
  };
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  /** Moves shown before "อีก N ขั้น". */
  const FIRST = 4;
  const pts = (d: number) => Math.abs(Math.round(d * 100));

  const myMoves = $derived<Move[]>(mine?.moves ?? t.played.map((label) => ({ label, key: null })));
  const botMoves = $derived<Move[]>(bot?.moves ?? t.alt?.played.map((label) => ({ label, key: null })) ?? []);
  const split = $derived(t.alt?.split ?? 0);
  /** The bot plays another way, but it gains little: one line. */
  const quiet = $derived(!!t.alt && t.verdict === 'ok' && t.alt.diff < BETTER_BY);
  /** Win% fell a lot this turn although the bot had nothing clearly better. */
  const fell = $derived(t.verdict === 'ok' && t.before - t.win.p >= BETTER_BY ? pts(t.before - t.win.p) : 0);
  const botFirst = $derived(botMoves[split]);
</script>

{#snippet move(m: Move)}
  <li>
    {#if m.key}<span class="thumb"><CardFace cardKey={m.key} /></span>{:else}<span class="thumb none" aria-hidden="true"></span>{/if}
    <span>{m.label}</span>
  </li>
{/snippet}

<!-- A long turn shows its first moves; the rest open on a tap. -->
{#snippet moves(list: Move[])}
  {@const all = list.length ? list : [{ label: 'จบเทิร์นโดยไม่ทำอะไร', key: null }]}
  <ol class="moves">
    {#each all.slice(0, FIRST) as m, i (i)}{@render move(m)}{/each}
  </ol>
  {#if all.length > FIRST}
    <details class="rest">
      <summary>อีก {all.length - FIRST} ขั้น</summary>
      <ol class="moves" start={FIRST + 1}>
        {#each all.slice(FIRST) as m, i (i)}{@render move(m)}{/each}
      </ol>
    </details>
  {/if}
{/snippet}

<section class="turn-detail" aria-label={`เทิร์น ${t.turn}`}>
  <header>
    <h2>เทิร์น {t.turn}</h2>
    <span class={`badge ${VERDICT[t.verdict].cls}`}>{VERDICT[t.verdict].label}</span>
  </header>
  <p class="nums">
    <span>ก่อนเทิร์น <strong class="mono">{pct(t.before)}</strong></span>
    <span aria-hidden="true">→</span>
    <span>หลังเทิร์น <strong class="mono">{pct(t.win.p)}</strong></span>
  </p>
  <details class="what">
    <summary>win% คืออะไร</summary>
    <p>
      โอกาสชนะถ้าจากตรงนั้นทั้งสองฝั่งเล่นแบบบอท ตามที่ network ของบอท (ตัวเดียวกับที่คุณเล่นด้วย) ประเมิน
      เฉลี่ยจากการสุ่มการ์ดที่คุณมองไม่เห็นใหม่ 16 แบบ · พลาดชัด = ตัววางแผนโจมตีหาทางที่ชนะหรือได้ Prize มากกว่า และทางนั้นใช้ได้ทุกแบบที่สุ่มใหม่
      · น่าจะมีทางที่ดีกว่า = ถ้าเล่นเทิร์นนั้นแบบบอท win% สูงกว่าอย่างน้อย 10 จุด · เป็นค่าประมาณ ใช้เป็นจุดที่ควรลองดูซ้ำ
    </p>
  </details>

  {#if t.missed}
    <p class="bad-text">
      <strong>{t.missed.kind === 'win' ? 'มีทางชนะเกมในเทิร์นนี้' : `มีทาง KO ได้ ${t.missed.prizes} Prize (คุณได้ ${t.missed.took})`}</strong>
      {t.missed.at === t.span.start ? 'ตั้งแต่ต้นเทิร์น' : 'ตอนที่คุณเลือกจบเทิร์น'}: {t.missed.line.join(' → ')}
    </p>
  {/if}

  {#if t.alt && !quiet}
    {#if split > 0}<p class="alike">{split} ขั้นแรกเล่นเหมือนบอท</p>{/if}
    <div class="ways">
      <div class="way">
        <span class="tag">คุณเล่น{split > 0 ? 'ต่อ' : ''}</span>
        {@render moves(myMoves.slice(split))}
      </div>
      <div class="way bot">
        <span class="tag">บอทจะเล่น{split > 0 ? 'ต่อ' : ''}</span>
        {@render moves(botMoves.slice(split))}
      </div>
    </div>
    {#if t.alt.why && botFirst}<p class="why">ตรงนี้บอทจะ{botFirst.label} เพราะ{t.alt.why}</p>{/if}
    <p class="muted">ถ้าเล่นแบบบอท win% {pct(t.alt.win.p)} ({t.alt.diff >= 0 ? '+' : '−'}{pts(t.alt.diff)} จุด)</p>
  {:else}
    <p class="one">
      {#if t.alt}บอทเล่นต่างออกไปเล็กน้อย (ถ้าเล่นแบบบอท win% {pct(t.alt.win.p)}, {t.alt.diff >= 0 ? '+' : '−'}{pts(t.alt.diff)} จุด){:else}บอทก็เล่นแบบเดียวกัน{/if}
    </p>
    {#if !t.missed}
      <details class="played">
        <summary>ที่คุณเล่น ({myMoves.length} ขั้น)</summary>
        {@render moves(myMoves)}
      </details>
    {/if}
  {/if}
  {#if fell}<p class="muted">win% ลด {fell} จุดในเทิร์นนี้ แต่บอทเองก็ไม่มีทางที่ดีกว่าชัดเจนในเทิร์นนี้</p>{/if}

  <div class="buttons">
    {#if onwatch}
      {#if t.alt?.actions}<button type="button" class="main" onclick={() => onwatch('bot')}>▶ ดูบอทเล่นเทิร์นนี้</button>{/if}
      <button type="button" onclick={() => onwatch('mine')}>ดูรีเพลย์ที่คุณเล่น</button>
    {/if}
    <a class="button" href={`/play/?resume=${gameId}&at=${t.span.start}`}>ลองเล่นใหม่จากตรงนี้</a>
  </div>
</section>

<style>
  .turn-detail {
    padding: 16px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-xl);
    background: var(--card-bg);
    font-size: 14px;
    line-height: 20px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 20px;
    line-height: 28px;
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
  .nums {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: baseline;
    margin: 8px 0 0;
    color: var(--ink-soft);
  }
  .nums strong {
    color: var(--ink-strong);
    font-size: 18px;
    font-weight: 600;
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  details summary {
    width: fit-content;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  details summary:hover {
    color: var(--ink-strong);
  }
  .what {
    margin-top: 4px;
  }
  .what p {
    margin: 6px 0 0;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 18px;
  }
  .bad-text {
    margin: 12px 0 0;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--stamp) 40%, transparent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--stamp) 10%, transparent);
  }
  .bad-text strong {
    color: var(--ink-strong);
  }
  .alike {
    margin: 12px 0 0;
    color: var(--ink-soft);
  }
  .ways {
    display: grid;
    gap: 8px;
    margin-top: 8px;
  }
  .way {
    padding: 8px 10px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
  }
  .way.bot {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .tag {
    display: block;
    margin-bottom: 6px;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
  }
  .way.bot .tag {
    color: var(--accent);
  }
  .moves {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .moves li {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .thumb {
    flex: none;
    width: 28px;
  }
  .thumb.none {
    aspect-ratio: 63 / 88;
    border: 1px dashed var(--line);
    border-radius: 3px;
  }
  /* The first move of each way, where they part. */
  .way .moves li:first-child > span:last-child {
    color: var(--ink-strong);
    font-weight: 600;
  }
  .why {
    margin: 10px 0 0;
    color: var(--ink);
  }
  .muted {
    margin: 8px 0 0;
    color: var(--ink-soft);
  }
  .one {
    margin: 12px 0 0;
    color: var(--ink);
  }
  .played {
    margin-top: 8px;
  }
  .rest {
    margin-top: 4px;
  }
  .rest .moves {
    margin-top: 4px;
  }
  .played .moves {
    margin-top: 8px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }
  .buttons button,
  .button {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--control);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 0.3s var(--ease);
  }
  .buttons button:hover,
  .button:hover {
    background: #313131;
  }
  .buttons button.main {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
    font-weight: 600;
  }
  .buttons button.main:hover {
    border-color: var(--press);
    background: var(--press);
  }
  /* A phone: the moves closer together, so a long turn stays short. */
  @media (max-width: 640px) {
    .turn-detail {
      padding: 12px;
    }
    .moves {
      gap: 2px;
    }
    .thumb {
      width: 22px;
    }
    .way {
      padding: 6px 8px;
    }
  }
  @media (pointer: coarse) {
    .buttons button,
    .button {
      min-height: 44px;
    }
    details summary {
      padding: 8px 0;
    }
  }
</style>
