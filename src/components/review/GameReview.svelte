<script lang="ts">
  // One game's review. Every turn of yours is reviewed on Web Workers (src/analysis/review.ts) and stored with the
  // game, so opening it again is instant. The page reads top down: the result and one sentence on what mattered
  // most, with one button that goes through the turns worth a look; the win% chart (its points pick a turn) and a
  // strip of the turns; then the turn picked, on the table (a computer: ReplayStage beside the turn's detail; a
  // phone: the detail, and the table full screen on demand, ReplayViewer).
  import type { TurnReview, Verdict } from '../../analysis/review';
  import { botName, href, lang, tx, youName } from '../../i18n';
  import { reviewGame, type ReviewRun } from '../../analysis/review-remote';
  import type { CardId, GameState, PlayerId } from '../../engine/types';
  import { keyOf } from '../../engine/state';
  import { reasonText, replay, turnsOf, type SavedGame, type TurnSpan } from '../../review/record';
  import { getGame, getReview, saveReview } from '../../review/store';
  import { keyTurns, reviewSummary, turnLines } from '../../review/summary';
  import CardFace from '../game/CardFace.svelte';
  import CardInfo from '../game/CardInfo.svelte';
  import ReplayStage from './ReplayStage.svelte';
  import ReplayViewer, { type LineKind } from './ReplayViewer.svelte';
  import TurnDetail from './TurnDetail.svelte';
  import WinChart from './WinChart.svelte';

  let { id }: { id: number } = $props();

  let game = $state.raw<SavedGame | null>(null);
  let states = $state.raw<GameState[]>([]);
  let spans = $state.raw<TurnSpan[]>([]);
  let turns = $state.raw<TurnReview[]>([]);
  let done = $state(false);
  let error = $state('');
  let selected = $state<number | null>(null);
  /** Phones: the turn being replayed full screen, and whose way. */
  let replaying = $state<{ turn: number; line: LineKind; autoplay: boolean } | null>(null);
  /** Computers: the line shown on the table beside the detail, and its step. */
  let kind = $state<LineKind>('mine');
  let pos = $state(0);
  let pile = $state<PlayerId | null>(null);
  let zoom = $state<string | null>(null);
  let run: ReviewRun | null = null;
  $effect(() => () => run?.cancel());

  // A computer has the room for the table beside the turn's detail.
  let wide = $state(matchMedia('(min-width: 1100px)').matches);
  $effect(() => {
    const mq = matchMedia('(min-width: 1100px)');
    const update = () => (wide = mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  });

  const VERDICT: Record<Verdict, string> = { 'missed-win': '✗', 'missed-ko': '✗', better: '▲', ok: '●' };
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const result = (g: SavedGame) => (g.winner === 0 ? tx('ชนะ', 'Won') : g.winner === 1 ? tx('แพ้', 'Lost') : tx('เสมอ', 'Draw'));
  const date = (ms: number) => new Date(ms).toLocaleString(lang() === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  const sorted = $derived([...turns].sort((a, b) => a.turn - b.turn));
  const key = $derived(keyTurns(turns));
  const summary = $derived(reviewSummary(turns));
  /** Where "ดูจุดที่ควรดู" is in the turns worth a look. */
  let keyAt = $state(-1);

  const t = $derived(sorted.find((x) => x.turn === selected) ?? sorted[0]);
  const lines = $derived(t && states.length ? turnLines(states, game!.actions, t) : null);
  const line = $derived(lines ? (kind === 'bot' && lines.bot ? lines.bot : lines.mine) : null);
  const shown = $derived(line ? line.states[line.stops[pos] ?? 0]! : null);
  const endText = $derived(
    t && shown && lines
      ? shown.winner === lines.me
        ? tx('ชนะเกม', 'Game won')
        : shown.winner !== null
          ? tx('จบเกม', 'Game over')
          : tx(`จบเทิร์นแล้ว win% ${pct(kind === 'bot' && t.alt ? (t.alt.lucky ?? t.alt.win.p) : t.win.p)}`, `After the turn: win% ${pct(kind === 'bot' && t.alt ? (t.alt.lucky ?? t.alt.win.p) : t.win.p)}`)
      : '',
  );

  /** What was hidden at that step (the bot's hand, both Prize piles), and a discard pile tapped on the table. */
  const hiddenPiles = $derived<[string, CardId[]][]>(
    shown
      ? [
          [tx('มือบอท', "Bot's hand"), shown.players[1].hand],
          [tx('Prize ของบอท', "Bot's Prize cards"), shown.players[1].prizes],
          [tx('Prize ของคุณ', 'Your Prize cards'), shown.players[0].prizes],
          ...(pile !== null
            ? ([[pile === 0 ? tx('กองทิ้งของคุณ', 'Your discard pile') : tx('กองทิ้งของบอท', "Bot's discard pile"), shown.players[pile].discard]] as [string, CardId[]][])
            : []),
        ]
      : [],
  );

  async function load() {
    try {
      const g = await getGame(id);
      if (!g) {
        error = tx('ไม่เจอเกมนี้ในเบราว์เซอร์นี้', 'This game is not in this browser');
        return;
      }
      game = g;
      states = replay(g);
      spans = turnsOf(states);
      const stored = await getReview(id);
      if (stored) {
        turns = stored.turns;
        finish();
        return;
      }
      run = reviewGame(
        g,
        spans,
        {},
        (r) => (turns = [...turns, r]),
        (errors) => {
          finish();
          if (errors.length) error = tx(`วิเคราะห์ไม่สำเร็จ ${errors.length} เทิร์น: ${errors[0]}`, `${errors.length} turns could not be analysed: ${errors[0]}`);
          else void saveReview(id, turns);
        },
      );
    } catch (e) {
      error = (e as Error).message;
    }
  }
  void load();

  /** The review is in: the turn picked first is the one worth a look most. */
  function finish() {
    done = true;
    if (selected === null) {
      const first = keyTurns(turns)[0];
      if (first) keyAt = 0;
      select(first?.turn ?? [...turns].sort((a, b) => a.turn - b.turn)[0]?.turn ?? null);
    }
  }

  function select(n: number | null) {
    if (n !== selected) {
      kind = 'mine';
      pos = 0;
      pile = null;
    }
    selected = n;
  }
  /** "ดูจุดที่ควรดู": the next turn worth a look, round again after the last. */
  function nextKey() {
    if (!key.length) return;
    keyAt = (keyAt + 1) % key.length;
    select(key[keyAt]!.turn);
    if (!wide) document.getElementById('turn-detail')?.scrollIntoView({ block: 'start' });
  }
  /** Your turn or the bot's on the table: the step kept up to where they part, to compare them there. */
  function pickLine(k: LineKind) {
    if (k === kind || !t) return;
    pos = t.alt ? Math.min(pos, t.alt.split) : 0;
    kind = k;
  }
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if game}
  <section class="head">
    <a class="back" href={href('/review/')}>← {tx('ประวัติเกม', 'Game history')}</a>
    <div class="title-row">
      <h1>
        <span class="res" class:won={game.winner === 0} class:lost={game.winner === 1}>{result(game)}</span>
        {game.mineName ?? tx('ลิสต์ของคุณ', 'Your list')} <span class="vs-word">vs</span> {game.opponentName}
      </h1>
      {#if done && key.length}
        <button type="button" class="primary" onclick={nextKey}>
          {tx('ไล่ดูเทิร์นที่ควรดู', 'Turns worth a look')} ({keyAt >= 0 ? keyAt + 1 : 1}/{key.length})
        </button>
      {/if}
    </div>
    {#if done && summary.sentence}<p class="sentence">{summary.sentence}</p>{/if}
    <p class="summary">
      {reasonText(game.reason)} · {tx(`${game.turns} เทิร์น`, `${game.turns} turns`)}<span class="extra"> · {date(game.savedAt)}</span> ·
      {#if !done}
        {tx(`กำลังวิเคราะห์เทิร์น ${turns.length}/${spans.length}…`, `Analysing turn ${turns.length}/${spans.length}…`)}
        <progress max={spans.length} value={turns.length}></progress>
      {:else}
        {tx('พลาดชัดเจน', 'Clear slips')} <strong class="bad">{summary.missed}</strong> · {tx('น่าจะมีทางที่ดีกว่า', 'likely a better way')} <strong class="warn">{summary.better}</strong>
        {#if summary.widest}<span class="extra"
            >· {tx(`ต่างจากบอทมากที่สุดคือเทิร์น ${summary.widest.turn} (win% ห่าง ${summary.widest.points}%)`, `furthest from the bot: turn ${summary.widest.turn} (${summary.widest.points} points)`)}</span
          >{/if}
        · {tx(`จาก ${turns.length} เทิร์นของคุณ`, `of your ${turns.length} turns`)}
      {/if}
    </p>
  </section>

  {#if sorted.length}
    {#snippet chartAndStrip()}
      <WinChart turns={sorted} selected={t?.turn ?? null} onpick={select} />
      <nav class="strip" aria-label={tx('เทิร์นของคุณ', 'Your turns')}>
        {#each sorted as x (x.turn)}
          {@const lost = x.alt && x.alt.diff >= 0.005 ? Math.round(x.alt.diff * 100) : 0}
          <button
            type="button"
            class={`turn-chip ${x.verdict}`}
            aria-pressed={x.turn === t?.turn}
            aria-label={tx(`เทิร์น ${x.turn}`, `Turn ${x.turn}`) + (lost ? tx(`: win% น้อยกว่าทางของบอท ${lost}%`, `: ${lost} points from the bot's way`) : '')}
            onclick={() => select(x.turn)}
          >
            <span class="n">{x.turn}</span><span class="v" aria-hidden="true">{VERDICT[x.verdict]}</span>{#if lost}<span class="d mono">−{lost}</span>{/if}
          </button>
        {/each}
      </nav>
    {/snippet}

    <!-- A computer: the turn on the table at the left, right under the summary; the chart, the turns and the turn's
         detail at the right. A phone: the chart, the turns and the detail, the table full screen on demand. -->
    <div class="review" class:wide>
      {#if wide && t && lines && line}
        <section class="stage-card" aria-label={tx(`เทิร์น ${t.turn} บนสนาม`, `Turn ${t.turn} on the table`)}>
          <div class="seg" role="tablist" aria-label={tx('ดูเทิร์นนี้ในแบบ', 'See this turn as')}>
            <span class="on-table">{tx('เทิร์น', 'Turn')} {t.turn}</span>
            <button type="button" role="tab" aria-selected={kind === 'mine'} class:on={kind === 'mine'} onclick={() => pickLine('mine')}>
              {tx('คุณเล่น', 'You played')} <span class="mono">{pct(t.win.p)}</span>
            </button>
            {#if lines.bot && t.alt}
              <button type="button" role="tab" aria-selected={kind === 'bot'} class:on={kind === 'bot'} onclick={() => pickLine('bot')}>
                {tx('บอทจะเล่น', 'The bot would play')} <span class="mono">{pct(t.alt.win.p)}</span>
              </button>
            {:else}
              <span class="same">{tx('บอทก็เล่นแบบเดียวกัน', 'The bot plays it the same way')}</span>
            {/if}
            <span class="keys">{tx('← → ทีละขั้น · Space เล่น/หยุด (คลิกที่สนามก่อน)', '← → step by step · Space play/pause (click the table first)')}</span>
          </div>
          {#key `${t.turn}:${kind}`}
            <ReplayStage
              {line}
              bind:pos
              who={kind === 'bot' && lines.bot ? botName() : youName()}
              {endText}
              keys="focus"
              ondiscard={(p) => (pile = pile === p ? null : p)}
            />
          {/key}
        </section>
      {/if}

      <div class="right" id="turn-detail">
        {@render chartAndStrip()}
        {#if t}
          <TurnDetail
            {t}
            mine={lines?.mine ?? null}
            bot={lines?.bot ?? null}
            gameId={id}
            onwatch={wide ? undefined : (l) => (replaying = { turn: t.turn, line: l, autoplay: l === 'bot' })}
          />
        {/if}
        {#if wide && shown}
          <details class="hidden-cards">
            <summary>{tx('เปิดดูการ์ดที่ตอนนั้นมองไม่เห็น', 'The cards hidden at the time, all face up')}</summary>
            {#each hiddenPiles as [label, ids] (label)}
              <h4>{label} ({ids.length})</h4>
              <div class="cards">
                {#each ids as c (c)}
                  <button type="button" onclick={() => (zoom = keyOf(shown, c))}><CardFace cardKey={keyOf(shown, c)} /></button>
                {/each}
              </div>
            {/each}
          </details>
        {/if}
      </div>
    </div>
  {/if}

  {#if replaying}
    {#key replaying}
      <ReplayViewer
        {states}
        actions={game.actions}
        turns={sorted}
        turn={replaying.turn}
        line={replaying.line}
        autoplay={replaying.autoplay}
        onturn={(n) => (selected = n)}
        onclose={() => (replaying = null)}
      />
    {/key}
  {/if}
  {#if zoom}<CardInfo cardKey={zoom} onclose={() => (zoom = null)} />{/if}
{/if}

<style>
  .error {
    color: var(--stamp);
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .head {
    margin-bottom: 16px;
  }
  .back {
    display: inline-block;
    margin-bottom: 12px;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
    text-decoration: none;
    transition: color 0.3s var(--ease);
  }
  .back:hover {
    color: var(--ink-strong);
  }
  .title-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;
    align-items: center;
    justify-content: space-between;
  }
  h1 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    margin: 0;
    font-size: 30px;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .res {
    padding: 4px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    letter-spacing: 0;
  }
  .res.won {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .res.lost {
    border-color: color-mix(in srgb, var(--theirs) 50%, transparent);
    color: var(--theirs);
  }
  .vs-word {
    color: var(--ink-soft);
    font-size: 20px;
    font-weight: 400;
  }
  .primary {
    padding: 8px 20px;
    border: 1px solid var(--primary);
    border-radius: var(--radius);
    background: var(--primary);
    color: var(--primary-ink);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.3s var(--ease);
  }
  .primary:hover {
    border-color: var(--press);
    background: var(--press);
  }
  .sentence {
    margin: 8px 0 0;
    color: var(--ink-strong);
    font-size: 18px;
    line-height: 28px;
    font-weight: 500;
  }
  .summary {
    margin: 4px 0 0;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
  }
  .summary progress {
    vertical-align: middle;
    width: 140px;
    accent-color: var(--ink-strong);
  }
  .bad {
    color: var(--stamp);
  }
  .warn {
    color: var(--warn);
  }

  /* A computer: the table on the left, the chart, the turns and the turn's detail on the right (it scrolls itself). */
  .review {
    display: grid;
    gap: 16px;
  }
  .review.wide {
    grid-template-columns: minmax(0, 1fr) 400px;
    align-items: start;
  }
  .right {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .wide .right {
    position: sticky;
    top: 72px;
    max-height: calc(100dvh - 88px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .turn-chip {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
    min-height: 36px;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--card-bg);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    line-height: 20px;
    cursor: pointer;
    transition:
      background-color 0.3s var(--ease),
      border-color 0.3s var(--ease);
  }
  .turn-chip:hover {
    background: var(--raised);
  }
  .turn-chip[aria-pressed='true'] {
    border-color: var(--ink-strong);
    background: var(--control);
  }
  .turn-chip .n {
    color: var(--ink-strong);
    font-weight: 600;
  }
  .turn-chip .v {
    font-size: 12px;
    color: var(--ink-soft);
  }
  .turn-chip.missed-win .v,
  .turn-chip.missed-ko .v {
    color: var(--stamp);
  }
  .turn-chip.better .v {
    color: var(--warn);
  }
  .turn-chip .d {
    color: var(--ink-soft);
    font-size: 12px;
  }
  /* The table of the turn picked: the screen's height under the summary (the board needs about 400px), the hand
     smaller than in a game. */
  .stage-card {
    position: sticky;
    top: 72px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: clamp(560px, calc(100dvh - 264px), 800px);
  }
  .stage-card :global(.hand) {
    --hand-w: 60px;
    padding-top: 10px;
    padding-bottom: 10px;
  }
  .on-table {
    margin-right: 4px;
    color: var(--ink-strong);
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
  }
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .seg button {
    display: inline-flex;
    gap: 8px;
    align-items: baseline;
    padding: 4px 12px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--card-bg);
    color: var(--ink-soft);
    font: inherit;
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.3s var(--ease);
  }
  .seg button.on {
    border-color: var(--line);
    background: var(--control);
    color: var(--ink-strong);
  }
  .same,
  .keys {
    padding: 4px 8px;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
  }
  .keys {
    margin-left: auto;
  }
  .hidden-cards {
    padding: 12px 16px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    font-size: 14px;
    line-height: 20px;
  }
  .hidden-cards summary {
    color: var(--ink-soft);
    cursor: pointer;
  }
  .hidden-cards h4 {
    margin: 12px 0 6px;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
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
  @media (max-width: 640px) {
    .review,
    .right {
      gap: 10px;
    }
    .extra {
      display: none;
    }
    .head {
      margin-bottom: 12px;
    }
    .title-row {
      gap: 8px 16px;
    }
    /* The turns in one row that scrolls sideways. */
    .strip {
      flex-wrap: nowrap;
      overflow-x: auto;
      margin: 0 -16px;
      padding: 0 16px 2px;
      scrollbar-width: none;
    }
    .turn-chip {
      flex: none;
    }
    .back {
      margin-bottom: 8px;
    }
    h1 {
      font-size: 24px;
    }
    .sentence {
      font-size: 16px;
      line-height: 24px;
    }
    .primary {
      width: 100%;
    }
  }
  @media (pointer: coarse) {
    .turn-chip,
    .primary {
      min-height: 44px;
    }
  }
</style>
