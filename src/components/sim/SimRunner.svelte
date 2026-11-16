<script lang="ts">
  // โหมดรันหลายพันเกม: your deck (configurable strategy) vs every bot deck, on Web Workers.
  import { DEFAULT_POLICY, type PlayerPolicy } from '../../bots/plans';
  import { EXPERIMENTS, type PlayerConfig } from '../../sim/experiments';
  import type { BatchJob } from '../../sim/runner';
  import { seedsFor } from '../../sim/seeds';
  import { metaWeighted, pairedDiff, summarize, toCsv, type GameRecord, type Matchup } from '../../sim/stats';
  import type { FromWorker, ToWorker } from '../../sim/worker';
  import { myCards } from '../../ui/my-list';
  import DeckEditor from '../DeckEditor.svelte';

  interface DeckOption {
    slug: string;
    name: string;
    side: 'player' | 'bot';
    metaShare?: number;
    optional?: boolean;
    variant?: string;
    cards: string[];
  }
  let { decks, playerList }: { decks: DeckOption[]; playerList: string } = $props();

  const POLICY_KEY = 'tcg-sim:policy';
  function loadPolicy(): PlayerPolicy {
    try {
      return { ...DEFAULT_POLICY, ...JSON.parse(localStorage.getItem(POLICY_KEY) ?? '{}') };
    } catch {
      return { ...DEFAULT_POLICY };
    }
  }

  let mode = $state<'table' | 'experiment'>('table');
  let expId = $state('all');
  let games = $state(500);
  let baseSeed = $state(1);
  let festival = $state<'seaking' | 'dipplin'>('seaking');
  let policy = $state<PlayerPolicy>(loadPolicy());

  let running = $state(false);
  let done = $state(0);
  let total = $state(0);
  let elapsed = $state(0);
  let error = $state('');
  let groups = $state.raw<{ title: string; results: { config: PlayerConfig; rows: Matchup[]; records: GameRecord[] }[] }[]>([]);
  let copied = $state(false);
  let workers: Worker[] = [];
  let cancelled = false;

  const player = $derived(decks.find((d) => d.side === 'player')!);
  const opps = $derived(
    decks.filter((d) => d.side === 'bot' && (!d.variant || d.variant === festival)),
  );
  const share = (slug: string) => decks.find((d) => d.slug === slug)?.metaShare ?? 0;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  $effect(() => {
    try {
      localStorage.setItem(POLICY_KEY, JSON.stringify(policy));
    } catch {
      /* the coach falls back to the default policy */
    }
  });

  async function run() {
    error = '';
    running = true;
    cancelled = false;
    done = 0;
    groups = [];
    const plan: { title: string; configs: PlayerConfig[] }[] =
      mode === 'table'
        ? [{ title: 'list ของคุณ ตามกลยุทธ์ที่ตั้งไว้', configs: [{ label: 'กลยุทธ์ที่ตั้งไว้', policy: { ...policy } }] }]
        : EXPERIMENTS.filter((e) => expId === 'all' || e.id === expId).map((e) => ({ title: e.title, configs: [e.a, e.b] }));

    // Jobs of ~20 games so every worker stays busy.
    const jobs: { key: string; job: BatchJob }[] = [];
    for (const g of plan) {
      for (const config of g.configs) {
        for (const o of opps) {
          const seeds = seedsFor(baseSeed + o.slug.length * 100003, games);
          for (let i = 0; i < seeds.length; i += 20) {
            // Plain data only: Svelte state proxies can't be posted to a worker.
            const job = $state.snapshot({
              config,
              playerCards: myCards(player.cards).cards,
              opp: { slug: o.slug, cards: o.cards },
              seeds: seeds.slice(i, i + 20),
            }) as BatchJob;
            jobs.push({ key: `${g.title}|${config.label}|${o.slug}`, job });
          }
        }
      }
    }
    total = jobs.length * 20 - jobs.reduce((n, j) => n + (20 - j.job.seeds.length), 0);
    const started = performance.now();
    const timer = setInterval(() => (elapsed = (performance.now() - started) / 1000), 200);
    const records = new Map<string, GameRecord[]>();
    const n = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 16));
    workers = Array.from({ length: n }, () => new Worker(new URL('../../sim/worker.ts', import.meta.url), { type: 'module' }));
    let next = 0;
    const progress = new Map<number, number>();
    let finished = 0;

    await new Promise<void>((resolve) => {
      const feed = (w: Worker) => {
        if (cancelled || next >= jobs.length) {
          if (finished === jobs.length || cancelled) resolve();
          return;
        }
        const id = next++;
        try {
          w.postMessage({ type: 'run', id, job: jobs[id]!.job } satisfies ToWorker);
        } catch (e) {
          error = `ส่งงานให้ worker ไม่ได้: ${(e as Error).message}`;
          cancelled = true;
          resolve();
        }
      };
      for (const w of workers) {
        w.onmessage = (e: MessageEvent<FromWorker>) => {
          const m = e.data;
          if (m.type === 'progress') {
            progress.set(m.id, m.done);
            done = [...progress.values()].reduce((a, b) => a + b, 0);
            return;
          }
          if (m.type === 'error') {
            error = m.message;
            cancelled = true;
            resolve();
            return;
          }
          const key = jobs[m.id]!.key;
          records.set(key, [...(records.get(key) ?? []), ...m.games]);
          progress.set(m.id, m.games.length);
          done = [...progress.values()].reduce((a, b) => a + b, 0);
          finished++;
          if (finished === jobs.length) resolve();
          else feed(w);
        };
        feed(w);
      }
    });
    clearInterval(timer);
    elapsed = (performance.now() - started) / 1000;
    for (const w of workers) w.terminate();
    workers = [];
    running = false;
    if (cancelled) return;

    groups = plan.map((g) => ({
      title: g.title,
      results: g.configs.map((config) => {
        const recs = opps.flatMap((o) => records.get(`${g.title}|${config.label}|${o.slug}`) ?? []);
        return { config, rows: opps.map((o) => summarize(o.slug, recs.filter((r) => r.opp === o.slug))), records: recs };
      }),
    }));
  }

  function cancel() {
    cancelled = true;
    for (const w of workers) w.terminate();
    workers = [];
    running = false;
  }

  const csv = $derived(groups.flatMap((g) => g.results.map((r) => toCsv(r.rows, `${g.title} / ${r.config.label}`))).join('\n'));
  const csvUrl = $derived(csv ? URL.createObjectURL(new Blob([csv], { type: 'text/csv' })) : '');

  async function copyCsv() {
    try {
      await navigator.clipboard.writeText(csv);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      error = 'คัดลอกไม่ได้ในหน้านี้';
    }
  }

  function replayUrl(r: GameRecord, config: PlayerConfig): string {
    const p = new URLSearchParams({ watch: '1', seed: String(r.seed), opp: r.opp, speed: '500', policy: JSON.stringify(config.policy) });
    if (config.edit) p.set('edit', JSON.stringify(config.edit));
    return `/play/?${p}`;
  }

  /** Games worth a look: fastest losses and the longest games. */
  function interesting(records: GameRecord[]) {
    const losses = records.filter((r) => r.winner === 1).sort((a, b) => a.turns - b.turns).slice(0, 3);
    const long = records.slice().sort((a, b) => b.turns - a.turns).slice(0, 2);
    return [...losses.map((r) => ({ r, why: `แพ้เร็ว (${r.turns} เทิร์น)` })), ...long.map((r) => ({ r, why: `เกมยาว (${r.turns} เทิร์น)` }))];
  }

  const topPrizes = (m: Matchup) =>
    Object.entries(m.prizesBy)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(' · ');
</script>

<section class="controls">
  <div class="row">
    <label>
      โหมด
      <select bind:value={mode} disabled={running}>
        <option value="table">ตาราง matchup (กลยุทธ์ที่ตั้งเอง)</option>
        <option value="experiment">การทดลองชุดแรก (A เทียบ B)</option>
      </select>
    </label>
    {#if mode === 'experiment'}
      <label>
        การทดลอง
        <select bind:value={expId} disabled={running}>
          <option value="all">ครบ 5 ข้อ</option>
          {#each EXPERIMENTS as e}<option value={e.id}>{e.title}</option>{/each}
        </select>
      </label>
    {/if}
    <label>
      เกมต่อ matchup
      <select bind:value={games} disabled={running}>
        <option value={100}>100</option>
        <option value={500}>500</option>
        <option value={1000}>1,000</option>
      </select>
    </label>
    <label>
      Festival Lead
      <select bind:value={festival} disabled={running}>
        <option value="seaking">list Seaking</option>
        <option value="dipplin">list Dipplin</option>
      </select>
    </label>
    <label>Seed เริ่มต้น <input type="number" bind:value={baseSeed} disabled={running} /></label>
  </div>

  {#if mode === 'table'}
    <fieldset disabled={running}>
      <legend>กลยุทธ์ฝั่งคุณ (ใช้กับปุ่มแนะนำในหน้าเล่นด้วย)</legend>
      <label>
        Area Zero
        <select bind:value={policy.areaZero}>
          <option value="hold">เก็บไว้ทับ Grounds</option>
          <option value="early">ลงตั้งแต่แรก</option>
        </select>
      </label>
      <label>
        Bench สูงสุด
        <select bind:value={policy.benchMax}>
          <option value={5}>5</option>
          <option value={8}>8</option>
        </select>
      </label>
      <label>
        Meowth ex
        <select bind:value={policy.meowth}>
          <option value="discard">ใช้ Ability แล้วทิ้งตอน Area Zero ออก</option>
          <option value="keep">เก็บไว้บน Bench</option>
        </select>
      </label>
      <label>
        ตัวตีหลัก
        <select bind:value={policy.mainAttacker}>
          <option value="auto">เลือกอัตโนมัติ</option>
          <option value="teal-mask-ogerpon-ex">Teal Mask Ogerpon ex</option>
          <option value="paldean-tauros">Paldean Tauros</option>
          <option value="raging-bolt-ex">Raging Bolt ex</option>
        </select>
      </label>
      <label class="check"><input type="checkbox" bind:checked={policy.capeWall} /> Kangaskhan + Hero's Cape เป็นกำแพง</label>
    </fieldset>
  {/if}

  <DeckEditor defaultList={playerList} />

  <div class="go">
    {#if running}
      <button type="button" onclick={cancel}>หยุด</button>
    {:else}
      <button type="button" class="primary" onclick={run}>เริ่มรัน</button>
    {/if}
    {#if running || done > 0}
      <div class="progress" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
        <span style={`width:${total ? (done / total) * 100 : 0}%`}></span>
      </div>
      <span class="mono">{done.toLocaleString()} / {total.toLocaleString()} เกม · {elapsed.toFixed(1)} วินาที</span>
    {/if}
  </div>
  {#if error}<p class="error">{error}</p>{/if}
</section>

{#each groups as g}
  <section class="group">
    <h2>{g.title}</h2>
    {#if g.results.length === 2}
      {@const a = metaWeighted(g.results[0]!.rows, share)}
      {@const b = metaWeighted(g.results[1]!.rows, share)}
      {@const d = pairedDiff(g.results[0]!.records, g.results[1]!.records, share)}
      <p class="verdict">
        <strong>{g.results[0]!.config.label}</strong> {pct(a.winRate)} vs <strong>{g.results[1]!.config.label}</strong> {pct(b.winRate)} ·
        ต่าง {(d.diff * 100).toFixed(1)} จุดเปอร์เซ็นต์ (95% CI {(d.ci[0] * 100).toFixed(1)} ถึง {(d.ci[1] * 100).toFixed(1)}, seed ชุดเดียวกัน)
        → {d.ci[0] > 0 || d.ci[1] < 0 ? 'ต่างกันจริง' : 'ยังแยกไม่ออกจากความบังเอิญ'}
      </p>
    {/if}
    <div class="configs" class:pair={g.results.length === 2}>
      {#each g.results as r}
        {@const w = metaWeighted(r.rows, share)}
        <div class="config">
          <h3>{r.config.label}</h3>
          <p class="weighted">
            win rate คาดหวังใน meta <strong>{pct(w.winRate)}</strong>
            <span class="mono">(95% CI {pct(w.ci[0])}–{pct(w.ci[1])})</span>
          </p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>เด็คบอท</th><th>share</th><th>ชนะ</th><th>95% CI</th><th>เทิร์น</th><th>prize ที่บอทได้ต่อเกม</th><th>ตี 2 ครั้ง/เกม</th><th>Gladion</th><th>Grounds หมด</th><th>mulligan คุณ/บอท</th></tr>
              </thead>
              <tbody>
                {#each r.rows as m}
                  <tr>
                    <td>{decks.find((d) => d.slug === m.opp)?.name}</td>
                    <td class="mono">{share(m.opp).toFixed(2)}%</td>
                    <td class="mono"><span class="bar" style={`--w:${m.winRate * 100}%`}></span>{pct(m.winRate)}</td>
                    <td class="mono">{pct(m.ci[0])}–{pct(m.ci[1])}</td>
                    <td class="mono">{m.avgTurns.toFixed(1)}</td>
                    <td class="small">{topPrizes(m)}</td>
                    <td class="mono">{m.doubleAttacksPerGame.toFixed(2)}</td>
                    <td class="mono">{pct(m.gladionRate)}</td>
                    <td class="mono">{pct(m.festivalOutRate)}</td>
                    <td class="mono">{pct(m.mulliganRate[0])}/{pct(m.mulliganRate[1])}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <details>
            <summary>เกมที่น่าดู (เปิด replay)</summary>
            <ul class="replays">
              {#each interesting(r.records) as { r: rec, why }}
                <li><a href={replayUrl(rec, r.config)} target="_blank" rel="noopener">seed {rec.seed} vs {rec.opp}</a> · {why}</li>
              {/each}
            </ul>
          </details>
        </div>
      {/each}
    </div>
  </section>
{/each}

{#if groups.length}
  <div class="export">
    <a class="button" href={csvUrl} download="matchup.csv">ดาวน์โหลด CSV</a>
    <button type="button" onclick={copyCsv}>{copied ? 'คัดลอกแล้ว' : 'คัดลอก CSV'}</button>
  </div>
{/if}

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border: 2px solid var(--ink);
    background: var(--card-bg);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.85rem;
    font-weight: 500;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 0;
    padding: 10px 12px;
    border: 1.5px solid var(--rule);
  }
  legend {
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  select,
  input[type='number'] {
    padding: 5px 8px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }
  button,
  .button {
    padding: 6px 16px;
    border: 1.5px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: var(--ink);
    color: var(--paper);
    font-family: var(--font-display);
    font-weight: 600;
  }
  .go {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  }
  .progress {
    flex: 1;
    min-width: 160px;
    height: 12px;
    border: 1px solid var(--ink);
    background: var(--paper-deep);
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--stamp);
  }
  .error {
    margin: 0;
    color: var(--stamp);
  }
  .group {
    margin-top: 28px;
  }
  .group h2 {
    font-size: 1.3rem;
    margin: 0 0 6px;
  }
  .verdict {
    margin: 0 0 12px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--teal) 12%, transparent);
  }
  .configs {
    display: grid;
    gap: 16px;
  }
  .config {
    min-width: 0;
    padding: 12px;
    border: 1.5px solid var(--ink);
    background: var(--card-bg);
  }
  .config h3 {
    margin: 0 0 4px;
    font-size: 1rem;
  }
  .weighted {
    margin: 0 0 8px;
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  th,
  td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--rule);
    text-align: left;
    white-space: nowrap;
  }
  th {
    font-family: var(--font-display);
    font-weight: 600;
  }
  td.small {
    white-space: normal;
    min-width: 180px;
    color: var(--ink-soft);
  }
  .bar {
    display: inline-block;
    width: 40px;
    height: 8px;
    margin-right: 6px;
    border: 1px solid var(--ink);
    background: linear-gradient(to right, var(--stamp) var(--w), transparent var(--w));
  }
  .replays {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: 0.85rem;
  }
  .export {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
