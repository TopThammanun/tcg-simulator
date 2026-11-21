<script lang="ts">
  // ประวัติเกม + ทบทวนเกม: your saved games and your record against each deck; for one game, every turn of
  // yours reviewed on Web Workers (src/analysis/review.ts): win% before and after it, clear mistakes, the
  // bot's turn from the same position and where it parts from yours, a replay of the turn on the table (yours
  // or the bot's, ReplayViewer.svelte), and a link to play on from that turn. The turns worth a look come
  // first. Reviews are stored with the game, so opening it again is instant.
  import type { TurnReview, Verdict } from '../../analysis/review';
  import { reviewGame, type ReviewRun } from '../../analysis/review-remote';
  import type { GameState } from '../../engine/types';
  import { gamesFile, readGamesFile, replay, turnsOf, type SavedGame, type TurnSpan } from '../../review/record';
  import { deleteGame, getGame, getReview, listGames, persistent, saveGame, saveReview } from '../../review/store';
  import ReplayViewer, { type LineKind } from './ReplayViewer.svelte';
  import WinChart from './WinChart.svelte';

  const params = new URLSearchParams(location.search);
  const id = params.has('id') ? Number(params.get('id')) : null;

  let games = $state.raw<SavedGame[] | null>(null);
  let game = $state.raw<SavedGame | null>(null);
  let states = $state.raw<GameState[]>([]);
  let spans = $state.raw<TurnSpan[]>([]);
  let turns = $state.raw<TurnReview[]>([]);
  let done = $state(false);
  let error = $state('');
  let selected = $state<number | null>(null);
  /** The turn being replayed on the table, and whose way. */
  let replaying = $state<{ turn: number; line: LineKind; autoplay: boolean } | null>(null);
  let run: ReviewRun | null = null;
  $effect(() => () => run?.cancel());

  const VERDICT: Record<Verdict, { label: string; cls: string }> = {
    'missed-win': { label: '✗ พลาดชัด: มีทางชนะ', cls: 'bad' },
    'missed-ko': { label: '✗ พลาดชัด: มีทาง KO มากกว่า', cls: 'bad' },
    better: { label: '▲ น่าจะมีทางที่ดีกว่า', cls: 'warn' },
    ok: { label: '● ไม่พบจุดพลาด', cls: 'ok' },
  };
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const points = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}`;
  const sorted = $derived([...turns].sort((a, b) => a.turn - b.turn));
  const count = (v: Verdict[]) => turns.filter((t) => v.includes(t.verdict)).length;
  /** The turns worth a look: clear mistakes first, then where the bot's turn gains the most. */
  const key = $derived(
    turns
      .filter((t) => t.verdict !== 'ok')
      .sort((a, b) => rank(a) - rank(b) || (b.alt?.diff ?? 0) - (a.alt?.diff ?? 0))
      .slice(0, 3),
  );
  const rank = (t: TurnReview) => (t.verdict === 'missed-win' ? 0 : t.verdict === 'missed-ko' ? 1 : 2);
  const result = (g: SavedGame) => (g.winner === 0 ? 'ชนะ' : g.winner === 1 ? 'แพ้' : 'เสมอ');
  const date = (ms: number) => new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  const yours = (g: SavedGame) => g.mineName ?? 'list ของคุณ';

  /** Your record: games, wins, and per opponent deck (the archetype: list variants count together). */
  const record = $derived.by(() => {
    const done = (games ?? []).filter((g) => g.winner !== null);
    const by = new Map<string, { name: string; won: number; lost: number }>();
    for (const g of done) {
      const name = g.opponentName.replace(/ \(.*\)$/, '');
      const r = by.get(name) ?? { name, won: 0, lost: 0 };
      if (g.winner === 0) r.won++;
      else if (g.winner === 1) r.lost++;
      by.set(name, r);
    }
    const won = done.filter((g) => g.winner === 0).length;
    return { played: done.length, won, rows: [...by.values()].sort((a, b) => b.won + b.lost - (a.won + a.lost)) };
  });

  async function load() {
    try {
      if (id === null) {
        games = await listGames();
        return;
      }
      const g = await getGame(id);
      if (!g) {
        error = 'ไม่พบเกมนี้ในเบราว์เซอร์นี้';
        return;
      }
      game = g;
      states = replay(g);
      spans = turnsOf(states);
      const stored = await getReview(id);
      if (stored) {
        turns = stored.turns;
        done = true;
        return;
      }
      run = reviewGame(
        g,
        spans,
        {},
        (r) => (turns = [...turns, r]),
        (errors) => {
          done = true;
          if (errors.length) error = `วิเคราะห์ไม่สำเร็จ ${errors.length} เทิร์น: ${errors[0]}`;
          else void saveReview(id, turns);
        },
      );
    } catch (e) {
      error = (e as Error).message;
    }
  }
  void load();

  /** Every saved game as one file, to keep or move to another browser. */
  function exportGames() {
    const blob = new Blob([JSON.stringify(gamesFile(games ?? []))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tcg-sim-games-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let note = $state('');
  async function importGames(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const have = new Set((games ?? []).map((g) => `${g.seed}:${g.savedAt}`));
      const fresh = readGamesFile(await file.text()).filter((g) => !have.has(`${g.seed}:${g.savedAt}`));
      for (const g of fresh) await saveGame(g);
      games = await listGames();
      note = `นำเข้า ${fresh.length} เกม`;
    } catch (err) {
      note = (err as Error).message;
    }
  }

  async function remove(g: SavedGame) {
    await deleteGame(g.id!);
    games = (games ?? []).filter((x) => x.id !== g.id);
  }

  function watch(t: TurnReview, line: LineKind) {
    selected = t.turn;
    replaying = { turn: t.turn, line, autoplay: line === 'bot' };
  }
</script>

{#snippet moves(list: string[], split: number | null)}
  <ol class="moves">
    {#each list.length ? list : ['จบเทิร์นโดยไม่ทำอะไร'] as m, i}
      <li class:split={split === i}>{m}</li>
    {/each}
  </ol>
{/snippet}

{#snippet turnBody(t: TurnReview)}
  <div class="row">
    <strong>เทิร์น {t.turn}</strong>
    <span class={`badge ${VERDICT[t.verdict].cls}`}>{VERDICT[t.verdict].label}</span>
    <span class="mono win" title="win% ตอนเริ่มเทิร์น → หลังจบเทิร์น">{pct(t.before)} → {pct(t.win.p)}</span>
  </div>
  <div class="line"><span class="tag">คุณเล่น</span>{@render moves(t.played, t.alt ? t.alt.split : null)}</div>
  {#if t.missed}
    <p class="bad-text">
      {t.missed.kind === 'win' ? 'มีทางชนะเกมในเทิร์นนี้' : `มีทาง KO ได้ ${t.missed.prizes} Prize (คุณได้ ${t.missed.took})`}
      {t.missed.at === t.span.start ? 'ตั้งแต่ต้นเทิร์น' : 'ตอนที่คุณเลือกจบเทิร์น'}: {t.missed.line.join(' → ')}
    </p>
  {/if}
  {#if t.alt}
    <div class="line"><span class="tag bot">บอทจะเล่น</span>{@render moves(t.alt.played, t.alt.split)}</div>
    <p class="muted">
      {#if t.alt.why}<span class="why">{t.alt.why}</span> ·{/if}
      ถ้าเล่นแบบบอท win% {pct(t.alt.win.p)} ({points(t.alt.diff)} จุด)
    </p>
  {:else}
    <p class="muted">บอทก็เล่นแบบเดียวกัน</p>
  {/if}
  <div class="buttons">
    {#if t.alt?.actions}
      <button type="button" class="main" onclick={() => watch(t, 'bot')}>▶ ดูบอทเล่นเทิร์นนี้</button>
    {/if}
    <button type="button" onclick={() => watch(t, 'mine')}>ดูรีเพลย์ที่คุณเล่น</button>
    <a class="button" href={`/play/?resume=${game!.id}&at=${t.span.start}`}>ลองเล่นใหม่จากตรงนี้</a>
  </div>
{/snippet}

{#if error}<p class="error">{error}</p>{/if}

{#if id === null}
  {#if games === null}
    <p class="muted">กำลังโหลด…</p>
  {:else if games.length === 0}
    <div class="empty">
      <p>ยังไม่มีเกม เล่นกับบอทจนจบเกม แล้วเกมจะถูกเก็บไว้ที่นี่ (ในเบราว์เซอร์นี้) พร้อมบอกว่าเทิร์นไหนที่เกมพลิก</p>
      <a class="cta" href="/play/">เล่นกับบอท</a>
    </div>
  {:else}
    {#if record.played}
      <section class="record" aria-label="สถิติของคุณ">
        <div class="totals">
          <div><span class="num">{record.played}</span>เกม</div>
          <div><span class="num">{pct(record.won / record.played)}</span>ชนะ</div>
        </div>
        <ol class="vs">
          {#each record.rows as r (r.name)}
            <li>
              <span class="name">vs {r.name}</span>
              <span class="bar" style:--w={`${(r.won / Math.max(1, r.won + r.lost)) * 100}%`}></span>
              <span class="mono wl">{r.won}–{r.lost}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
    <ul class="games">
      {#each games as g (g.id)}
        <li>
          <span class="res" class:won={g.winner === 0} class:lost={g.winner === 1}>{result(g)}</span>
          <span class="match">
            <strong>{yours(g)} <span class="vs-word">vs</span> {g.opponentName}</strong>
            <span class="muted">
              {g.mode === 'practice' ? 'โหมดฝึก · ' : ''}{g.turns} เทิร์น · {g.reason} · {date(g.savedAt)}
            </span>
          </span>
          <span class="act">
            <a class="button" href={`/review/?id=${g.id}`}>ทบทวน</a>
            <button type="button" class="link" onclick={() => remove(g)}>ลบ</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="files">
    {#if games?.length}<button type="button" class="link" onclick={exportGames}>สำรองทุกเกมเป็นไฟล์</button>{/if}
    <label class="import">นำเข้าไฟล์สำรอง<input type="file" accept=".json,application/json" onchange={importGames} /></label>
    {#if note}<span class="muted">{note}</span>{/if}
  </p>
  {#if !persistent}<p class="muted">เบราว์เซอร์นี้เก็บข้อมูลไม่ได้ เกมจะหายเมื่อปิดหน้า</p>{/if}
{:else if game}
  <section class="head">
    <a class="back" href="/review/">← ประวัติเกม</a>
    <p class="eyebrow">{game.mode === 'practice' ? 'โหมดฝึก · ' : ''}{date(game.savedAt)}</p>
    <h1>
      <span class="res" class:won={game.winner === 0} class:lost={game.winner === 1}>{result(game)}</span>
      {yours(game)} <span class="vs-word">vs</span> {game.opponentName}
    </h1>
    <p class="summary">
      {game.reason} · {game.turns} เทิร์น ·
      {#if !done}
        กำลังวิเคราะห์ {turns.length}/{spans.length} เทิร์น…
        <progress max={spans.length} value={turns.length}></progress>
      {:else}
        พลาดชัด <strong class="bad">{count(['missed-win', 'missed-ko'])}</strong> · น่าจะมีทางที่ดีกว่า
        <strong class="warn">{count(['better'])}</strong> · จาก {turns.length} เทิร์นของคุณ
      {/if}
    </p>
  </section>

  {#if done}
    {#if key.length}
      <section class="key" aria-labelledby="key-title">
        <h2 id="key-title">จุดที่ควรดูก่อน</h2>
        <ol>
          {#each key as t (t.turn)}
            <li class:sel={selected === t.turn}>{@render turnBody(t)}</li>
          {/each}
        </ol>
      </section>
    {:else if turns.length}
      <p class="clean">ไม่พบจุดที่เสียเปรียบชัด ๆ ในเกมนี้ ทุกเทิร์นใกล้เคียงกับที่บอทจะเล่น</p>
    {/if}
  {/if}

  {#if sorted.length}<WinChart turns={sorted} {selected} />{/if}

  <section class="all">
    <h2>ทุกเทิร์นของคุณ</h2>
    <ol class="turns">
      {#each sorted as t (t.turn)}
        <li class:sel={selected === t.turn}>{@render turnBody(t)}</li>
      {/each}
    </ol>
  </section>

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

  <p class="note">
    win% = โอกาสชนะถ้าจากตรงนั้นทั้งสองฝั่งเล่นแบบบอท ตามที่ network ของบอท (ตัวเดียวกับที่คุณเล่นด้วย) ประเมิน
    เฉลี่ยจากการสุ่มการ์ดที่คุณมองไม่เห็นใหม่ 16 แบบ · พลาดชัด = ตัววางแผนโจมตีหาทางที่ชนะหรือได้ Prize มากกว่า และทางนั้นใช้ได้ทุกแบบที่สุ่มใหม่ (ตรวจด้วย engine) ·
    น่าจะมีทางที่ดีกว่า = ถ้าเล่นเทิร์นนั้นแบบบอท win% สูงกว่าอย่างน้อย 10 จุด ตัวที่ขีดเส้นคือจุดแรกที่บอทเล่นต่างจากคุณ ·
    เป็นค่าประมาณ ให้ใช้เป็นจุดที่ควรลองดูซ้ำ
  </p>
{/if}

<style>
  .muted {
    color: var(--ink-soft);
  }
  .error {
    color: var(--stamp);
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  h2 {
    margin: 48px 0 16px;
    font-size: 24px;
    line-height: 32px;
  }
  .empty {
    padding: 48px 24px;
    border: 1px dashed var(--line);
    border-radius: var(--radius-xl);
    color: var(--ink-soft);
    text-align: center;
  }
  .empty p {
    max-width: 480px;
    margin: 0 auto 24px;
  }
  .cta {
    display: inline-block;
    padding: 8px 12px;
    border: 1px solid var(--primary);
    border-radius: var(--radius);
    background: var(--primary);
    color: var(--primary-ink);
    font-weight: 600;
    text-decoration: none;
    transition: background-color 0.3s var(--ease);
  }
  .cta:hover {
    border-color: var(--press);
    background: var(--press);
  }
  /* Your record: two big numbers, then a bar per opponent deck. */
  .record {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 32px;
    align-items: center;
    margin-bottom: 24px;
    padding: 24px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-xl);
    background: var(--card-bg);
  }
  .totals {
    display: flex;
    gap: 32px;
  }
  .totals div {
    display: flex;
    flex-direction: column;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
  }
  .num {
    color: var(--ink-strong);
    font-size: 36px;
    line-height: 40px;
    font-weight: 600;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .vs {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .vs li {
    display: grid;
    grid-template-columns: minmax(0, 13rem) 1fr 3.5rem;
    gap: 12px;
    align-items: center;
    padding: 4px 0;
    font-size: 14px;
    line-height: 20px;
  }
  /* Wins in white, losses in red. */
  .vs .bar {
    position: relative;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: color-mix(in srgb, var(--stamp) 55%, var(--control));
  }
  .vs .bar::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--w);
    background: var(--ink-strong);
  }
  .wl {
    text-align: right;
  }
  .games {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--rule);
    border-radius: var(--radius-xl);
    background: var(--card-bg);
  }
  .games li {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto;
    gap: 16px;
    align-items: center;
    padding: 16px;
  }
  .games li + li {
    border-top: 1px solid var(--rule);
  }
  .res {
    display: inline-block;
    width: 4.5rem;
    padding: 2px 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    text-align: center;
  }
  .res.won {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
  }
  .res.lost {
    border-color: color-mix(in srgb, var(--stamp) 50%, transparent);
    color: var(--stamp);
  }
  .match {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .match strong {
    color: var(--ink-strong);
    font-weight: 500;
  }
  .match .muted {
    font-size: 12px;
    line-height: 16px;
  }
  .vs-word {
    color: var(--ink-faint);
    font-size: 0.75em;
    font-weight: 400;
  }
  .act {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .files {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    align-items: center;
    margin-top: 16px;
    font-size: 14px;
    line-height: 20px;
  }
  .import {
    position: relative;
    color: var(--ink-soft);
    text-decoration: underline;
    text-underline-offset: 4px;
    cursor: pointer;
  }
  .import:focus-within {
    outline: 2px solid var(--ink-strong);
    outline-offset: 2px;
  }
  .import input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-soft);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 4px;
    cursor: pointer;
    transition: color 0.3s var(--ease);
  }
  .link:hover {
    color: var(--ink-strong);
  }
  .head {
    max-width: 860px;
  }
  .back {
    display: inline-block;
    margin-bottom: 24px;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
    text-decoration: none;
    transition: color 0.3s var(--ease);
  }
  .back:hover {
    color: var(--ink-strong);
  }
  .head .eyebrow {
    margin: 0 0 8px;
  }
  .head h1 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    margin: 0 0 8px;
    font-size: 36px;
    line-height: 1.25;
    letter-spacing: -0.015em;
  }
  .head h1 .res {
    width: auto;
    padding: 4px 12px;
    font-size: 14px;
    line-height: 20px;
    letter-spacing: 0;
  }
  .summary {
    margin: 0;
    color: var(--ink-soft);
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
    color: var(--accent);
  }
  .clean {
    margin: 24px 0 0;
    padding: 16px;
    border: 1px solid color-mix(in srgb, var(--teal) 40%, transparent);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--teal) 8%, transparent);
  }
  .key > ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .key > ol > li {
    padding: 16px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
    font-size: 14px;
    line-height: 20px;
  }
  .all {
    max-width: 860px;
  }
  .turns {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .turns > li {
    padding: 16px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
    font-size: 14px;
    line-height: 20px;
  }
  .turns > li.sel,
  .key > ol > li.sel {
    border-color: var(--ink-soft);
  }
  .key p,
  .turns p {
    margin: 8px 0 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
  }
  .row strong {
    color: var(--ink-strong);
    font-size: 16px;
    line-height: 24px;
    font-weight: 600;
  }
  .win {
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
  .bad-text {
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--stamp) 40%, transparent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--stamp) 10%, transparent);
    color: var(--ink);
  }
  .line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 8px;
  }
  .tag {
    flex: 0 0 auto;
    padding: 0 6px;
    border: 1px solid var(--line);
    border-radius: 4px;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
  }
  .tag.bot {
    border-color: var(--ink-soft);
    color: var(--ink-strong);
  }
  .moves {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .moves li + li::before {
    content: '→';
    /* inline-block keeps the split move's underline off the arrow */
    display: inline-block;
    margin: 0 8px;
    color: var(--ink-faint);
  }
  /* Where your turn and the bot's part. */
  .moves li.split {
    color: var(--ink-strong);
    font-weight: 600;
    text-decoration: underline 2px var(--stamp);
    text-underline-offset: 4px;
  }
  .why {
    color: var(--ink);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }
  .buttons button,
  .button {
    padding: 4px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--control);
    color: var(--ink-strong);
    font: inherit;
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition:
      background-color 0.3s var(--ease),
      transform 0.3s var(--ease);
  }
  .buttons button:hover,
  .button:hover {
    background: #313131;
  }
  .buttons button:active,
  .button:active {
    transform: scale(0.98);
  }
  /* Watching the bot's turn is the main thing a turn card offers. */
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
  .games .button {
    border-color: var(--primary);
    background: var(--primary);
    color: var(--primary-ink);
    font-weight: 600;
  }
  .games .button:hover {
    border-color: var(--press);
    background: var(--press);
  }
  .note {
    margin-top: 32px;
    color: var(--ink-faint);
    font-size: 12px;
    line-height: 20px;
  }
  @media (max-width: 640px) {
    .record {
      grid-template-columns: 1fr;
    }
    .vs li {
      grid-template-columns: 1fr 3.5rem;
    }
    .vs .bar {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .games li {
      grid-template-columns: 4.5rem minmax(0, 1fr);
    }
    .act {
      grid-column: 2;
    }
  }
</style>
