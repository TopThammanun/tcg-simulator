## Project

Pokémon TCG matchup simulator: the player's deck vs bots playing the top meta decks. The plan,
phases and gates are in `PLAN.md` (Thai). Work one phase at a time; each phase starts only after
the previous phase's gate passes and the user has checked it.

UI text is Thai; card names and card text stay in English.

## Commands

```
npm run cards      # rebuild data/cards.manifest.json + data/cards.report.md from src/content/decks
npm test           # Vitest (tests/): manifest gate, engine scenarios, every card, quick fuzz, bots, stats
npm run test:e2e   # Playwright against the production build (plays seeded games to the end)
npm run check      # astro check + svelte-check
npm run fuzz -- --games 10000         # Phase 1 gate: random legal moves, invariants after every action
npm run sim -- --games 1000 [--check] # your list vs each bot deck; --exp all runs the 5 experiments
npx tsx scripts/hard-gate.ts --games 1000   # v3 gate: hard bot vs normal bot (mirror matches)
npx tsx scripts/tune.ts --iterations 3000 --validate 8000 --hard 480   # SPSA self-play tuning of src/bots/params.ts
# The bot's network (BOT-RESEARCH.md). Python lives in ml/.venv (PyTorch CUDA build for the RTX 5060 Ti); run from the repo root.
npx tsx scripts/learn/gen.ts <config.json>   # bot games on every CPU thread -> training shards (format in scripts/learn/shard.ts)
ml/.venv/Scripts/python ml/train_bc.py --data .cache/learn/bc --out .cache/learn/bc.json   # imitation of the recorded bot
ml/.venv/Scripts/python ml/ppo.py --init .cache/learn/bc.json --dir .cache/learn/ppo   # self-play PPO; resumes; log.jsonl
ml/.venv/Scripts/python ml/match.py --a search:src/bots/learn/weights.json --b hard   # A vs B: every deck pair, both seats
npx tsx scripts/learn/parity.ts <net.json> <dir> && ml/.venv/Scripts/python ml/parity.py <net.json> <dir>   # TS = PyTorch
npx tsx scripts/show-game.ts <deckA> <deckB> [seed] [--net]   # read one bot game's log (--net: the game's bot)
npx tsx scripts/meta/limitless.ts [--days 30]   # real tournaments (Limitless): data/meta/limitless.json + .cache/meta/lists.json
npx tsx scripts/meta/compare.ts [--games 4000]   # the bots' matchups next to real players' -> data/meta/compare.md
npx tsx scripts/meta/variants.ts   # real lists our engine can play, per deck -> .cache/meta/variants.json (gen.ts `variants`, ppo.py --variants)
npx tsx scripts/meta/pick-lists.ts [--write --only a,b]   # each bot deck's most typical recent top list that the engine can play
npx tsx scripts/analyze-games.ts <tcg-sim-games-*.json>   # the bot's turns in games exported from /review/ -> .report.md
# ppo.py --starts <tcg-sim-games-*.json> [--starts-share 0.1]: some self-play games start from those games' positions (gen.ts `starts`)
npx tsx scripts/threat-gate.ts --games 2400   # phase 7 gate: "ภัยเทิร์นหน้า" chances vs what happened in bot games
npx tsx scripts/threat-gate.ts --fit --games 4000   # refit src/analysis/calibration.json (after changing bots or decks)
npx tsx scripts/review-gate.ts --games 330 --stability 160   # phase 8 gate: review win% vs results, same verdicts on another seed, time
npm run dev        # dev server on :4321
npm run build      # static site in dist/
```

`npm run cards` caches API responses in `.cache/http`; add `-- --refresh` to re-download. It reads the deck files and
`data/card-pool.txt` (cards real lists of our archetypes play that no deck file has; each needs an engine effect too).
pokemontcg.io fails often (502/500); the script retries and treats it as a secondary source.

## Layout

- `src/content/decks/*.md` — decklists (Limitless export format) with frontmatter (`src/data/deck-meta.ts`;
  `limitless` = the archetype's id on play.limitlesstcg.com, for comparing with real results)
- `data/meta/` — real tournament results (`scripts/meta/limitless.ts`) and how far the bots' matchups are from them
  (`scripts/meta/compare.ts`, `compare.md`)
- `src/data/` — plain TypeScript shared by scripts, pages and (later) the engine; no Astro imports
  except `astro/zod`
- `scripts/` — Node build scripts run with `tsx`
- `data/cards.manifest.json` — generated; card text keyed by card identity, images keyed by print
- `src/engine/` — rules. `apply(state, action)` returns a new state; a choice mid-effect throws
  `NeedChoice`, becomes `state.pending`, and the action is re-run from `pending.base` with the answers.
  Card effects: `effects/attacks.ts` (by attack name), `abilities.ts`, `trainers.ts`, `energy.ts`;
  passive Abilities, Tools and Stadiums are read where they apply in `rules.ts` / `combat.ts`.
  `tests/engine/coverage.test.ts` fails if a card with effect text has no implementation.
- `src/bots/` — the one bot (there are no difficulty levels): `index.ts` `createBot()` is always the strongest
  version measured: the policy/value network (`learn/weights.json`) with look-ahead (`learn/search.ts`: the
  policy's best few options plus the attack planner's line, played out on determinized deals and scored by the
  value head), or the hard bot when no network is bundled; `{ fast: true }` is the network alone (the simulator
  and its replays, the review's comparison turn).
  `learn/`: `encode.ts` (what the network sees: a token per Pokémon in play, card-count bags, globals, one row
  per legal action or pick; hidden zones only as combined counts), `model.ts` (forward pass; same layers as
  `ml/common.py`; version 2 files build card vectors from `card-features.ts`, the printed features, plus a vector
  per trained card, so new cards and changed lists keep the shapes: `ml/common.py` Net2, `train_bc.py --v2`), `netbot.ts` (plays from the policy, picks one at a time; `recordBot` turns any bot's moves
  into training rows). Trained by imitation of the hard bot, then self-play PPO with a league (`ml/`, data from
  `scripts/learn/gen.ts`). The rule-based bots stay as teachers, sparring partners and quick internal models:
  `core.ts` (development heuristics) + `finisher.ts` (simulated attack planning) + `choose.ts` (pending
  choices) + `plans/<deck>.ts`; `params.ts` holds their weights, tuned by SPSA (`scripts/tune.ts`);
  `hard.ts` adds Monte Carlo. On the play screen the bot runs in a Web Worker (`worker.ts`, `remote.ts`).
  `coach.ts` = hint button (the network's best three when bundled), `explain.ts` = its reasons (read from the
  position + the move played out on a determinized copy). Bots plan on `determinize()` so they never see hidden
  cards (it deals from the sorted hidden cards, so the result depends only on public information).
- `src/analysis/` — the analyser (PLAN.md, แผนรุ่นต่อไป). `threat.ts` = "ภัยเทิร์นหน้า": re-deal what you can't see,
  end your turn, let the rule-based bot play theirs (quick, and it plans exact Knock Out lines); the share of
  samples where each Pokémon is Knocked Out, corrected per opponent deck by `calibration.ts` (Platt scaling fitted
  by `scripts/threat-gate.ts --fit` against the real bot, because uniform re-deals give the opponent better hands
  than they hold, and the real bot plays differently). `counts.ts` = their Trainers by the reference list vs
  seen. Sampled in a Web Worker a batch at a time (`worker.ts`, `remote.ts`); shown by `ThreatPanel.svelte` and
  the KO badges on `SlotCard.svelte`. `winrate.ts` = win% by playing the game out (rule-based bots, quick; re-dealt
  hidden cards). `review.ts` = one of your turns reviewed: win% after it, clear mistakes (`sureLine`: the attack planner's
  line, fixed seeds, checked on several re-deals), the bot's turn on the real cards compared on the same deals;
  run on several workers by `review-remote.ts` / `review-worker.ts`.
- `src/review/` — `record.ts` (a finished game: seed + lists + actions; `replay()`, `turnsOf()`), `store.ts`
  (IndexedDB: games and their reviews, in memory when storage is blocked). The play screen saves every finished
  game; `/review/` exports them all as one file (`gamesFile`) and imports such files; (`components/review/Review.svelte`, `WinChart.svelte`) lists and reviews them;
  `/play/?resume=<id>&at=<state index>` plays a saved game on from that point.
- `src/ui/` — play-screen helpers: `play.ts` (labels, hand actions), `drag.ts` (drop zones: `data-drop` =
  `slot:<uid>` / `active` / `bench` / `play`), `press.ts` (pointer drag / long press for mouse and touch),
  `card-back.ts` (the real card back, loaded from pokemontcg.io; a drawn back if it fails), `menu.ts`
  (what the pop-up for a tapped Pokémon shows: attacks and why one can't be used, Abilities, retreat;
  rendered by `PokemonMenu.svelte` — attacking and retreating happen there, not in the dock).
- `src/ui/anim/` — animations (plan and research: `ANIMATION-PLAN.md`). `events.ts` reads what happened
  from the state before/after an action (pure, tested); `fx.ts` plays it with the Web Animations API on
  the overlay in `FxLayer.svelte`, finding things by `data-card` / `data-slot` / `data-zone`. The state
  changes at once; animations only show it, the bot waits for them, any input of yours skips them.
  Animations on real elements must not keep `fill: forwards` (it would pin HP and transforms).
- `src/sim/` — bot-vs-bot runner, stats (Wilson CI, meta-weighted and paired-difference), Web Worker.
- Pages: `/play/` (Game.svelte; `?watch=1&seed=…&opp=…` replays a simulator game, `&save=1` saves it), `/review/`,
  `/sim/`, `/decks/`.
  A running game fills the screen (nothing scrolls but the side column / drawer): Board.svelte sizes its
  cards from its box (`.table`, container query units), and the hand overlaps in a fan instead of scrolling.
  Setup (Active Spot, Bench) is done on the table with a confirm button in the dock, not a choice box.

## Versions

Astro is pinned to 6.x because this machine runs Node 22.16 and Astro 7 needs Node >= 22.23.4.
Astro 6 has published advisories fixed only in 7.x; upgrade Node, then
`npm i astro@latest @astrojs/svelte@latest`, before hosting publicly.
