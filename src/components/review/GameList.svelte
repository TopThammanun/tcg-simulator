<script lang="ts" module>
  /** A Gym Leader (lib/decks.ts gymLeaders): beat one of its decks and its badge is yours. */
  export interface Gym {
    name: string;
    slugs: string[];
    shape: number;
    type: string;
  }
</script>

<script lang="ts">
  // ประวัติเกม: your trainer card: your record (games, wins, a bar per opponent deck, and a link to practise the
  // matchup you lose most) and your badge case (a gym's badge for a win over its deck, each a link to challenge it),
  // the saved games (each with what its review found, or that it hasn't been reviewed), filtered by your deck, the
  // opponent and the result; a file of them all to keep, and such files imported. A deleted game can be put back for
  // a few seconds.
  import { href, lang, tx } from '../../i18n';
  import type { SavedGame } from '../../review/record';
  import { gamesFile, readGamesFile, reasonText } from '../../review/record';
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
  import GymBadge from '../GymBadge.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Toast from '../ui/Toast.svelte';

  let { gyms = [] }: { gyms?: Gym[] } = $props();

  let games = $state.raw<SavedGame[] | null>(null);
  let reviews = $state.raw(new Map<number, StoredReview>());
  let error = $state('');

  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const result = (g: SavedGame) => (g.winner === 0 ? tx('ชนะ', 'Won') : g.winner === 1 ? tx('แพ้', 'Lost') : tx('เสมอ', 'Draw'));
  const date = (ms: number) => new Date(ms).toLocaleString(lang() === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  const yours = (g: SavedGame) => g.mineName ?? tx('list ของคุณ', 'Your list');
  /** The opponent's archetype: list variants ("Festival Lead (Dipplin)") count together. */
  const archetype = (g: SavedGame) => g.opponentName.replace(/ \(.*\)$/, '');

  /** Your record: games, wins, and per opponent deck; the matchup lost most is offered for practice. */
  const record = $derived.by(() => {
    const done = (games ?? []).filter((g) => g.winner !== null);
    const by = new Map<string, { name: string; won: number; lost: number; href: string }>();
    // Newest first, so a row links to the decks of its latest game.
    for (const g of done) {
      const name = archetype(g);
      const r = by.get(name) ?? { name, won: 0, lost: 0, href: href(`/play/?opp=${g.opponent}${g.mine && g.mine !== 'player' ? `&me=${g.mine}` : ''}`) };
      if (g.winner === 0) r.won++;
      else if (g.winner === 1) r.lost++;
      by.set(name, r);
    }
    const rows = [...by.values()].sort((a, b) => b.won + b.lost - (a.won + a.lost));
    const worst = rows.filter((r) => r.lost > 0).sort((a, b) => b.lost - a.lost || a.won - b.won)[0]?.name ?? null;
    const won = done.filter((g) => g.winner === 0).length;
    return { played: done.length, won, rows, worst };
  });

  /** The gyms whose badge you hold: a win over one of their decks. */
  const earned = $derived(new Set(gyms.filter((gym) => (games ?? []).some((g) => g.winner === 0 && gym.slugs.includes(g.opponent))).map((gym) => gym.name)));
  /** The badge to go for next: the most played deck you haven't beaten. */
  const nextGym = $derived(gyms.find((gym) => !earned.has(gym.name)));

  // Filters.
  let mineFilter = $state('');
  let oppFilter = $state('');
  let resultFilter = $state<'all' | 'won' | 'lost'>('all');
  const RESULTS = [
    { value: 'all' as const, label: tx('ทั้งหมด', 'All') },
    { value: 'won' as const, label: tx('ชนะ', 'Won') },
    { value: 'lost' as const, label: tx('แพ้', 'Lost') },
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
      note = tx(`นำเข้า ${fresh.length} เกม`, `${fresh.length} games imported`);
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
  <p class="muted">{tx('กำลังโหลด…', 'Loading…')}</p>
{:else if games.length === 0}
  <div class="empty">
    <p>
      {tx(
        'ยังไม่มีเกม เล่นกับบอทจนจบเกม แล้วเกมจะถูกเก็บไว้ที่นี่ (ในเบราว์เซอร์นี้) พร้อมบอกว่าเทิร์นไหนที่เกมพลิก',
        'No games yet. Play the bot to the end and the game is kept here (in this browser), with the turn the game turned on.',
      )}
    </p>
    <a class="cta" href={href('/play/')}>{tx('เล่นกับบอท', 'Play the bot')}</a>
    {#if gyms.length}<div class="empty-case">{@render badgeCase()}</div>{/if}
  </div>
{:else}
  {#if record.played}
    <section class="record" aria-label={tx('บัตรเทรนเนอร์ของคุณ', 'Your trainer card')}>
      <p class="card-title">{tx('บัตรเทรนเนอร์', 'Trainer card')}</p>
      <div class="totals">
        <div><span class="num">{record.played}</span>{tx('เกม', 'games')}</div>
        <div><span class="num">{pct(record.won / record.played)}</span>{tx('ชนะ', 'won')}</div>
        {#if gyms.length}<div><span class="num">{earned.size}/{gyms.length}</span>{tx('เหรียญยิม', 'badges')}</div>{/if}
      </div>
      <ol class="vs">
        {#each record.rows as r (r.name)}
          <li>
            <span class="name">vs {r.name}</span>
            <span class="bar" style:--w={`${(r.won / Math.max(1, r.won + r.lost)) * 100}%`}></span>
            <span class="mono wl">{r.won}–{r.lost}</span>
            {#if r.name === record.worst}<a class="practice" href={r.href}>{tx('ซ้อม matchup นี้ →', 'Practise this matchup →')}</a>{/if}
          </li>
        {/each}
      </ol>
      {#if gyms.length}{@render badgeCase()}{/if}
    </section>
  {/if}

  <div class="filters" role="search" aria-label={tx('กรองเกม', 'Filter the games')}>
    <label>
      {tx('เด็คของคุณ', 'Your deck')}
      <select bind:value={mineFilter}>
        <option value="">{tx('ทุกเด็ค', 'Every deck')}</option>
        {#each mineNames as n}<option value={n}>{n}</option>{/each}
      </select>
    </label>
    <label>
      {tx('คู่แข่ง', 'Opponent')}
      <select bind:value={oppFilter}>
        <option value="">{tx('ทุกเด็ค', 'Every deck')}</option>
        {#each oppNames as n}<option value={n}>{n}</option>{/each}
      </select>
    </label>
    <Segmented label={tx('ผล', 'Result')} options={RESULTS} bind:value={resultFilter} />
    <span class="count">{tx(`${shownGames.length} จาก ${games.length} เกม`, `${shownGames.length} of ${games.length} games`)}</span>
  </div>

  <ul class="games">
    {#each shownGames as g (g.id)}
      {@const f = found(g)}
      <li>
        <span class="res" class:won={g.winner === 0} class:lost={g.winner === 1}>{result(g)}</span>
        <span class="match">
          <strong>{yours(g)} <span class="vs-word">vs</span> {g.opponentName}</strong>
          <span class="muted">
            {g.mode === 'practice' ? tx('โหมดฝึก · ', 'Practice · ') : ''}{tx(`${g.turns} เทิร์น`, `${g.turns} turns`)} · {reasonText(g.reason)} · {date(g.savedAt)}
          </span>
        </span>
        <span class="found" class:none={!f}>
          {#if !f}{tx('ยังไม่ได้ทบทวน', 'Not reviewed yet')}{:else if f.missed || f.better}
            {#if f.missed}<span class="bad" title={tx('พลาดชัด', 'Clear slip')}>✗{f.missed}</span>{/if}
            {#if f.better}<span class="warn" title={tx('น่าจะมีทางที่ดีกว่า', 'Likely a better way')}>▲{f.better}</span>{/if}
          {:else}{tx('ไม่พบจุดพลาด', 'No slip found')}{/if}
        </span>
        <span class="act">
          <a class="button" href={href(`/review/?id=${g.id}`)}>{tx('ทบทวน', 'Review')}</a>
          <button type="button" class="link" onclick={() => remove(g)}>{tx('ลบ', 'Delete')}</button>
        </span>
      </li>
    {:else}
      <li class="nothing">{tx('ไม่มีเกมที่ตรงกับตัวกรอง', 'No game matches the filters')}</li>
    {/each}
  </ul>
{/if}
<p class="files">
  {#if games?.length}<button type="button" class="link" onclick={exportGames}>{tx('สำรองทุกเกมเป็นไฟล์', 'Back up every game to a file')}</button>{/if}
  <label class="import">{tx('นำเข้าไฟล์สำรอง', 'Import a backup')}<input type="file" accept=".json,application/json" onchange={importGames} /></label>
  {#if note}<span class="muted">{note}</span>{/if}
</p>
{#if !persistent}<p class="muted">{tx('เบราว์เซอร์นี้เก็บข้อมูลไม่ได้ เกมจะหายเมื่อปิดหน้า', "This browser can't store data: the games are lost when the page closes")}</p>{/if}
{#if undo}
  <Toast
    message={tx(`ลบเกม ${yours(undo.game)} vs ${undo.game.opponentName} แล้ว`, `Deleted ${yours(undo.game)} vs ${undo.game.opponentName}`)}
    action={tx('เลิกทำ', 'Undo')} onaction={putBack} />
{/if}

{#snippet badgeCase()}
  <div class="case">
    <ul class="case-row" aria-label={tx(`เหรียญยิม ${earned.size} จาก ${gyms.length}`, `Gym badges: ${earned.size} of ${gyms.length}`)}>
      {#each gyms as gym (gym.name)}
        {@const has = earned.has(gym.name)}
        <li>
          <a
            href={href(`/play/?opp=${gym.slugs[0]}`)}
            title={has ? tx(`เหรียญของ ${gym.name}: ได้แล้ว`, `${gym.name}'s badge: earned`) : tx(`ท้าชิง ${gym.name}`, `Challenge ${gym.name}`)}
          >
            <GymBadge shape={gym.shape} type={gym.type} earned={has} size={36} label={has ? tx(`${gym.name} (ได้แล้ว)`, `${gym.name} (earned)`) : tx(`${gym.name} (ยังไม่ได้)`, `${gym.name} (not yet)`)} />
          </a>
        </li>
      {/each}
    </ul>
    <p class="case-next">
      {#if nextGym}{tx(`เหรียญถัดไป: ชนะ ${nextGym.name}`, `Next badge: beat ${nextGym.name}`)}{:else}{tx('เก็บครบทุกเหรียญแล้ว', 'Every badge collected')}{/if}
    </p>
  </div>
{/snippet}

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
  /* Your trainer card: the record, the matchups and the badge case. */
  .record {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 24px 32px;
    align-items: center;
    margin-bottom: 24px;
    padding: 24px;
    border: 1px solid var(--rule);
    border-radius: var(--radius-xl);
    background: var(--card-bg);
  }
  .card-title {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--brand);
    font-size: 12px;
    line-height: 16px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .totals {
    display: flex;
    gap: 32px;
  }
  .case {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: center;
    padding-top: 16px;
    border-top: 1px solid var(--rule);
  }
  .case-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .case-row a {
    display: block;
    border-radius: var(--radius);
    transition: transform 0.5s var(--ease);
  }
  .case-row a:hover {
    transform: translateY(-2px) rotate(-8deg);
  }
  .case-next {
    margin: 0;
    color: var(--ink-soft);
    font-size: 14px;
    line-height: 20px;
  }
  .empty-case {
    margin-top: 24px;
  }
  .empty-case .case {
    justify-content: center;
    border-top: 0;
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
    background: color-mix(in srgb, var(--theirs) 55%, var(--control));
  }
  .vs .bar::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--w);
    background: var(--brand);
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
    border-color: color-mix(in srgb, var(--theirs) 50%, transparent);
    color: var(--theirs);
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
    color: var(--warn);
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
