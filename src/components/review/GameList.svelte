<script lang="ts">
  // ประวัติเกม: your record (games, wins, a bar per opponent deck, and a link to practise the matchup you lose most),
  // the saved games (each with what its review found, or that it hasn't been reviewed), filtered by your deck, the
  // opponent and the result; a file of them all to keep, and such files imported. A deleted game can be put back for
  // a few seconds.
  import type { SavedGame } from '../../review/record';
  import { gamesFile, readGamesFile } from '../../review/record';
  import {
    deleteGame,
    listGames,
    listReviews,
    persistent,
    restoreGame,
    saveGame,
    type Deleted,
    type StoredReview,
  } from '../../review/store';
  import Segmented from '../ui/Segmented.svelte';
  import Toast from '../ui/Toast.svelte';

  let games = $state.raw<SavedGame[] | null>(null);
  let reviews = $state.raw(new Map<number, StoredReview>());
  let error = $state('');

  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const result = (g: SavedGame) => (g.winner === 0 ? 'ชนะ' : g.winner === 1 ? 'แพ้' : 'เสมอ');
  const date = (ms: number) => new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  const yours = (g: SavedGame) => g.mineName ?? 'list ของคุณ';
  /** The opponent's archetype: list variants ("Festival Lead (Dipplin)") count together. */
  const archetype = (g: SavedGame) => g.opponentName.replace(/ \(.*\)$/, '');

  /** Your record: games, wins, and per opponent deck; the matchup lost most is offered for practice. */
  const record = $derived.by(() => {
    const done = (games ?? []).filter((g) => g.winner !== null);
    const by = new Map<string, { name: string; won: number; lost: number; href: string }>();
    // Newest first, so a row links to the decks of its latest game.
    for (const g of done) {
      const name = archetype(g);
      const r = by.get(name) ?? { name, won: 0, lost: 0, href: `/play/?opp=${g.opponent}${g.mine && g.mine !== 'player' ? `&me=${g.mine}` : ''}` };
      if (g.winner === 0) r.won++;
      else if (g.winner === 1) r.lost++;
      by.set(name, r);
    }
    const rows = [...by.values()].sort((a, b) => b.won + b.lost - (a.won + a.lost));
    const worst = rows.filter((r) => r.lost > 0).sort((a, b) => b.lost - a.lost || a.won - b.won)[0]?.name ?? null;
    const won = done.filter((g) => g.winner === 0).length;
    return { played: done.length, won, rows, worst };
  });

  // Filters.
  let mineFilter = $state('');
  let oppFilter = $state('');
  let resultFilter = $state<'all' | 'won' | 'lost'>('all');
  const RESULTS = [
    { value: 'all' as const, label: 'ทั้งหมด' },
    { value: 'won' as const, label: 'ชนะ' },
    { value: 'lost' as const, label: 'แพ้' },
  ];
  const mineNames = $derived([...new Set((games ?? []).map(yours))].sort());
  const oppNames = $derived([...new Set((games ?? []).map(archetype))].sort());
  const shownGames = $derived(
    (games ?? []).filter(
      (g) =>
        (!mineFilter || yours(g) === mineFilter) &&
        (!oppFilter || archetype(g) === oppFilter) &&
        (resultFilter === 'all' || (resultFilter === 'won' ? g.winner === 0 : g.winner === 1)),
    ),
  );

  /** What a game's review found: clear mistakes ✗, probably better ▲; null when it hasn't been reviewed. */
  function found(g: SavedGame): { missed: number; better: number } | null {
    const r = reviews.get(g.id!);
    if (!r) return null;
    return {
      missed: r.turns.filter((t) => t.verdict === 'missed-win' || t.verdict === 'missed-ko').length,
      better: r.turns.filter((t) => t.verdict === 'better').length,
    };
  }

  async function load() {
    try {
      [games, reviews] = await Promise.all([listGames(), listReviews()]);
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

  /** The game just deleted, for a few seconds: "เลิกทำ" puts it back. */
  let undo = $state.raw<Deleted | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  const UNDO_MS = 6000;

  async function remove(g: SavedGame) {
    const gone = await deleteGame(g.id!);
    games = (games ?? []).filter((x) => x.id !== g.id);
    clearTimeout(undoTimer);
    undo = gone ?? null;
    undoTimer = setTimeout(() => (undo = null), UNDO_MS);
  }

  async function putBack() {
    const x = undo;
    if (!x) return;
    clearTimeout(undoTimer);
    undo = null;
    await restoreGame(x);
    [games, reviews] = await Promise.all([listGames(), listReviews()]);
  }
</script>

{#if error}<p class="error">{error}</p>{/if}

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
            {#if r.name === record.worst}<a class="practice" href={r.href}>ซ้อม matchup นี้ →</a>{/if}
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <div class="filters" role="search" aria-label="กรองเกม">
    <label>
      เด็คของคุณ
      <select bind:value={mineFilter}>
        <option value="">ทุกเด็ค</option>
        {#each mineNames as n}<option value={n}>{n}</option>{/each}
      </select>
    </label>
    <label>
      คู่แข่ง
      <select bind:value={oppFilter}>
        <option value="">ทุกเด็ค</option>
        {#each oppNames as n}<option value={n}>{n}</option>{/each}
      </select>
    </label>
    <Segmented label="ผล" options={RESULTS} bind:value={resultFilter} />
    <span class="count">{shownGames.length} จาก {games.length} เกม</span>
  </div>

  <ul class="games">
    {#each shownGames as g (g.id)}
      {@const f = found(g)}
      <li>
        <span class="res" class:won={g.winner === 0} class:lost={g.winner === 1}>{result(g)}</span>
        <span class="match">
          <strong>{yours(g)} <span class="vs-word">vs</span> {g.opponentName}</strong>
          <span class="muted">
            {g.mode === 'practice' ? 'โหมดฝึก · ' : ''}{g.turns} เทิร์น · {g.reason} · {date(g.savedAt)}
          </span>
        </span>
        <span class="found" class:none={!f}>
          {#if !f}ยังไม่ได้ทบทวน{:else if f.missed || f.better}
            {#if f.missed}<span class="bad" title="พลาดชัด">✗{f.missed}</span>{/if}
            {#if f.better}<span class="warn" title="น่าจะมีทางที่ดีกว่า">▲{f.better}</span>{/if}
          {:else}ไม่พบจุดพลาด{/if}
        </span>
        <span class="act">
          <a class="button" href={`/review/?id=${g.id}`}>ทบทวน</a>
          <button type="button" class="link" onclick={() => remove(g)}>ลบ</button>
        </span>
      </li>
    {:else}
      <li class="nothing">ไม่มีเกมที่ตรงกับตัวกรอง</li>
    {/each}
  </ul>
{/if}
<p class="files">
  {#if games?.length}<button type="button" class="link" onclick={exportGames}>สำรองทุกเกมเป็นไฟล์</button>{/if}
  <label class="import">นำเข้าไฟล์สำรอง<input type="file" accept=".json,application/json" onchange={importGames} /></label>
  {#if note}<span class="muted">{note}</span>{/if}
</p>
{#if !persistent}<p class="muted">เบราว์เซอร์นี้เก็บข้อมูลไม่ได้ เกมจะหายเมื่อปิดหน้า</p>{/if}
{#if undo}
  <Toast message={`ลบเกม ${yours(undo.game)} vs ${undo.game.opponentName} แล้ว`} action="เลิกทำ" onaction={putBack} />
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
  .vs .bar {
    position: relative;
    height: 4px;
    overflow: hidden;
    border-radius: var(--radius-sm);
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
    grid-template-columns: 4.5rem minmax(0, 1fr) auto auto;
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
    border-radius: var(--radius);
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
    color: var(--ink-soft);
    font-size: 12px;
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
  .button:hover {
    background: var(--control-hover);
  }
  .button:active {
    transform: scale(0.98);
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
  .practice {
    grid-column: 1 / -1;
    justify-self: start;
    color: var(--accent);
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    text-decoration: none;
  }
  .practice:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 16px;
    align-items: flex-end;
    margin-bottom: 12px;
  }
  .filters label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
  }
  .filters select {
    min-height: 38px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--ink-strong);
    font: inherit;
    font-size: 14px;
    line-height: 20px;
  }
  .count {
    margin-left: auto;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 16px;
  }
  .found {
    display: inline-flex;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 20px;
    font-weight: 600;
    white-space: nowrap;
  }
  .found.none {
    color: var(--ink-soft);
    font-family: inherit;
    font-size: 12px;
    font-weight: 400;
  }
  .bad {
    color: var(--stamp);
  }
  .warn {
    color: var(--accent);
  }
  .nothing {
    color: var(--ink-soft);
  }
  @media (pointer: coarse) {
    .button,
    .act .link,
    .filters select {
      min-height: 44px;
    }
    .button {
      display: inline-flex;
      align-items: center;
    }
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
    .found,
    .act {
      grid-column: 2;
    }
    .count {
      margin-left: 0;
    }
  }
</style>
