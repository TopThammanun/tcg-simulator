## Project

Pokémon TCG matchup simulator: the player's deck vs bots playing the top meta decks. The plan,
phases and gates are in `PLAN.md` (Thai). Work one phase at a time; each phase starts only after
the previous phase's gate passes and the user has checked it.

The site is in two languages: Thai at `/`, English at `/en/` (`src/i18n/`). Every text a player sees is written in
place, Thai first: `tx('จบเทิร์น', 'End turn')` in the engine, bots, `src/ui` and Svelte, `t(…)` = `tFor(lang)` in Astro
pages. Never call `tx` at module top level (the language is set at start: `setLang` in each island and worker). Card
names and card text stay in English in both. The bot must not read its text (labels, prompts): it plays the same in
both languages (`tests/i18n/english.test.ts`).

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
ml/.venv/Scripts/python ml/train_bc.py --data .cache/learn/bc --out .cache/learn/bc.json   # imitation of the recorded bot (soft targets: a recorded network's logits, shard optLogit)
ml/.venv/Scripts/python ml/ppo.py --init .cache/learn/bc.json --dir .cache/learn/ppo   # self-play PPO; resumes; log.jsonl
#   the networks' moves run batched on the GPU (ml/serve.py <- scripts/learn/batched.ts, ~8x the games; --no-server = old way);
#   --overlap plays the next iteration while this one trains, --resign 0.03 lets hopeless sides give up (BOT-LEAP.md L1)
#   --focus <deck> trains one deck's expert (BOT-NEXT.md: --vs-meta, --variants-a, --pfsp, --patience); --widen --inputs /
#   --critic: encoder version 4's inputs, the critic that sees all; --sure: imitate lines proved to win; --offmeta: other lists
ml/.venv/Scripts/python ml/match.py --a search:src/bots/learn/weights.json --b hard   # A vs B: every deck pair, both seats (--server: net/bot players batched on the GPU)
ml/.venv/Scripts/python ml/ladder.py play <A> <B> [--a-decks <deck>]   # one match into data/learn/ladder.jsonl; `table` = everyone's Elo
ml/.venv/Scripts/python ml/decks.py --a net:<expert> --b net:<W> --decks <deck>   # A plays that deck vs B on every deck (the expert gates) -> data/learn/decks.jsonl
ml/.venv/Scripts/python ml/experts.py assemble|best|ship   # deck experts: an expert set (folder of <deck>.json + default.json), a run's best eval, float16 into src/bots/learn/experts/ (ship --no-look-ahead <decks>)
ml/.venv/Scripts/python ml/league.py --start <set> --root <dir> -- <ppo.py args>   # the experts' league: each deck's expert vs the previous round's set
ml/.venv/Scripts/python ml/refresh.py --set <set> --decks <changed> --out <new set> [--ship]   # a deck's list or rules changed: its expert trains on, the better one goes into a new set
ml/.venv/Scripts/python ml/ablate.py --base <expert> --deck <deck> --root <dir>   # each new input group / the critic / --sure vs a control trained as long
npx tsx scripts/learn/blunders.ts --games 240 [--fast]   # sure wins and Knock Outs the bot misses (--fast: the network alone)
npx tsx scripts/learn/deck-skills.ts [--weights <file or set>]   # how each deck is piloted: attacks and Prizes per turn, Slowking's combo
npx tsx scripts/learn/positions.ts --deck slowking --out <file>   # start positions for ppo.py --starts (Slowking ready to Seek)
ml/.venv/Scripts/python ml/serve_check.py <net.json>   # the GPU server gives model.ts's answers on the same rows
npx tsx scripts/learn/parity.ts <net.json> <dir> && ml/.venv/Scripts/python ml/parity.py <net.json> <dir>   # TS = PyTorch
npx tsx scripts/show-game.ts <deckA> <deckB> [seed] [--net]   # read one bot game's log (--net: the game's bot)
npx tsx scripts/meta/limitless.ts [--days 30]   # real tournaments (Limitless): data/meta/limitless.json + .cache/meta/lists.json
npx tsx scripts/meta/compare.ts [--games 4000] [--weights <net or expert set> --out <md>]   # the bots' matchups next to real players' -> data/meta/compare.md
npx tsx scripts/meta/variants.ts   # real lists our engine can play, per deck -> .cache/meta/variants.json (gen.ts `variants`, ppo.py --variants)
npx tsx scripts/meta/pick-lists.ts [--write --only a,b]   # each bot deck's most typical recent top list that the engine can play
npx tsx scripts/analyze-games.ts <tcg-sim-games-*.json>   # the bot's turns in games exported from /review/ -> .report.md
# ppo.py --starts <tcg-sim-games-*.json> [--starts-share 0.1]: some self-play games start from those games' positions (gen.ts `starts`)
npx tsx scripts/threat-gate.ts --games 2400   # phase 7 gate: "ภัยเทิร์นหน้า" chances vs what happened in bot games
npx tsx scripts/threat-gate.ts --fit --games 4000   # refit src/analysis/calibration.json (after changing bots or decks)
npx tsx scripts/review-gate.ts --games 600 --stability 120   # review gate: win% (the network's value) vs results, same verdicts on other re-deals, time
npm run dev        # dev server on :4321
npm run build      # static site in dist/ (SITE_URL=https://… npm run build: absolute canonical/hreflang/sitemap/OG/JSON-LD addresses)
```

`npm run cards` caches API responses in `.cache/http`; add `-- --refresh` to re-download. It reads the deck files and
`data/card-pool.txt` (cards real lists of our archetypes play that no deck file has; each needs an engine effect too).
pokemontcg.io fails often (502/500); the script retries and treats it as a secondary source. A print's picture comes from
TCGdex, else pokemontcg.io, else (Basic Energy) the SVE art, else another print with the same text, else Limitless's
own scan by set and number (`limitless`, e.g. the Grookey MEP 52 promo neither API has yet).

## Layout

- `src/content/decks/*.md` — decklists (Limitless export format) with frontmatter (`src/data/deck-meta.ts`;
  `limitless` = the archetype's id on play.limitlesstcg.com, for comparing with real results). The `bot` decks are the
  meta decks the site offers on both sides (`metaDecks()`, `archetypes()` in `src/lib/decks.ts`); `player.md` is the
  scripts' own list (simulator, gates, training) and is not shown on the site.
- `data/meta/` — real tournament results (`scripts/meta/limitless.ts`) and how far the bots' matchups are from them
  (`scripts/meta/compare.ts`, `compare.md`)
- `src/i18n/` — the two languages: `tx(th, en)` (the current language, `setLang`), `tFor(lang)` for Astro, `localePath`
  / `href` for links that keep the language, `langPaths()` for pages under `src/pages/[...lang]/` (built at `/…` and
  `/en/…`; `Base.astro` writes `<html lang>`, the canonical and hreflang links once `site` is set, and the switch to the
  other language; `sitemap.xml.ts` / `robots.txt.ts` list every page in both). Islands read the language from
  `location.pathname`; Web Workers from their `name` (`remote.ts`). A visitor is sent to their language by an inline
  script at the top of `Base.astro`'s head: the language picked with the switch (localStorage `LANG_KEY`), else Thai for
  a browser set to Thai or on Thai time (Asia/Bangkok), English for everyone else; crawlers and automated browsers
  (`navigator.webdriver`, a bot or headless user agent) stay where they are, and `x-default` is the English page.
  Search: `lib/seo.ts` (each language's keywords, schema.org JSON-LD: WebSite on every page, WebApplication + FAQPage
  on the home page, BreadcrumbList / ItemList on the deck pages); pages pass `words` and `jsonLd` to `Base.astro`.
  English log verbs agree with the player's name (`verb`, `possessive`: "You draw", "Bot draws"); the play screen
  reads log lines in either language (`ui/anim/events.ts`, `ui/recap.ts`). A stored review keeps its language
  (`review/store.ts`); a saved game's end reason is shown in the page's (`reasonText`). `404.astro` has both.
- `src/data/` — plain TypeScript shared by scripts, pages and (later) the engine; no Astro imports
  except `astro/zod`
- `scripts/` — Node build scripts run with `tsx`
- `data/cards.manifest.json` — generated; card text keyed by card identity, images keyed by print
- `src/engine/` — rules. `apply(state, action)` returns a new state; a choice mid-effect throws
  `NeedChoice`, becomes `state.pending`, and the action is re-run from `pending.base` with the answers.
  Card effects: `effects/attacks.ts` (by attack name), `abilities.ts`, `trainers.ts`, `energy.ts`;
  passive Abilities, Tools and Stadiums are read where they apply in `rules.ts` / `combat.ts`.
  What each player can know is kept on `PlayerState` (`prizesKnown` after looking through the whole deck; `revealed`:
  cards the opponent knows are in that hand; this and the last turn's cards played, attack and Prizes taken:
  `played` / `lastPlayed`, `attacked` / `lastAttack`, `turnPrizes` / `lastPrizes`); `determinize()` keeps what is known.
  `tests/engine/coverage.test.ts` fails if a card with effect text has no implementation.
- `src/bots/` — the one bot (there are no difficulty levels): `index.ts` `createBot()` is always the strongest
  version measured: the policy/value network (`learn/weights.json`) with look-ahead (`learn/search.ts`: the
  policy's best few options plus the attack planner's line, played out on determinized deals and scored by the
  value head), or the hard bot when no network is bundled; `{ fast: true }` is the network alone (the simulator
  and its replays, the review's comparison turn). A bot deck can have its own network, an expert trained on that deck
  (`learn/experts/<deck>.json`, float16, `ml/experts.py ship`): `experts.ts` loads it in the worker at `init`, as its
  own chunk; decks without one, and a failed load, play the bundled network. An expert whose file has
  `meta.search` (`ship --no-look-ahead`: its deck gains under 3 points from the look-ahead) plays without it, at once;
  `SEARCH.ties` picks at random among the moves within 2% of the best. Scripts find the same files with
  `scripts/lib/experts.ts`, and every weights argument also takes an expert set (a folder of `<deck>.json` + `default.json`).
  `scripts/learn/gen.ts` plays training games; with a `server` in its config, `batched.ts` keeps many games in flight
  per worker and sends every waiting decision to `ml/serve.py` (one select loop, CUDA graphs per batch size) in one frame
  (`deep.ts`: the look-ahead with its rollouts batched there too, no deadline).
  `learn/`: `encode.ts` (what the network sees: a token per Pokémon in play, card-count bags, globals, one row
  per legal action or pick; hidden zones only as combined counts; version 4 adds what the player knows and each option
  tried on the engine, `outcomes`; a network trained on fewer inputs reads its own sizes, `INPUTS_V3`, and
  `ml/common.py widen()` adds the new ones at zero), `model.ts` (forward pass; same layers as
  `ml/common.py`; version 2 files build card vectors from `card-features.ts`, the printed features, plus a vector
  per trained card, so new cards and changed lists keep the shapes: `ml/common.py` Net2, `train_bc.py --v2`; version 3 is a transformer over every Pokémon, card with a count and option, on the
  same rows: `model3.ts` = `ml/net3.py`, `train_bc.py --v3 --bf16`; BOT-LEAP.md L3), `netbot.ts` (plays from the policy, picks one at a time; `recordBot` turns any bot's moves
  into training rows; `sureTarget` marks the first move of a line proved to win, for `ppo.py --sure`). Trained by imitation of the hard bot, then self-play PPO with a league (`ml/`, data from
  `scripts/learn/gen.ts`). The rule-based bots stay as teachers, sparring partners and quick internal models:
  `core.ts` (development heuristics) + `finisher.ts` (simulated attack planning; `sureLine` also runs `winLine` in
  endgames: every order of the moves that draw, search and flip nothing, for a win this turn) + `choose.ts` (pending
  choices) + `plans/<deck>.ts`; `params.ts` holds their weights, tuned by SPSA (`scripts/tune.ts`);
  `hard.ts` adds Monte Carlo. On the play screen the bot runs in a Web Worker (`worker.ts`, `remote.ts`).
  `coach.ts` = the network's best three moves with reasons (`explain.ts`: read from the position + the move played out
  on a determinized copy); its hint button was removed from the play screen with practice mode (20 Nov), only tests use it now. Bots plan on `determinize()` so they never see hidden
  cards (it deals from the sorted hidden cards, so the result depends only on public information).
- `src/analysis/` — the analyser (PLAN.md, แผนรุ่นต่อไป). `threat.ts` = "ภัยเทิร์นหน้า": re-deal what you can't see,
  end your turn, let the rule-based bot play theirs (quick, and it plans exact Knock Out lines); the share of
  samples where each Pokémon is Knocked Out, corrected per opponent deck by `calibration.ts` (Platt scaling fitted
  by `scripts/threat-gate.ts --fit` against the real bot, because uniform re-deals give the opponent better hands
  than they hold, and the real bot plays differently). `counts.ts` = their Trainers by the reference list vs
  seen. Sampled in a Web Worker a batch at a time (`worker.ts`, `remote.ts`). The play screen no longer shows them
  (practice mode was removed, 20 Nov); the code and its gate are kept for analysis. `winrate.ts` = win% by playing the game out (rule-based bots, quick; re-dealt
  hidden cards), or `netWin` (the network's value head on re-deals: one forward pass each). `review.ts` = one of your
  turns reviewed: win% before and after it (`winOf`: netWin, the chance if both sides play on like the bot; each
  side's positions judged by the network its deck plays with, `Nets`: the experts of your deck's plan and of the
  opponent's, which the workers load), clear mistakes (`sureLine`: the attack planner's line, fixed seeds, checked on
  several re-deals), the bot's turn (your deck's network) on the real cards judged on the same re-deals, where it
  parts from yours and why (`explain.ts`); for a turn worth a look (`gains.ts`), what the better way (the missed
  line, else the bot's turn) gets you next to yours, read off both positions once the turn has passed (Prizes and
  Knock Outs, damage left on theirs, attackers set for next turn, Pokémon and Energy in play, cards kept, their hand),
  and what it plays around: the opponent's next turn sampled from both positions (`threat.ts` with `ending: null`,
  calibrated per deck: their chance to win, the Prizes they are expected to take, your Pokémon much safer, with the
  line that takes them in yours), and what your way had going for it; run on several workers by `review-remote.ts` / `review-worker.ts`.
  Changing the analysis: bump `REVIEW_VERSION` in `src/review/store.ts`.
- `src/review/` — `record.ts` (a finished game: seed + lists + actions, your deck's plan `mine`, `mode`, and the undos'
  re-deals `redeals`; `replay()`, `turnsOf()`; a game keeps its `rules`, and `Rules.version` (`engine/state.ts`
  `RULES_VERSION`) is raised by a fix that changes how games play out, the old behaviour kept for older games so they
  replay), `store.ts`
  (IndexedDB: games and their reviews, in memory when storage is blocked). The play screen saves every finished
  game; `/review/` exports them all as one file (`gamesFile`) and imports such files. `components/review/`:
  `Review.svelte` routes to `GameList.svelte` (your record with a link to practise the matchup lost most, the games
  filtered by deck / opponent / result, each with what its review found, `listReviews()`) or `GameReview.svelte`
  (one game: the result and one sentence on what mattered most, a button going through the turns worth a look,
  `summary.ts` `keyTurns` / `reviewSummary`; `WinChart.svelte`, two points per turn of yours, your turns solid and
  the bot's dashed, `winPoints`; a strip of the turns; `TurnDetail.svelte`, the turn's verdict, the moves played
  alike folded, the two ways from there as cards, `turnLines`). On a computer the turn is on the table beside it
  (`ReplayStage.svelte`: Board, hand, step controls, animations; your way or the bot's); on a phone
  `ReplayViewer.svelte` shows it full screen (a `<dialog>` around ReplayStage) with the moves and the hidden cards:
  your turn, or the bot's from the same start (`TurnReview.alt.actions`);
  `/play/?resume=<id>&at=<state index>` plays a saved game on from that point. `current.ts`: the game being played,
  kept in localStorage after every move (the same record, so `replay()` rebuilds the very same position); the match
  sheet offers "เล่นต่อเกมที่ค้างไว้"; cleared when the game ends or is left.
- `src/ui/` — play-screen helpers: `decks.ts` (a deck's headline cards, the meta deck nearest to your own list —
  its plan plays it —, the random opponent by archetype share), `my-decks.ts` (your own lists in localStorage,
  listed by `MyDecks.svelte` on `/decks/`, built in the deck builder; `decklist.ts` checks them and names unsupported
  cards), `builder.ts` (the deck builder's rules, like Limitless's: counts with the 4-of-a-name and 1 ACE SPEC limits,
  Limitless's sort, problems until a legal 60, the card search with its chips, the list to and from export text),
  `play.ts` (labels, hand actions), `action-bar.ts` (the command bar under the table: what it says and its buttons
  for every situation, which one is the main one), `tips.ts` (one-time tips shown in the command bar when their
  moment comes, instead of a manual read before the first game), `drag.ts` (drop zones: `data-drop` =
  `slot:<uid>` / `active` / `bench` / `play`), `press.ts` (pointer drag / long press for mouse and touch),
  `card-back.ts` (the real card back, loaded from pokemontcg.io; a drawn back while it loads or if it fails),
  `images.ts` (card pictures fetched ahead at low priority: the card back and the picked decks' small pictures on
  the match sheet, both lists at the start; `CardFace.svelte` shows its text frame until the picture loads, a zoomed
  card the small picture until the large one has), `symbols.ts` (the
  Energy symbols and coin, drawn flat as SVG in `public/energy/` (a circle in the type's colour, a white glyph) and
  `public/coin/` (gold heads with a star, silver tails); drawn by
  `components/game/Energy.svelte`, card text with {G}… by `EffectText.svelte`, the coin by `fx.ts`), `menu.ts`
  (what the pop-up for a tapped Pokémon shows: attacks and why one can't be used, Abilities, retreat;
  rendered by `PokemonMenu.svelte` — attacking and retreating happen there, not in the dock; reading never acts:
  each attack has its own button, a retreat is picked then confirmed).
- `src/ui/anim/` — animations (plan and research: `ANIMATION-PLAN.md`). `events.ts` reads what happened
  from the state before/after an action (pure, tested); `fx.ts` plays it with the Web Animations API on
  the overlay in `FxLayer.svelte`, finding things by `data-card` / `data-slot` / `data-zone`. The state
  changes at once; animations only show it, the bot waits for them, any input of yours skips them.
  Animations on real elements must not keep `fill: forwards` (it would pin HP and transforms).
- `src/sim/` — bot-vs-bot runner and stats (Wilson CI, meta-weighted and paired-difference) for the scripts.
- Pages (each also at `/en/…` in English; the files are in `src/pages/[...lang]/`): `/` (home), `/play/` (Game.svelte: the match sheet — your deck, a meta deck or one of your lists, vs the
  opponent — then the game, played as at a real table; `?me=…&opp=…` preselect, `?seed=…` fixes the deal,
  `?watch=1&…` lets the rule-based bot play your side (end-to-end tests; `&save=1` saves it), `?pierce=1` the other
  Twin Shotels ruling; `HowTo.svelte` from the match sheet and the game menu), `/review/` (ประวัติเกม: your record, saved games, one
  game's review), `/decks/` (meta decks, your own lists), `/builder/` (`components/builder/DeckBuilder.svelte`, laid out
  and used like Limitless's builder: the deck as pictures with counts on the left, the card search on the right; + / −
  on hover, right-click, Ctrl+right-click for four, drag and drop, keys + − 0–9 on the card under the mouse, Space,
  H, Ctrl+Z; `?id=` one of yours, `?from=` a meta list; phones get the two halves as tabs). No hints, threat panel or undo. The game screen: `TopBar`
  (☰ the game menu — a `Sheet` with new game, how to play, bot speed, animations, sound, hand order, links —, whose
  turn, the decks; on a phone the log button), the table, the dock, and on a computer the side column: `Inspector`
  (the card under the mouse for a moment, any face-up card carrying `data-inspect`, else the card picked up, with a
  Pokémon's state in play from `SlotState.svelte`) over the log (the bot's last turn marked). Under the table the
  command bar (`ActionBar.svelte`, from `ui/action-bar.ts`; `ChoiceBar.svelte` for a choice on the table) is always
  there at one height, so the table never moves: what is going on at the left, its buttons at the right (white =
  the main one; "จบเทิร์น" turns white when nothing else can be done; red only for leaving a game). A choice in a box
  over the table (`ChoicePanel`) is confirmed there too. A tap picks a hand card up: its text in the `Inspector` on a
  computer, in `HandDetail.svelte` over the opponent's half on a phone (whole, no scroll box); a second tap or the
  bar's button plays it, a drag plays it at once. On a phone the bot's last turn is a button in the bar (a sheet).
  Touch screens (`pointer: coarse`) get 44px buttons; a screen shorter than 480px in landscape is asked to turn.
  Shared controls: `src/components/ui/` (`Button`, `IconButton`, `Sheet`, `Switch`, `Segmented`, `Toast`). A choice of Pokémon or of an Energy/Tool attached to one (Energy Switch: tapped on the Pokémon, the pips
  grow) is made on the table: the dock shows `ChoiceBar.svelte` (what is asked, this card's earlier answers) and the
  Pokémon that aren't options dim. Prize cards: `rules.pickPrizes` (the play screen only) asks player 0 which
  face-down Prize to take, by position; bots and look-ahead take them in order (`determinize()` turns it off); the
  pick fills the screen once the Knock Out has been animated (`PrizePick.svelte`: one tap takes one, several are
  marked then confirmed, keys 1–6 / Enter); a taken Prize leaves its gap (`prizeGrid` in Game.svelte). A card picked from a box is marked, then
  confirmed. `?test=1` exposes `window.__tcg` (`state()`, `history()`, `load(state)`: play on from a built position,
  see the e2e tests). A choice shows the card whose effect asks,
  and an effect that looks at a pile (`ChoiceRequest.view`: a deck search shows the whole deck, "look at the top N"
  those cards) shows all of it, the cards you may take lit (`ChoicePanel.svelte`). A saved game picked up again has
  the hidden cards dealt again (`engine/view.ts` `redeal()`).
  A running game fills the screen (nothing scrolls but the side column / drawer): Board.svelte sizes its
  cards from its box (`.table`, container query units), and the hand overlaps in a fan instead of scrolling.
  Setup (Active Spot, Bench) is done on the table with a confirm button in the dock, not a choice box.
  Theme: one dark, flat theme, tokens on `:root` in `layouts/Base.astro` (black page, `--card-bg` #181818 /
  `--raised` #1F1F1F / `--control` #272727 surfaces, `--line` / `--rule` hairlines; `--primary` white for the one
  main action, `--accent` amber for what can be played or picked, `--stamp` red for danger and the opponent;
  `--radius-sm` 4px, `--radius` 8px, `--radius-lg` 12px, `--radius-xl` 16px; `--ease` the one motion curve; by meaning
  `--can`, `--mine`, `--theirs`, `--hp-ok` / `--hp-hurt` / `--hp-low`, `--control-hover`, `--line-strong`,
  `--stamp-press`, `--card-paper`). One type family: Geist
  for Latin and figures with Noto Sans Thai for Thai (`--font-body`), Geist Mono for numbers; named text styles
  (`.heading-1` … `.caption-5`) on a 12/14/16/18/20/24/30/36/48/60 scale (`--fs-card` 11px only for what is drawn on
  a card), spacing on 4/8/12/16/24/32/40/48/64/80/96. `tests/ui/design-tokens.test.ts` fails on a component's text
  size off the scale, a colour that isn't a token (black and white shades aside) or a token that isn't defined; the
  drawn cards (`FxLayer`, `CardBack`, `CardFace`) are its exceptions.
  No background gradients, one-sided card borders, pill buttons, sticker labels or confetti. Header: a floating bar,
  a full-height menu on phones. Home: hero with a real game screenshot (`public/home/board.jpg`, retake it after
  restyling the play screen; it is also the shared link's `og:image`, an absolute URL once `site` is set in
  astro.config), the meta decks as `DeckCard.astro` (art cropped from the headline Pokémon,
  `headlines()` in `lib/decks.ts`), steps, the review beside its screenshot (`public/home/review.jpg`, retake it after
  restyling the review), a tagline lit word by word on scroll, FAQ (facts only). The playmat is
  flat #181818 (`.board` in Board.svelte). Original styling only: no official logos or game trade dress in the
  site's own design; the card images and back on the table are the real ones (the Energy symbols and the coin are our own flat drawings).

## Versions

Astro is pinned to 6.x because this machine runs Node 22.16 and Astro 7 needs Node >= 22.23.4.
Astro 6 has published advisories fixed only in 7.x; upgrade Node, then
`npm i astro@latest @astrojs/svelte@latest`, before hosting publicly.
