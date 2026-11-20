# หน้าเล่น: ให้เหมือนเล่นบนโต๊ะจริง (backlog)

What the play screen still lacks next to a real table / Pokémon TCG Live, worked through one item at a time
(`/loop`): research → the most useful item → build it with tests → commit. UI text Thai, card text English, original
styling only.

## Done before this list (20–21 Nov)

- Deck searches show the whole deck; a tap picks a hand card up; practice mode removed.
- A hand card shows its text before it is played (HandDetail); attacks have their own button; retreat is confirmed.
- Choices of Pokémon / attached Energy / Prize cards are made on the table (ChoiceBar); you pick your Prize cards.
- A hand shuffled into the deck animates every card; the bot's Trainers are shown large; Confused turns the card.
- Theme: blue/yellow, rounded panels, blue playmat.

## Backlog (most useful first)

| # | Item | Why | State |
|---|------|-----|-------|
| 1 | Why a hand card can't be played | "ใช้การ์ดนี้ตอนนี้ไม่ได้" alone leaves you guessing (Supporter already played, first turn, Bench full, card condition) | done 21 Nov |
| 2 | Real damage on the attack button | Printed damage only; Weakness/Resistance and effects change it; say when it Knocks Out | done 21 Nov |
| 3 | Warn before ending the turn while an attack is available | The big end-turn button makes a lost attack easy | done 21 Nov |
| 4 | What you used this turn | Supporter / Energy attachment / retreat used or not; the state knows, the screen doesn't say | |
| 5 | Hand sorted (Pokémon / Trainer / Energy) | New cards go to the end; hard to find a card in a big hand | |
| 6 | e2e setup helper waits for turn 1 | It waits for "ตาคุณ", which shows during setup too, so a setup bug showed as 2-minute timeouts | |

## Log

- **21 Nov, #1 done.** `whyNotPlayable(s, card)` in `engine/actions.ts` follows `legalActions()` check by check and
  names the rule (Bench full, Supporter/Energy/Stadium already this turn, first turn, evolution needs X / X just came
  in, Item lock, ACE Nullifier) or the Trainer's own condition (`TRAINER_NEEDS`, one line per Trainer with
  `canPlay`). The card detail shows it on a red note. `tests/ui/why.test.ts`: the rules, every Trainer has a line, and
  over random games a reason is given exactly when the card isn't playable. Found on the way: unplayable hand cards had
  `aria-disabled`, wrong now that any card is tapped to read it (Playwright refused to click them); now an
  `aria-label` "(ใช้ตอนนี้ไม่ได้)".
- **21 Nov, #2 done.** `ui/preview.ts` `previewAttack()`: each usable attack played out on 96 re-dealt copies
  (`determinize`: hidden cards and coins drawn again, so the real flips are never seen; a question on the way gets
  its first options) → damage to their Active (a range when coins or hidden cards decide it), the Knock Out share,
  Weakness / Resistance. The pop-up shows "KO ตัวหลักได้แน่นอน" (gold), "KO ตัวหลัก ~50% · ไม่ KO ก็เข้า 200",
  "เข้าตัวหลักจริง 40 (จุดอ่อน ×2)". ~4 ms per coin attack in Node. 12 copies first: 67% for a true 50%, so 96 and
  shown to 5%. Only the Active: Bench damage depends on your own choices (Phantom Dive), which the preview can't know.
- **21 Nov, #3 done.** "จบเทิร์น" while `legalActions()` still has an attack: the dock turns into a yellow bar
  "ยังโจมตีได้อยู่ (ชื่อท่า) จะจบเทิร์นโดยไม่โจมตีไหม?" with "กลับไปโจมตี" (opens the Active's pop-up) and "จบเทิร์นเลย".
  No browser dialog (they block the page). Any action clears it. e2e: the helper `endTurn()` answers it; the table
  test checks the bar, going back, and that the turn didn't end.
