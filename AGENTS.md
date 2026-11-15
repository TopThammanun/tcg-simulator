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
npx tsx scripts/hard-gate.ts --games 1000   # v3 gate: hard bot vs normal bot (mirror matches); --bot pro --vs hard
npx tsx scripts/tune.ts --iterations 3000 --validate 8000 --hard 480   # SPSA self-play tuning of src/bots/params.ts
npx tsx scripts/train.ts --generations 4 --games 1600 --gate 480   # value-network self-play training (~10 min/generation)
npx tsx scripts/show-game.ts <deckA> <deckB> [seed]   # read one bot game's log
npm run dev        # dev server on :4321
npm run build      # static site in dist/
```

`npm run cards` caches API responses in `.cache/http`; add `-- --refresh` to re-download.
pokemontcg.io fails often (502/500); the script retries and treats it as a secondary source.

## Layout

- `src/content/decks/*.md` — decklists (Limitless export format) with frontmatter (`src/data/deck-meta.ts`)
- `src/data/` — plain TypeScript shared by scripts, pages and (later) the engine; no Astro imports
  except `astro/zod`
- `scripts/` — Node build scripts run with `tsx`
- `data/cards.manifest.json` — generated; card text keyed by card identity, images keyed by print
- `src/engine/` — rules. `apply(state, action)` returns a new state; a choice mid-effect throws
  `NeedChoice`, becomes `state.pending`, and the action is re-run from `pending.base` with the answers.
  Card effects: `effects/attacks.ts` (by attack name), `abilities.ts`, `trainers.ts`, `energy.ts`;
  passive Abilities, Tools and Stadiums are read where they apply in `rules.ts` / `combat.ts`.
  `tests/engine/coverage.test.ts` fails if a card with effect text has no implementation.
- `src/bots/` — `core.ts` (development heuristics) + `finisher.ts` (simulated attack planning) +
  `choose.ts` (pending choices) + `plans/<deck>.ts`; `params.ts` holds the main weights, tuned by self-play
  (`scripts/tune.ts`, SPSA); `hard.ts` adds Monte Carlo; `pro.ts` = the same search
  scored by a value network (`learn/`: `features.ts`, `net.ts`, `weights.json`) trained AlphaZero-style by
  `scripts/train.ts` (self-play → fit → a gate match; a network is kept only if it wins significantly;
  `data/training-log.md`). On the play screen the opponent bot runs in a Web Worker (`worker.ts`,
  `remote.ts`). `coach.ts` = hint button,
  `explain.ts` = its reasons (read from the position + the move played out on a determinized copy).
  Bots plan on `determinize()` so they never see hidden cards.
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
- Pages: `/play/` (Game.svelte; `?watch=1&seed=…&opp=…` replays a simulator game), `/sim/`, `/decks/`.
  A running game fills the screen (nothing scrolls but the side column / drawer): Board.svelte sizes its
  cards from its box (`.table`, container query units), and the hand overlaps in a fan instead of scrolling.
  Setup (Active Spot, Bench) is done on the table with a confirm button in the dock, not a choice box.

## Versions

Astro is pinned to 6.x because this machine runs Node 22.16 and Astro 7 needs Node >= 22.23.4.
Astro 6 has published advisories fixed only in 7.x; upgrade Node, then
`npm i astro@latest @astrojs/svelte@latest`, before hosting publicly.
