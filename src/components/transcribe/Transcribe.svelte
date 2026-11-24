<svelte:options runes={true} />

<script lang="ts">
  // ถอดเกมจริง (BOT-PRO.md P0): a real game from a broadcast, entered move by move. The engine plays it as the
  // transcriber clicks (ui/transcribe.ts), dealing stand-ins for every card the broadcast doesn't show; a stand-in
  // becomes the card seen the moment it is played or picked. The table is the play screen's Board, for reading only;
  // the moves are picked from lists on the right. The game in progress is kept in this browser and exported as a games
  // file (the review page's format) with its deal.
  import { langOfPath, setLang, tx } from '../../i18n';
  import { actor } from '../../engine/actions';
  import { def } from '../../engine/db';
  import { standInsOf } from '../../engine/script';
  import { keyOf } from '../../engine/state';
  import type { CardId, PlayerId } from '../../engine/types';
  import { deckKeys, fromText } from '../../ui/builder';
  import { nearestDeck, type MetaDeck } from '../../ui/decks';
  import {
    act,
    commands,
    current,
    exportText,
    flipsOf,
    fromSaved,
    isKnown,
    name as nameCardIn,
    nameUnseen,
    setFlip,
    standIns,
    startTranscript,
    toSaved,
    undo,
    unseenKeys,
    unseenOptions,
    verify,
    type Transcript,
  } from '../../ui/transcribe';
  import { gamesFile, readGamesFile, type ProMeta } from '../../review/record';
  import Board from '../game/Board.svelte';
  import Button from '../ui/Button.svelte';

  let { decks }: { decks: MetaDeck[] } = $props();

  setLang(langOfPath(location.pathname));

  /** The game being transcribed, kept between visits (a saved game with its deal). */
  const KEY = 'tcg-sim-transcript';
  const SOURCES: { id: ProMeta['source']; label: string }[] = [
    { id: 'stream-en', label: tx('ถ่ายทอดสด Play Pokémon (ไม่เห็นมือ)', 'Play Pokémon stream (hands not shown)') },
    { id: 'stream-jp', label: tx('ถ่ายทอดสดช่องทางการญี่ปุ่น', 'Japanese official stream') },
    { id: 'ptcgl', label: tx('คลิปเล่น PTCG Live', 'PTCG Live video') },
    { id: 'other', label: tx('อื่น ๆ', 'Other') },
  ];

  // ---------- the match sheet ----------
  let lists = $state<[string, string]>(['', '']);
  let names = $state<[string, string]>(['', '']);
  let event = $state('');
  let round = $state('');
  let video = $state('');
  let at = $state('');
  let source = $state<ProMeta['source']>('stream-en');
  let mulligans = $state<[number, number]>([0, 0]);

  const parsed = $derived(lists.map((text) => fromText(text)));
  /** Each seat's 60 card keys, or what is wrong with its list. */
  const sheets = $derived(
    parsed.map((p) => {
      const cards = deckKeys(p.deck);
      const problems = [
        ...p.unsupported.map((n) => tx(`ยังเล่น ${n} ไม่ได้`, `${n} can't be played yet`)),
        ...p.ambiguous.map((n) => tx(`${n} มีหลายใบที่ข้อความต่างกัน ใส่ชุดและเลขด้วย`, `${n} names several cards: add its set and number`)),
        ...p.unreadable.map((l) => tx(`อ่านไม่ออก: ${l}`, `Can't read: ${l}`)),
        ...(cards.length && cards.length !== 60 ? [tx(`มี ${cards.length} ใบ (ต้อง 60)`, `${cards.length} cards (60 needed)`)] : []),
      ];
      return { cards, problems };
    }),
  );
  const canStart = $derived(sheets.every((s) => s.cards.length === 60 && s.problems.length === 0) && names.every((n) => n.trim()));

  let resumable = $state(false);
  try {
    resumable = !!localStorage.getItem(KEY);
  } catch {
    resumable = false;
  }

  // ---------- transcribing ----------
  let t = $state.raw<Transcript | null>(null);
  let error = $state('');
  let filter = $state('');
  /** A pick of several options, marked so far. */
  let picks = $state<number[]>([]);
  /** The card picker is open: for one stand-in, or for the first unseen card among `among` (a choice's options, else the hand). */
  let naming = $state<{ card?: CardId; among?: CardId[] } | null>(null);
  let pickerFilter = $state('');
  let checked = $state<string[] | null>(null);
  let restartArmed = $state(false);

  const cur = $derived(t ? current(t) : null);
  const who = $derived<PlayerId>(cur ? actor(cur) : 0);
  const req = $derived(cur?.pending?.request ?? null);
  const cmds = $derived(cur ? commands(cur) : []);
  const shown = $derived(filter.trim() ? cmds.filter((c) => c.label.toLowerCase().includes(filter.trim().toLowerCase())) : cmds);
  const flips = $derived(t ? flipsOf(t) : []);
  const unseenInHand = $derived(cur ? standIns(cur, who) : []);
  /** Each seat's cards, the player to act first: the hand, and the stand-ins the engine has put in play or discarded. */
  const seats = $derived(
    cur
      ? ([who, who === 0 ? 1 : 0] as PlayerId[]).map((p) => ({ p, hand: cur!.players[p].hand, ...standInsOf(cur!, p) }))
      : [],
  );
  const unseenOpts = $derived(cur ? unseenOptions(cur) : []);
  const keys = $derived(cur ? unseenKeys(cur, naming?.card !== undefined ? cur.cards[naming.card]!.owner : who) : []);
  const keysShown = $derived(pickerFilter.trim() ? keys.filter((k) => k.name.toLowerCase().includes(pickerFilter.trim().toLowerCase())) : keys);
  const note = $derived(t && cur ? (t.pro.notes?.[String(cur.turn)] ?? '') : '');
  const multi = $derived(!!req && (req.max > 1 || !!req.repeat));

  function start() {
    const cards: [string[], string[]] = [sheets[0]!.cards, sheets[1]!.cards];
    const plans: [string, string] = [nearestDeck(cards[0], decks).slug, nearestDeck(cards[1], decks).slug];
    const pro: ProMeta = {
      event: event.trim(),
      ...(round.trim() ? { round: round.trim() } : {}),
      players: [names[0].trim(), names[1].trim()],
      ...(video.trim() ? { video: video.trim() } : {}),
      ...(at.trim() && !Number.isNaN(Number(at)) ? { at: Number(at) } : {}),
      source,
      notes: {},
    };
    set(startTranscript({ decks: cards, names: pro.players, plans, pro, mulligans: [mulligans[0], mulligans[1]] }));
  }

  function resume() {
    try {
      const g = readGamesFile(localStorage.getItem(KEY)!)[0]!;
      set(fromSaved(g));
    } catch (e) {
      error = (e as Error).message;
    }
  }

  /** Every change goes through here: the transcript is kept in this browser. */
  function set(next: Transcript) {
    t = next;
    error = '';
    picks = [];
    naming = null;
    pickerFilter = '';
    filter = '';
    checked = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(gamesFile([toSaved(next)])));
    } catch {
      /* storage blocked: the export still works */
    }
  }

  function tryTo(f: () => Transcript) {
    try {
      set(f());
    } catch (e) {
      error = (e as Error).message;
    }
  }

  const choose = (values: number[]) => tryTo(() => act(t!, { t: 'choose', picks: values }));
  function onOption(value: number) {
    if (!multi) return choose([value]);
    picks = req!.repeat || !picks.includes(value) ? [...picks, value] : picks.filter((v) => v !== value);
  }

  function pickKey(key: string) {
    const n = naming;
    if (!n || !t) return;
    tryTo(() => (n.card !== undefined ? nameCardIn(t!, n.card, key) : nameUnseen(t!, key, n.among)).t);
    // A card seen as it is played: its moves come up first.
    if (!error && n.card === undefined && !current(t).pending) filter = def(key).name;
  }

  function setNote(text: string) {
    if (!t || !cur) return;
    set({ ...t, pro: { ...t.pro, notes: { ...(t.pro.notes ?? {}), [String(cur.turn)]: text } } });
  }

  function download() {
    if (!t) return;
    const file = new Blob([exportText(t)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = `pro-${(t.pro.event || 'game').replace(/[^\w-]+/g, '_')}-${(t.pro.round || `${t.pro.players[0]}-vs-${t.pro.players[1]}`).replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function restart() {
    if (!restartArmed) {
      restartArmed = true;
      return;
    }
    restartArmed = false;
    t = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing kept */
    }
    resumable = false;
  }

  const cardName = (c: CardId) => (cur && isKnown(cur, c) ? def(keyOf(cur, c)).name : '?');
  const noop = () => {};
</script>

{#if !t || !cur}
  <section class="sheet">
    <h1 class="heading-4">{tx('ถอดเกมจริง', 'Transcribe a real game')}</h1>
    <p class="body-7 muted">
      {tx(
        'วาง list ของทั้งสองฝั่ง (export จาก Limitless) แล้วเล่นตามคลิปทีละท่า การ์ดที่คลิปไม่ได้เผยจะเป็น "?" จนกว่าจะถูกเล่นหรือเลือก',
        "Paste both lists (Limitless export) and enter the game move by move as the video shows it. A card the video never shows stays a '?' until it is played or picked.",
      )}
    </p>
    {#if resumable}
      <p><Button variant="primary" onclick={resume}>{tx('ถอดต่อเกมที่ค้างไว้', 'Go on with the game in progress')}</Button></p>
    {/if}
    <div class="seats">
      {#each [0, 1] as p (p)}
        <div class="seat">
          <h2 class="heading-6">{p === 0 ? tx('ฝั่งล่าง (ผู้เล่น 1)', 'Bottom seat (player 1)') : tx('ฝั่งบน (ผู้เล่น 2)', 'Top seat (player 2)')}</h2>
          <label class="field">
            <span class="caption-5">{tx('ชื่อผู้เล่น', 'Player')}</span>
            <input type="text" bind:value={names[p]} />
          </label>
          <label class="field">
            <span class="caption-5">{tx('list (export text)', 'List (export text)')}</span>
            <textarea rows="10" bind:value={lists[p]} spellcheck="false"></textarea>
          </label>
          <label class="field small">
            <span class="caption-5">{tx('mulligan กี่ครั้ง', 'Mulligans')}</span>
            <input type="number" min="0" max="9" bind:value={mulligans[p]} />
          </label>
          {#if sheets[p]!.problems.length}
            <ul class="problems caption-5">
              {#each sheets[p]!.problems as pr (pr)}<li>{pr}</li>{/each}
            </ul>
          {:else if sheets[p]!.cards.length === 60}
            <p class="caption-5 muted">{tx(`60 ใบ · แผนที่ใช้ทบทวน: ${nearestDeck(sheets[p]!.cards, decks).name}`, `60 cards · reviewed as ${nearestDeck(sheets[p]!.cards, decks).name}`)}</p>
          {/if}
        </div>
      {/each}
    </div>
    <div class="meta">
      <label class="field"><span class="caption-5">{tx('รายการ', 'Event')}</span><input type="text" bind:value={event} placeholder="Worlds 2026" /></label>
      <label class="field"><span class="caption-5">{tx('รอบ / เกม', 'Round / game')}</span><input type="text" bind:value={round} placeholder="Finals game 1" /></label>
      <label class="field"><span class="caption-5">{tx('วิดีโอ (YouTube id หรือ URL)', 'Video (YouTube id or URL)')}</span><input type="text" bind:value={video} /></label>
      <label class="field small"><span class="caption-5">{tx('เริ่มที่วินาที', 'Starts at (s)')}</span><input type="text" bind:value={at} inputmode="numeric" /></label>
      <label class="field">
        <span class="caption-5">{tx('แหล่ง', 'Source')}</span>
        <select bind:value={source}>{#each SOURCES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}</select>
      </label>
    </div>
    <p><Button variant="primary" disabled={!canStart} onclick={start}>{tx('เริ่มถอดเกม', 'Start transcribing')}</Button></p>
    {#if error}<p class="error body-7">{error}</p>{/if}
  </section>
{:else}
  <section class="work">
    <div class="table"><Board s={cur} targets={new Set()} picks={new Map()} abilities={new Map()} onslot={noop} onzoom={noop} ondiscard={noop} /></div>
    <aside class="panel">
      <header class="head">
        <p class="caption-5 muted">{t.pro.event}{t.pro.round ? ` · ${t.pro.round}` : ''}</p>
        <p class="body-7">
          <strong>{tx(`เทิร์น ${cur.turn}`, `Turn ${cur.turn}`)}</strong>
          · {t.names[0]} {tx('Prize เหลือ', 'Prizes left')} <span class="mono">{cur.players[0].prizes.length}</span>
          · {t.names[1]} <span class="mono">{cur.players[1].prizes.length}</span>
        </p>
      </header>

      {#if cur.winner !== null}
        <p class="body-7"><strong>{cur.winner === 'draw' ? tx('เสมอ', 'Draw') : tx(`${t.names[cur.winner]} ชนะ`, `${t.names[cur.winner]} wins`)}</strong> · {cur.winReason}</p>
      {:else}
        <h2 class="heading-6">{tx(`ตาของ ${t.names[who]}`, `${t.names[who]} to act`)}</h2>
      {/if}

      {#if flips.length}
        <div class="flips caption-5">
          <span class="muted">{tx('เหรียญของท่านี้:', 'This move’s coins:')}</span>
          {#each flips as f (f.index)}
            <button type="button" class="flip" onclick={() => tryTo(() => setFlip(t!, f.index, !f.heads))}>{f.heads ? tx('หัว', 'heads') : tx('ก้อย', 'tails')}</button>
          {/each}
          <span class="muted">{tx('(กดเพื่อสลับให้ตรงคลิป)', '(tap to match the video)')}</span>
        </div>
      {/if}

      {#if naming}
        <div class="picker">
          <p class="body-7"><strong>{tx('การ์ดใบนี้คือ…', 'This card is…')}</strong></p>
          <input type="text" bind:value={pickerFilter} placeholder={tx('ค้นชื่อการ์ด', 'Search the list')} />
          <ul class="list">
            {#each keysShown as k (k.key)}
              <li><button type="button" class="row" onclick={() => pickKey(k.key)}>{k.name} <span class="mono muted">×{k.left}</span></button></li>
            {/each}
          </ul>
          <Button size="sm" onclick={() => (naming = null)}>{tx('ยกเลิก', 'Cancel')}</Button>
        </div>
      {:else if req}
        <div class="choice">
          <p class="body-7">{req.prompt}</p>
          {#if unseenOpts.length}
            <p class="caption-5">
              <button type="button" class="row accent" onclick={() => (naming = { among: unseenOpts })}>{tx(`เลือกใบที่ยังไม่เห็น (${unseenOpts.length} ใบ) → ระบุว่าเป็นใบไหน`, `Pick an unseen card (${unseenOpts.length}): say which`)}</button>
            </p>
          {/if}
          <ul class="list">
            {#each req.options as o (o.value)}
              {#if o.card === undefined || isKnown(cur, o.card)}
                <li><button type="button" class={['row', picks.includes(o.value) && 'picked']} onclick={() => onOption(o.value)}>{o.label}</button></li>
              {/if}
            {/each}
          </ul>
          {#if multi}
            <p class="caption-5 muted">{tx(`เลือกแล้ว ${picks.length} (${req.min}–${req.max})`, `${picks.length} picked (${req.min}–${req.max})`)}</p>
            <Button size="sm" variant="primary" disabled={picks.length < req.min || picks.length > req.max} onclick={() => choose(picks)}>{tx('ยืนยัน', 'Confirm')}</Button>
          {:else if req.min === 0}
            <Button size="sm" onclick={() => choose([])}>{tx('ไม่เลือก', 'Pick nothing')}</Button>
          {/if}
        </div>
      {:else if cur.winner === null}
        <div class="free">
          {#if unseenInHand.length}
            <button type="button" class="row accent" onclick={() => (naming = { among: unseenInHand })}>{tx(`เล่นการ์ดที่ยังไม่เห็น (ในมือ ${unseenInHand.length} ใบ)`, `Play an unseen card (${unseenInHand.length} in hand)`)}</button>
          {/if}
          <input type="text" bind:value={filter} placeholder={tx('ค้นท่า', 'Search moves')} />
          <ul class="list">
            {#each shown as c, i (i)}
              <li><button type="button" class={['row', c.action.t === 'end' && 'end']} onclick={() => tryTo(() => act(t!, c.action))}>{c.label}</button></li>
            {/each}
          </ul>
        </div>
      {/if}

      {#each seats as seat (seat.p)}
        <div class="hand">
          <p class="caption-5 muted">{tx(`มือของ ${t.names[seat.p]} (${seat.hand.length} ใบ)`, `${t.names[seat.p]}'s hand (${seat.hand.length})`)}</p>
          <p class="chips">
            {#each seat.hand as c (c)}
              {#if isKnown(cur, c)}
                <span class="chip">{cardName(c)}</span>
              {:else}
                <button type="button" class="chip unseen" title={tx('ระบุว่าเป็นใบไหน (ถ้าคลิปเผยให้เห็น)', 'Say which card it is (when the video shows it)')} onclick={() => (naming = { card: c })}>?</button>
              {/if}
            {/each}
          </p>
          {#if seat.play.length || seat.discard.length}
            <p class="caption-5 warn">
              {tx('ใบที่ engine วางให้โดยยังไม่รู้ว่าใบไหน:', 'Cards the engine placed without knowing which they are:')}
              {#each seat.play as c (c)}
                <button type="button" class="chip unseen" onclick={() => (naming = { card: c })}>{tx('ในสนาม', 'in play')} ?</button>
              {/each}
              {#each seat.discard as c (c)}
                <button type="button" class="chip unseen" onclick={() => (naming = { card: c })}>{tx('กองทิ้ง', 'discard')} ?</button>
              {/each}
            </p>
          {/if}
        </div>
      {/each}

      {#if error}<p class="error body-7">{error}</p>{/if}

      <label class="field">
        <span class="caption-5">{tx(`โน้ตเทิร์น ${cur.turn} (คำบรรยาย เหตุผล)`, `Notes for turn ${cur.turn} (commentary, reasons)`)}</span>
        <textarea rows="2" value={note} onchange={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)}></textarea>
      </label>

      <div class="tools">
        <Button size="sm" onclick={() => tryTo(() => undo(t!))} disabled={t.states.length < 2}>{tx('ถอยหนึ่งท่า', 'Undo')}</Button>
        <Button size="sm" onclick={() => (checked = verify(t!))}>{tx('ตรวจเล่นซ้ำ', 'Check replay')}</Button>
        <Button size="sm" variant="primary" onclick={download}>{tx('ดาวน์โหลดเกม', 'Download the game')}</Button>
        <Button size="sm" variant={restartArmed ? 'danger' : 'ghost'} onclick={restart}>{restartArmed ? tx('ทิ้งเกมนี้จริง ๆ', 'Really drop this game') : tx('เริ่มเกมใหม่', 'New game')}</Button>
      </div>
      {#if checked}
        <p class={['caption-5', checked.length ? 'error' : 'ok']}>{checked.length ? checked.join(' · ') : tx('เล่นซ้ำได้ตรงทุกตำแหน่ง', 'The replay matches every position')}</p>
      {/if}
      <p class="caption-5 muted">{tx(`${t.actions.length} ท่า · เห็นแล้ว ${cur.script?.known.length ?? 0} ใบ`, `${t.actions.length} moves · ${cur.script?.known.length ?? 0} cards seen`)}</p>
    </aside>
  </section>
{/if}

<style>
  .muted {
    color: var(--ink-soft);
  }
  .error {
    color: var(--stamp);
  }
  .ok {
    color: var(--teal);
  }
  .warn {
    color: var(--warn-ink);
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .sheet {
    max-width: 960px;
  }
  .sheet h1 {
    margin: 0 0 8px;
  }
  .seats,
  .meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
    margin: 24px 0;
  }
  .seat {
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
  }
  .seat h2 {
    margin: 0 0 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .field.small {
    max-width: 160px;
  }
  input,
  textarea,
  select {
    font: inherit;
    font-size: 14px;
    padding: 8px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--raised);
    color: var(--ink);
  }
  textarea {
    font-family: var(--font-mono);
    font-size: 12px;
    resize: vertical;
  }
  .problems {
    margin: 0;
    padding-left: 18px;
    color: var(--stamp);
  }
  .work {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    gap: 16px;
    align-items: start;
  }
  .table {
    position: relative;
    height: min(78vh, 720px);
    container-type: size;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: min(78vh, 720px);
    padding: 16px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--card-bg);
  }
  .head p,
  .panel h2 {
    margin: 0;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 320px;
    margin: 8px 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--raised);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--control-hover);
  }
  .row.picked {
    border-color: var(--accent);
    background: var(--control);
  }
  .row.accent {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .row.end {
    border-color: var(--primary);
  }
  .flips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .flip {
    padding: 2px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--control);
    color: var(--ink);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 4px 0 0;
  }
  .chip {
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--raised);
    font-size: 12px;
  }
  .chip.unseen {
    border-style: dashed;
    border-color: var(--line-strong);
    color: var(--ink-soft);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .hand p,
  .choice p,
  .picker p {
    margin: 0;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  @media (max-width: 900px) {
    .work {
      grid-template-columns: 1fr;
    }
    .table {
      height: min(60vh, 520px);
    }
    .panel {
      max-height: none;
    }
  }
</style>
