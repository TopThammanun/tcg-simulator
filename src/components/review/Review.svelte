<script lang="ts">
  // วิจารณ์เกม (PLAN.md phase 8): your saved games; for one game, every turn of yours reviewed on Web
  // Workers (src/analysis/review.ts): win% after it, clear mistakes, the hard bot's turn from the same
  // position, the board at the start and end of the turn with every hidden card shown, and a link to play
  // on from that turn. Reviews are stored with the game, so opening it again is instant.
  import type { TurnReview, Verdict } from '../../analysis/review';
  import { reviewGame, type ReviewRun } from '../../analysis/review-remote';
  import { keyOf } from '../../engine/state';
  import type { GameState, PlayerId } from '../../engine/types';
  import { gamesFile, readGamesFile, replay, turnsOf, type SavedGame, type TurnSpan } from '../../review/record';
  import { deleteGame, getGame, getReview, listGames, persistent, saveGame, saveReview } from '../../review/store';
  import Board from '../game/Board.svelte';
  import CardFace from '../game/CardFace.svelte';
  import CardInfo from '../game/CardInfo.svelte';
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
  let at = $state<'start' | 'end'>('start');
  let zoom = $state<string | null>(null);
  let run: ReviewRun | null = null;
  $effect(() => () => run?.cancel());

  const VERDICT: Record<Verdict, { label: string; cls: string }> = {
    'missed-win': { label: '✗ พลาดชัด: มีทางชนะ', cls: 'bad' },
    'missed-ko': { label: '✗ พลาดชัด: มีทาง KO มากกว่า', cls: 'bad' },
    better: { label: '▲ น่าจะมีทางที่ดีกว่า', cls: 'warn' },
    ok: { label: '● ไม่พบจุดพลาด', cls: 'ok' },
  };
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const sorted = $derived([...turns].sort((a, b) => a.turn - b.turn));
  const count = (v: Verdict[]) => turns.filter((t) => v.includes(t.verdict)).length;
  const result = (g: SavedGame) => (g.winner === 0 ? 'ชนะ' : g.winner === 1 ? 'แพ้' : 'เสมอ');
  const date = (ms: number) => new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

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

  /** Every saved game as one file, to keep, move to another browser, or send for analysis. */
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

  const pick = $derived(selected === null ? null : (sorted.find((t) => t.turn === selected) ?? null));
  /** The board at the start or end of the picked turn, every card shown. */
  const shown = $derived(pick ? states[at === 'start' ? pick.span.start : pick.span.end] : null);
  const cards = (s: GameState, ids: number[]) => ids.map((c) => keyOf(s, c));
  const NONE = new Set<number>();
  const EMPTY = new Map<number, never>();
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if id === null}
  {#if games === null}
    <p class="muted">กำลังโหลด…</p>
  {:else if games.length === 0}
    <p class="muted">ยังไม่มีเกมที่บันทึกไว้ เล่นกับบอทจนจบเกม แล้วเกมจะถูกเก็บไว้ที่นี่ (ในเบราว์เซอร์นี้)</p>
    <a class="cta" href="/play/">เล่นกับบอท →</a>
  {:else}
    <table class="games">
      <thead><tr><th>เมื่อ</th><th>คู่แข่ง</th><th>ผล</th><th>เทิร์น</th><th></th></tr></thead>
      <tbody>
        {#each games as g (g.id)}
          <tr>
            <td>{date(g.savedAt)}</td>
            <td>{g.opponentName}</td>
            <td class:won={g.winner === 0} class:lost={g.winner === 1}>{result(g)}</td>
            <td class="mono">{g.turns}</td>
            <td class="act">
              <a href={`/review/?id=${g.id}`}>วิจารณ์ →</a>
              <button type="button" class="link" onclick={() => remove(g)}>ลบ</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  <p class="files">
    {#if games?.length}<button type="button" onclick={exportGames}>ดาวน์โหลดทุกเกม (.json)</button>{/if}
    <label class="import">นำเข้าเกมจากไฟล์<input type="file" accept=".json,application/json" onchange={importGames} /></label>
    {#if note}<span class="muted">{note}</span>{/if}
  </p>
  {#if !persistent}<p class="muted">เบราว์เซอร์นี้เก็บข้อมูลไม่ได้ เกมจะหายเมื่อปิดหน้า</p>{/if}
{:else if game}
  <section class="head">
    <p>
      <strong>{result(game)}</strong> vs {game.opponentName} · {game.reason} · เทิร์น {game.turns} · {date(game.savedAt)}
    </p>
    <p class="summary">
      {#if !done}
        กำลังวิเคราะห์ {turns.length}/{spans.length} เทิร์น…
        <progress max={spans.length} value={turns.length}></progress>
      {:else}
        พลาดชัด <strong class="bad">{count(['missed-win', 'missed-ko'])}</strong> · น่าจะมีทางที่ดีกว่า
        <strong class="warn">{count(['better'])}</strong> · จาก {turns.length} เทิร์นของคุณ
      {/if}
    </p>
    <a href="/review/">← เกมทั้งหมด</a>
  </section>

  {#if sorted.length}<WinChart turns={sorted} {selected} />{/if}

  <div class="layout">
    <ol class="turns">
      {#each sorted as t (t.turn)}
        <li class:sel={selected === t.turn}>
          <div class="row">
            <strong>เทิร์น {t.turn}</strong>
            <span class={`badge ${VERDICT[t.verdict].cls}`}>{VERDICT[t.verdict].label}</span>
            <span class="mono win" title="win% หลังจบเทิร์นนี้ (± ความคลาดเคลื่อน)">{pct(t.win.p)} ±{Math.round(t.win.se * 100)}</span>
          </div>
          <p><span class="tag">คุณเล่น</span>{t.played.length ? t.played.join(' → ') : 'จบเทิร์นโดยไม่ทำอะไร'}</p>
          {#if t.missed}
            <p class="bad-text">
              {t.missed.kind === 'win' ? 'มีทางชนะเกมในเทิร์นนี้' : `มีทาง KO ได้ ${t.missed.prizes} Prize (คุณได้ ${t.missed.took})`}
              {t.missed.at === t.span.start ? 'ตั้งแต่ต้นเทิร์น' : 'ตอนที่คุณเลือกจบเทิร์น'}: {t.missed.line.join(' → ')}
            </p>
          {/if}
          {#if t.alt}
            <p>
              <span class="tag">บอทจะเล่น</span>{t.alt.played.length ? t.alt.played.join(' → ') : 'จบเทิร์นโดยไม่ทำอะไร'}
            </p>
            <p class="muted">
              win% ทางของบอท {pct(t.alt.win.p)} เทียบกับของคุณ {pct(t.win.p)} · ต่าง {t.alt.diff >= 0 ? '+' : ''}{Math.round(t.alt.diff * 100)} ±{Math.round(
                t.alt.se * 200,
              )} จุด · ภัยเทิร์นหน้า: ของคุณ ~{t.exposure.toFixed(1)} Prize, ของบอท ~{t.alt.exposure.toFixed(1)}
            </p>
          {:else}
            <p class="muted">บอทก็เล่นแบบเดียวกัน · ภัยเทิร์นหน้า ~{t.exposure.toFixed(1)} Prize</p>
          {/if}
          <div class="buttons">
            <button type="button" onclick={() => ((selected = selected === t.turn ? null : t.turn), (at = 'start'))}>
              {selected === t.turn ? 'ซ่อนสนาม' : 'ดูสนาม'}
            </button>
            <a class="button" href={`/play/?resume=${game.id}&at=${t.span.start}`}>ลองเล่นใหม่จากตรงนี้ →</a>
          </div>
        </li>
      {/each}
    </ol>

    {#if pick && shown}
      <section class="viewer" aria-label={`สนามเทิร์น ${pick.turn}`}>
        <div class="seg">
          <button type="button" class:on={at === 'start'} onclick={() => (at = 'start')}>ต้นเทิร์น {pick.turn}</button>
          <button type="button" class:on={at === 'end'} onclick={() => (at = 'end')}>จบเทิร์น</button>
        </div>
        <div class="table">
          <Board
            s={shown}
            targets={NONE}
            picks={EMPTY}
            abilities={EMPTY}
            onslot={() => {}}
            onzoom={(k) => (zoom = k)}
            ondiscard={() => {}}
          />
        </div>
        <p class="muted">การ์ดที่ตอนนั้นมองไม่เห็น เปิดให้ดูทั้งหมด</p>
        {#each [['มือบอท', shown.players[1].hand], ['Prize ของบอท', shown.players[1].prizes], ['มือคุณ', shown.players[0].hand], ['Prize ของคุณ', shown.players[0].prizes]] as [label, ids] (label)}
          <h4>{label} ({(ids as number[]).length})</h4>
          <div class="cards">
            {#each cards(shown, ids as number[]) as k, i (i)}
              <button type="button" onclick={() => (zoom = k)}><CardFace cardKey={k} /></button>
            {/each}
          </div>
        {/each}
      </section>
    {/if}
  </div>

  <p class="note">
    พลาดชัด = ตัววางแผนโจมตีหาทางที่ชนะหรือได้ Prize มากกว่า และทางนั้นใช้ได้ทุกแบบที่สุ่มการ์ดที่คุณมองไม่เห็นใหม่
    (ตรวจด้วย engine ไม่ขึ้นกับฝีมือบอท) · น่าจะมีทางที่ดีกว่า = ทางของบอทให้ win% สูงกว่าอย่างน้อย 8 จุด และมากกว่า 2.5
    เท่าของความคลาดเคลื่อน (เล่นต่อจนจบเกมด้วยบอทแบบกฎที่คิดเร็ว เป็นค่าประมาณ) · win% คิดจากสิ่งที่คุณเห็นตอนนั้นเท่านั้น
  </p>
{/if}

{#if zoom}<CardInfo cardKey={zoom} onclose={() => (zoom = null)} />{/if}

<style>
  .muted {
    color: var(--ink-soft);
  }
  .error {
    color: var(--stamp);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .games {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .games th,
  .games td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--rule);
    text-align: left;
  }
  .games .won {
    color: var(--teal);
    font-weight: 600;
  }
  .games .lost {
    color: var(--stamp);
    font-weight: 600;
  }
  .act {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }
  .files {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
    margin-top: 1rem;
  }
  .import {
    cursor: pointer;
    text-decoration: underline;
  }
  .import:focus-within {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .import input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--ink-soft);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .cta {
    display: inline-block;
    margin-top: 8px;
    padding: 8px 16px;
    background: var(--ink);
    color: var(--paper);
    text-decoration: none;
  }
  .head p {
    margin: 0 0 4px;
  }
  .summary progress {
    vertical-align: middle;
    width: 140px;
  }
  .bad {
    color: #d03b3b;
  }
  .warn {
    color: #b07a00;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    margin-top: 14px;
  }
  @media (min-width: 1100px) {
    .layout:has(.viewer) {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      align-items: start;
    }
    .viewer {
      position: sticky;
      top: 12px;
    }
  }
  .turns {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .turns > li {
    padding: 10px 12px;
    border: 1.5px solid var(--rule);
    background: var(--card-bg);
    font-size: 0.88rem;
  }
  .turns > li.sel {
    border-color: var(--ink);
  }
  .turns p {
    margin: 4px 0 0;
    line-height: 1.5;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
  }
  .win {
    margin-left: auto;
  }
  .badge {
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
  }
  .badge.bad {
    background: #d03b3b;
    color: #fff;
  }
  .badge.warn {
    background: #fab219;
    color: #0b0b0b;
  }
  .badge.ok {
    border: 1px solid var(--rule);
    color: var(--ink-soft);
  }
  .bad-text {
    color: var(--ink);
    border-left: 3px solid #d03b3b;
    padding-left: 8px;
  }
  .tag {
    margin-right: 6px;
    padding: 0 5px;
    border: 1px solid var(--teal);
    color: var(--teal);
    font-size: 0.72rem;
    font-weight: 600;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .buttons button,
  .button,
  .seg button {
    padding: 4px 12px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 0.82rem;
    text-decoration: none;
    cursor: pointer;
  }
  .seg {
    display: flex;
    gap: 0;
    margin-bottom: 8px;
  }
  .seg button.on {
    background: var(--ink);
    color: var(--paper);
  }
  /* Board.svelte sizes its cards from this box (container query units). */
  .table {
    position: relative;
    height: min(620px, 80vh);
    container-type: size;
  }
  .viewer h4 {
    margin: 10px 0 4px;
    font-size: 0.85rem;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 6px;
  }
  .cards button {
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  .note {
    margin-top: 16px;
    color: var(--ink-soft);
    font-size: 0.78rem;
    line-height: 1.5;
  }
</style>
