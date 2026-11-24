// PLAN.md: play a seeded game to the end in a real browser and check the screen matches the engine state.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface Snapshot {
  winner: number | 'draw' | null;
  turn: number;
  prizes: [number, number];
  hand: number;
  active: [string | null, string | null];
}

async function engineState(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = (window as unknown as { __tcg: { state: () => any } }).__tcg.state();
    const name = (p: 0 | 1) => {
      const a = s.players[p].active;
      return a ? s.cards[a.stack[a.stack.length - 1]].key : null;
    };
    return {
      winner: s.winner,
      turn: s.turn,
      prizes: [s.players[0].prizes.length, s.players[1].prizes.length],
      hand: s.players[0].hand.length,
      active: [name(0), name(1)],
    };
  });
}

// Every meta deck plays a game to the end, as yours and as the bot's (each deck meets the next one).
const DECKS = ['dragapult-ex', 'basic-box', 'slowking', 'ns-zoroark-ex', 'alakazam', 'festival-lead-seaking', 'festival-lead-dipplin'];
for (const [i, me] of DECKS.entries()) {
  const opp = DECKS[(i + 1) % DECKS.length]!;
  test(`a seeded game, ${me} vs ${opp}, plays to the end and the board matches the engine`, async ({ page }) => {
    await page.goto(`/play/?watch=1&test=1&speed=0&seed=${7 + i}&me=${me}&opp=${opp}`);
    await expect(page.locator('.result')).toBeVisible({ timeout: 90_000 });
    const s = await engineState(page);
    expect(s.winner).not.toBeNull();
    // Prize piles on screen: bot first (top), then you.
    const shown = await page.locator('.prizes .n').allInnerTexts();
    expect(shown.map(Number)).toEqual([s.prizes[1], s.prizes[0]]);
    // The playmat draws the Prize cards left as face-down cards.
    expect(await page.locator('.side.theirs .prize-slot .back').count()).toBe(s.prizes[1]);
    expect(await page.locator('.side.mine .prize-slot .back').count()).toBe(s.prizes[0]);
    expect(await page.locator('.hcard').count()).toBe(s.hand);
    await expect(page.locator('.log .line').first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'จบเกม' })).toBeVisible();
  });
}

test('the deck builder works like Limitless: +, right-click, limits, import, undo; the deck is saved and played', async ({ page }) => {
  await page.goto('/decks/');
  await page.getByRole('link', { name: '+ จัดเด็คใหม่' }).click();
  await expect(page).toHaveURL(/\/builder\/$/);
  const total = page.locator('.deck-bar .total');
  const results = page.locator('.results');
  const search = page.getByRole('searchbox', { name: 'ค้นการ์ด' });

  // + on a search result adds one; Ctrl+right-click adds four, stopped at 4 with the reason.
  await search.fill('dreepy');
  await results.locator('.tile').first().hover();
  await results.getByRole('button', { name: 'เพิ่ม Dreepy 1 ใบ' }).click();
  await expect(total).toHaveText('1/60');
  await results.locator('.tile').first().click({ button: 'right', modifiers: ['Control'] });
  await expect(total).toHaveText('4/60');
  await expect(page.locator('.ui-toast')).toContainText('ไม่เกิน 4');
  // Right-click in the deck takes one out; the filter chips narrow the search.
  await page.locator('.deck-grid .tile').first().click({ button: 'right' });
  await expect(total).toHaveText('3/60');
  await search.fill('');
  await page.getByRole('button', { name: 'Supporter', exact: true }).click();
  expect(await results.locator('.tile').count()).toBeLessThan(20);

  // A meta list to start from, an import that names what it left out, and undo.
  await page.locator('.from select').selectOption('basic-box');
  await expect(total).toHaveText('60/60');
  await expect(page.locator('.deck-bar .state')).toContainText('บอทจะเล่นลิสต์นี้แบบ Basic Box');
  await page.getByRole('button', { name: 'นำเข้าลิสต์' }).click();
  await page.getByRole('textbox', { name: 'decklist' }).fill('4 Dreepy TWM 128\n1 Iono PAL 185');
  await page.getByRole('dialog').getByRole('button', { name: 'นำเข้า', exact: true }).click();
  await expect(total).toHaveText('4/60');
  await expect(page.locator('.report')).toContainText('Iono');
  await page.getByRole('button', { name: 'เลิกทำ' }).first().click();
  await expect(total).toHaveText('60/60');

  // Saved under its name, then played.
  await page.getByRole('textbox', { name: 'ชื่อเด็ค' }).fill('Box ของฉัน');
  await page.getByRole('button', { name: 'บันทึก' }).click();
  await expect(page).toHaveURL(/\/builder\/\?id=/);
  await page.getByRole('button', { name: /เล่นกับบอท/ }).click();
  await expect(page.getByLabel('เด็คของคุณ')).toHaveValue(/^my:/);
  await page.getByRole('combobox', { name: /^คู่แข่ง/ }).selectOption('basic-box');
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();
  await expect(page.locator('.status')).toContainText('Box ของฉัน vs Basic Box');

  // The decks page lists it, with a link back to the builder.
  await page.goto('/decks/');
  await expect(page.locator('.list li')).toContainText('Box ของฉัน');
  await expect(page.locator('.list li').getByRole('link', { name: 'แก้' })).toHaveAttribute('href', /\/builder\/\?id=/);
});

test('you can set up, attach Energy and end the turn; the bot then plays', async ({ page }) => {
  await page.goto('/play/?test=1&seed=101');
  await page.getByLabel('เด็คของคุณ').selectOption('basic-box');
  await page.getByRole('combobox', { name: /^คู่แข่ง/ }).selectOption('basic-box');
  await page.getByRole('radiogroup', { name: 'ความเร็วบอท' }).getByText('เร็ว', { exact: true }).click();
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();

  await setUp(page);
  const before = await engineState(page);

  // Attach an Energy card if one is playable.
  const energy = page.locator('.hcard.grab img[alt$="Energy"]').first();
  if (await energy.count()) {
    await energy.click();
    await page.locator('.side.mine .slot.target .card').first().click();
  }
  await endTurn(page);
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 30_000 });
  const after = await engineState(page);
  expect(after.turn).toBe(before.turn + 2);
  const shownActive = await page.locator('.side.mine .slot.active img').getAttribute('alt');
  expect(shownActive).toBeTruthy();
});

/**
 * Set up on the table like a player: answer the coin toss / mulligan boxes with their first option, tap
 * the first Basic in the hand for the Active Spot, then confirm the Bench without adding any.
 */
async function setUp(page: Page) {
  // The engine's phase, not the status line: "ตาคุณ" shows during setup too, so a stuck setup would only show up
  // later as a timeout somewhere else.
  const phase = () => page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state()?.phase as string | undefined);
  for (let i = 0; i < 30 && (await phase()) !== 'main'; i++) {
    const choice = page.locator('.choice');
    const setup = page.locator('.setup-bar');
    if (await choice.isVisible()) await choice.locator('button').first().click();
    else if (await setup.isVisible()) {
      if ((await setup.getAttribute('data-step')) === 'active') await page.locator('.hcard.grab').first().click();
      else await setup.getByRole('button', { name: /ยืนยัน/ }).click();
    }
    await page.waitForTimeout(300);
  }
  expect(await phase(), 'setup did not finish').toBe('main');
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 20_000 });
}

/** End the turn; when an attack is still usable the dock asks first, and the answer is to end it. */
async function endTurn(page: Page) {
  const end = page.getByRole('button', { name: 'จบเทิร์น', exact: true });
  const warn = page.getByRole('alertdialog', { name: 'ยังโจมตีได้' });
  await end.click();
  // Either the turn ended (the button goes with it) or the dock asks.
  await expect.poll(async () => (await warn.isVisible()) || !(await end.isVisible())).toBe(true);
  if (await warn.isVisible()) await warn.getByRole('button', { name: 'จบเทิร์นเลย' }).click();
}

/** The game menu (top left): new game, how to play, settings. */
async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'เมนูเกม' }).click();
  return page.getByRole('dialog', { name: 'เมนูเกม' });
}

/** "เกมใหม่" from the game menu. */
async function newGame(page: Page) {
  await (await openMenu(page)).getByRole('button', { name: 'เกมใหม่' }).click();
}

/** The animation setting, from the game menu. */
async function setAnim(page: Page, level: 'เต็ม' | 'เร็ว' | 'ปิด') {
  const menu = await openMenu(page);
  await menu.getByRole('radiogroup', { name: 'ภาพเคลื่อนไหว' }).getByText(level, { exact: true }).click();
  await menu.getByRole('button', { name: 'ปิด' }).click();
  await expect(menu).toHaveCount(0);
}

/** Start a seeded game, Basic Box vs Basic Box, and set up (Active = first Basic, no Bench). */
async function startGame(page: Page, seed: number) {
  await page.goto(`/play/?test=1&seed=${seed}&me=basic-box&opp=basic-box`);
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();
  await setUp(page);
}

/** A card on the table once it has turned face up (setup ends with both sides flipping their Pokémon). */
async function faceUp(page: Page, selector: string) {
  const card = page.locator(selector);
  await expect.poll(async () => (await card.boundingBox())?.width ?? 0).toBeGreaterThan(20);
  return (await card.boundingBox())!;
}

const energyOnActive = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __tcg: { state: () => any } }).__tcg.state();
    return s.players[0].active.energy.length as number;
  });

test('drag an Energy from your hand onto your Active Pokémon (mouse)', async ({ page }) => {
  await startGame(page, 101);
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  const a = (await card.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y - 30, { steps: 4 });
  const b = await faceUp(page, '.side.mine .slot.active .card');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await expect(page.locator('.ghost-label')).toContainText(/ติด \w+ Energy ให้/);
  await page.mouse.up();
  await expect.poll(() => energyOnActive(page)).toBe(1);
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
});

test('a drop outside any target does nothing', async ({ page }) => {
  await startGame(page, 101);
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  const a = (await card.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y - 60, { steps: 6 });
  await page.mouse.up();
  expect(await energyOnActive(page)).toBe(0);
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
});

test('a played card flies to its place, and acting meanwhile skips the animation', async ({ page }) => {
  await startGame(page, 101);
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  await card.click();
  await page.locator('.side.mine .slot.target .card').first().click();
  // The state changes at once; a copy of the card flies over the board.
  expect(await energyOnActive(page)).toBe(1);
  await expect(page.locator('.fx-layer .fx-card')).not.toHaveCount(0);
  await endTurn(page);
  await expect(page.locator('.status')).toContainText('ตาคุณ', { timeout: 30_000 });
});

test('animations can be turned off', async ({ page }) => {
  await startGame(page, 101);
  await setAnim(page, 'ปิด');
  await expect(page.locator('html')).toHaveAttribute('data-anim', 'off');
  const card = page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first();
  // Beside "จบเทิร์น": nothing used yet (you went first: no Supporter on turn 1).
  await expect(page.locator('.uses .use.used')).toHaveCount(0);
  await expect(page.locator('.uses .use.barred')).toHaveText('Supporter');
  await card.click();
  await page.locator('.side.mine .slot.target .card').first().click();
  expect(await energyOnActive(page)).toBe(1);
  await expect(page.locator('.fx-layer > *')).toHaveCount(0);
  await expect(page.locator('.uses .use.used')).toHaveText('✓ ติดพลังงาน');
});

test('tapping your Active opens a pop-up with its attacks and retreating', async ({ page }) => {
  await startGame(page, 101);
  await faceUp(page, '.side.mine .slot.active .card');
  await page.locator('.side.mine .slot.active .card').click();
  const menu = page.getByRole('dialog').filter({ has: page.locator('.attacks') });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.attack').first()).toBeVisible();
  // Nothing attached yet: the attack's button is greyed out with the reason; no Bench, so no retreat.
  await expect(menu.locator('.attack .go').first()).toBeDisabled();
  await expect(menu.locator('.attack .why').first()).not.toBeEmpty();
  // Reading an attack never uses it: only its button does.
  await menu.locator('.attack .aname').first().click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.retreat')).toContainText('ไม่มี Pokémon บน Bench');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('a game is played as at a real table: no hints, threat panel or undo', async ({ page }) => {
  await startGame(page, 101);
  await expect(page.getByRole('button', { name: 'แนะนำ 3 ทางเลือก' })).toHaveCount(0);
  await expect(page.locator('.threat')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ย้อน' })).toHaveCount(0);
});

test('a deck search shows your whole deck, the cards you may take lit; a tap picks a card up, a second tap plays it', async ({ page }) => {
  // Dragapult ex, seed 2024: Buddy-Buddy Poffin in hand on your first turn.
  await page.goto('/play/?test=1&seed=2024&me=dragapult-ex&opp=basic-box');
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();
  await setUp(page);
  const poffin = page.locator('.hcard.grab').filter({ has: page.locator('img[alt="Buddy-Buddy Poffin"]') }).first();
  await poffin.click();
  // Picked up, not played: the dock offers to play it.
  await expect(page.getByRole('button', { name: 'ใช้ Buddy-Buddy Poffin' })).toBeVisible();
  await expect(page.locator('.choice')).toHaveCount(0);
  await poffin.click();

  const choice = page.locator('.choice.zone');
  await expect(choice).toBeVisible();
  const deck = await page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state().players[0].deck.length as number);
  await expect(choice.locator('.opt')).toHaveCount(deck);
  const lit = choice.locator('.opt:not(.off)');
  expect(await lit.count()).toBeGreaterThan(0);
  expect(await choice.locator('.opt.off').count()).toBeGreaterThan(0);
  // A dimmed card can't be picked; two lit ones can.
  await choice.locator('.opt.off').first().dispatchEvent('click');
  await expect(choice.locator('.opt.on')).toHaveCount(0);
  const bench = await page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state().players[0].bench.length as number);
  await lit.nth(0).click();
  await lit.nth(1).click();
  await expect(choice.locator('.opt.on')).toHaveCount(2);
  // Confirmed in the command bar under the table.
  await page.locator('.dock').getByRole('button', { name: 'ยืนยัน' }).click();
  await expect(choice).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state().players[0].bench.length as number)).toBe(bench + 2);
  // The picks went in as plain data (a $state proxy could not be posted to the bot's worker or saved).
  const cloned = await page.evaluate(() => {
    const t = (window as unknown as { __tcg: { state: () => unknown; history: () => unknown[] } }).__tcg;
    try {
      structuredClone(t.history());
      structuredClone(t.state());
      return 'ok';
    } catch (e) {
      return String(e);
    }
  });
  expect(cloned).toBe('ok');
});

/** Play from a position built here: Dragapult ex (Fire + Psychic) Active, Dreepy (Psychic) and Drakloak on the Bench,
 * Energy Switch in hand; the bot's Budew (30 HP) Active; you pick your Prize cards. */
async function loadPosition(page: Page) {
  await page.goto('/play/?test=1&seed=5&me=dragapult-ex&opp=basic-box');
  await page.getByRole('button', { name: /เริ่มเกม/ }).click();
  await expect(page.locator('.board')).toBeVisible();
  await page.evaluate(() => {
    const cards: { id: number; key: string; owner: 0 | 1 }[] = [];
    const make = (key: string, owner: 0 | 1) => (cards.push({ id: cards.length, key, owner }), cards.length - 1);
    let uid = 1;
    const slot = (key: string, owner: 0 | 1, energy: string[] = []) => ({
      uid: uid++, stack: [make(key, owner)], energy: energy.map((k) => make(k, owner)), tool: null, damage: 0,
      enteredTurn: 0, evolvedTurn: -1, conditions: [], marks: [], usedAbility: {},
    });
    const side = (p: 0 | 1, active: ReturnType<typeof slot>, bench: ReturnType<typeof slot>[], hand: string[]) => ({
      active, bench, hand: hand.map((k) => make(k, p)), deck: Array.from({ length: 20 }, () => make('psychic-energy', p)), discard: [],
      prizes: ['fire-energy', 'budew', 'judge', 'dreepy', 'psychic-energy', 'meowth-ex'].map((k) => make(k, p)),
      supporterPlayed: false, energyAttached: false, retreated: false, stadiumPlayed: false, namedUsed: [], buffs: [],
      itemLockTurn: -1, koLastTurn: false, koByAttackLastTurn: false, koThisTurn: false, koByAttackThisTurn: false,
      mulligans: 0, knownTop: [],
    });
    const players = [
      side(0, slot('dragapult-ex', 0, ['fire-energy', 'psychic-energy']), [slot('dreepy', 0, ['psychic-energy']), slot('drakloak', 0)], ['energy-switch', 'judge', 'unfair-stamp']),
      side(1, slot('budew', 1), [slot('dreepy', 1)], []),
    ];
    const s = {
      seed: 1, turn: 5, current: 0, first: 0, phase: 'main', players, stadium: null, cards, rng: { shuffle: [11, 22], coin: 33 },
      nextUid: uid, pending: null, winner: null, winReason: '', log: [], quiet: false, steps: 0,
      rules: { twinShotelsPiercesBenchShields: false, pickPrizes: true }, names: ['คุณ', 'บอท'],
    };
    (window as unknown as { __tcg: { load: (s: unknown) => void } }).__tcg.load(s);
  });
  await setAnim(page, 'ปิด');
}

const state = (page: Page) => page.evaluate(() => (window as unknown as { __tcg: { state: () => any } }).__tcg.state());

test('the keyboard: 1–9 picks up a hand card, A opens the attacks, E asks then ends the turn, Esc closes', async ({ page }) => {
  await loadPosition(page);
  // A deck of 5 or fewer cards: its count turns red.
  await expect(page.locator('.side.mine .pile.deck.low')).toHaveCount(0);
  await page.evaluate(() => {
    const t = (window as unknown as { __tcg: { state: () => any; load: (s: unknown) => void } }).__tcg;
    const s = structuredClone(t.state());
    s.players[0].deck = s.players[0].deck.slice(0, 3);
    t.load(s);
  });
  await expect(page.locator('.side.mine .pile.deck.low')).toBeVisible();
  // The animation menu was just used: keys typed into a field are its own.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('1');
  // A computer: the card picked up is read in the card text panel at the side.
  await expect(page.locator('.inspector')).toContainText('Judge');
  await expect(page.locator('.inspector')).toContainText('การ์ดที่หยิบจากมือ');
  await page.keyboard.press('Escape');
  await expect(page.locator('.inspector')).not.toContainText('การ์ดที่หยิบจากมือ');
  await page.keyboard.press('a');
  await expect(page.locator('.pmenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pmenu')).toHaveCount(0);
  const warn = page.getByRole('alertdialog', { name: 'ยังโจมตีได้' });
  await page.keyboard.press('e');
  await expect(warn).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(warn).toHaveCount(0);
  expect((await state(page)).turn).toBe(5);
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await expect.poll(async () => (await state(page)).turn).toBeGreaterThan(5);
});

test('Area Zero Underdepths leaving play: the Bench over 5 stays in one row on the table, each Pokémon can be tapped', async ({ page }) => {
  await loadPosition(page);
  // Dragapult ex (Tera) with 7 on the Bench under the bot's Underdepths; Gravity Mountain in hand replaces it.
  await page.evaluate(() => {
    const t = (window as unknown as { __tcg: { state: () => any; load: (s: unknown) => void } }).__tcg;
    const s = structuredClone(t.state());
    const me = s.players[0];
    const add = (key: string, owner: 0 | 1) => (s.cards.push({ id: s.cards.length, key, owner }), s.cards.length - 1);
    while (me.bench.length < 7) {
      me.bench.push({ ...structuredClone(me.bench[0]), uid: s.nextUid++, stack: [add('dreepy', 0)], energy: [] });
    }
    me.hand = [add('gravity-mountain', 0)];
    s.stadium = { card: add('area-zero-underdepths', 1), owner: 1 };
    t.load(s);
  });
  await page.locator('.hcard').filter({ has: page.locator('img[alt="Gravity Mountain"]') }).click();
  await page.locator('.dock').getByRole('button', { name: 'ใช้ Gravity Mountain' }).click();
  await expect(page.locator('.dock')).toContainText('ทิ้ง Pokémon บน Bench 2 ตัว');
  const bench = page.locator('.side.mine .bench .slot');
  await expect(bench).toHaveCount(7);
  const board = (await page.locator('.board').boundingBox())!;
  const tops = new Set<number>();
  for (const b of await bench.all()) {
    const box = (await b.boundingBox())!;
    tops.add(Math.round(box.y));
    expect(box.y + box.height, 'a Benched Pokémon runs off the table').toBeLessThanOrEqual(board.y + board.height + 1);
  }
  expect(tops.size, 'the Bench wraps to a second row').toBe(1);
  await bench.nth(5).locator('.card').click();
  await bench.nth(6).locator('.card').click();
  await page.locator('.dock').getByRole('button', { name: 'ยืนยัน' }).click();
  await expect.poll(async () => (await state(page)).players[0].bench.length).toBe(5);
});

test('a hand card is read before it is played; Energy Switch is answered on the table; you pick your Prize card', async ({ page }) => {
  await loadPosition(page);
  // The hand is shown sorted: the Supporter first, then the Items by name.
  await expect
    .poll(() => page.locator('.hcard img').evaluateAll((els) => els.map((e) => e.getAttribute('alt'))))
    .toEqual(['Judge', 'Energy Switch', 'Unfair Stamp']);
  // The bot's Pokémon, tapped: the card large with its state in play.
  await page.locator('.side.theirs .slot.active .card').click();
  const zoomed = page.getByRole('dialog', { name: 'Budew' });
  await expect(zoomed.getByLabel('สถานะในสนาม')).toContainText('ของบอท · ตัวหลัก');
  await expect(zoomed.getByLabel('สถานะในสนาม')).toContainText('HP 30/30');
  await zoomed.getByRole('button', { name: 'ปิด' }).click();
  // A card that can't be played says why, in the dock by your hand.
  await page.locator('.hcard').filter({ has: page.locator('img[alt="Unfair Stamp"]') }).click();
  await expect(page.locator('.dock .why')).toContainText('โดน KO');
  await page.locator('.dock').getByRole('button', { name: 'ยกเลิก' }).click();
  // A tap shows the card's text, and the dock a button; nothing is played yet.
  await page.locator('.hcard').filter({ has: page.locator('img[alt="Energy Switch"]') }).click();
  const detail = page.locator('.inspector');
  await expect(detail).toContainText('Move a Basic Energy');
  expect((await state(page)).pending).toBeNull();
  await page.locator('.dock').getByRole('button', { name: 'ใช้ Energy Switch' }).click();

  // From which Pokémon: tapped on the table (no box over it); the others step back.
  await expect(page.locator('.choice-layer')).toHaveCount(0);
  await expect(page.locator('.side.theirs .slot.dim').first()).toBeVisible();
  await page.locator('.side.mine .slot.active .card').click();
  // Which Energy: its pip on that Pokémon; what was picked so far stays in the bar.
  await expect(page.locator('.dock')).toContainText('จาก Dragapult ex');
  await page.getByRole('button', { name: 'เลือก Psychic Energy' }).click();
  // Where to: Drakloak.
  await expect(page.locator('.dock')).toContainText('Psychic Energy');
  const drakloak = (await state(page)).players[0].bench[1].uid;
  await page.locator(`[data-slot="${drakloak}"] .card`).click();
  await expect.poll(async () => (await state(page)).players[0].bench[1].energy.length).toBe(1);

  // Attack: its own button in the pop-up. Budew is Knocked Out and you pick the 4th Prize card (a Dreepy here).
  // Ending the turn with an attack still there asks first; going back opens the attacks.
  await page.getByRole('button', { name: 'จบเทิร์น', exact: true }).click();
  const warn = page.getByRole('alertdialog', { name: 'ยังโจมตีได้' });
  await expect(warn).toContainText('Jet Headbutt');
  await warn.getByRole('button', { name: 'กลับไปโจมตี' }).click();
  await expect(warn).toHaveCount(0);
  expect((await state(page)).turn).toBe(5);
  // The attack says what it would do: Budew has 30 HP left.
  const headbutt = page.locator('.pmenu .attack').filter({ hasText: 'Jet Headbutt' });
  await expect(headbutt.locator('.pv')).toHaveText('KO ตัวหลักได้แน่นอน');
  await headbutt.getByRole('button').click();
  // The Prize cards come up full screen, face down in their order on the mat.
  const prizePick = page.getByRole('dialog', { name: 'เลือก Prize' });
  await expect(prizePick).toContainText('Budew ของบอทโดน KO');
  await expect(prizePick).toContainText('หยิบ Prize 1 ใบ');
  const prizes = prizePick.getByRole('button', { name: /หยิบ Prize ใบที่/ });
  await expect(prizes).toHaveCount(6);
  await prizes.nth(3).click();
  await expect.poll(async () => (await state(page)).players[0].prizes.length).toBe(5);
  await expect(prizePick).toHaveCount(0);
  const s = await state(page);
  expect(s.players[0].hand.map((c: number) => s.cards[c].key)).toContain('dreepy');
  // The taken Prize leaves its gap where it was.
  await expect(page.locator('.side.mine .prize-grid > :nth-child(4) > *')).toHaveCount(0);
  await expect(page.locator('.side.mine .prize-grid > :nth-child(5) > *')).toHaveCount(1);

  // The bot plays turn 6; when yours starts, its lines are marked in the log (nothing is laid over the table), until
  // your first move.
  await expect.poll(async () => { const t = await state(page); return t.turn === 7 && t.current === 0 && !t.pending; }, { timeout: 30_000 }).toBe(true);
  const recent = page.locator('.log .line.recent');
  await expect(recent.first()).toContainText('บอท');
  await page.keyboard.press('Escape');
  await expect(recent).toHaveCount(0);
});

/** The table's box on screen (it must not move or change size while a game is played). */
const boardBox = (page: Page) => page.locator('.board').evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);

/** Your turn, the bot's, and the question before leaving: the table keeps its place and size through all three. */
async function boardStaysPut(page: Page) {
  await startGame(page, 101);
  const mine = await boardBox(page);
  await endTurn(page);
  await expect.poll(async () => (await state(page)).current).toBe(1);
  await expect(page.locator('.cmd')).toContainText('ตาบอท');
  expect(await boardBox(page)).toEqual(mine);
  await newGame(page);
  await expect(page.getByRole('alertdialog', { name: 'ออกจากเกมนี้' })).toBeVisible();
  expect(await boardBox(page)).toEqual(mine);
}

/** The cards whose text (Abilities, attacks, Trainer effect) is longest, from the card manifest. */
function longestCards(n: number): { key: string; name: string }[] {
  const { cards } = JSON.parse(readFileSync('data/cards.manifest.json', 'utf8')) as {
    cards: Record<string, { name: string; effect?: string; abilities?: { name: string; effect: string }[]; attacks?: { name: string; effect?: string }[] }>;
  };
  const size = (c: (typeof cards)[string]) =>
    [...(c.abilities ?? []).map((a) => a.name + a.effect), ...(c.attacks ?? []).map((a) => a.name + (a.effect ?? '')), c.effect ?? ''].join(' ').length;
  return Object.entries(cards)
    .sort((a, b) => size(b[1]) - size(a[1]))
    .slice(0, n)
    .map(([key, c]) => ({ key, name: c.name }));
}

/**
 * The longest card texts, picked up from the hand: read whole, without scrolling. A phone: in the box over the bot's
 * half (not reaching into yours). A computer: in the card text panel at the side.
 */
async function longTextsFit(page: Page, phone: boolean) {
  await startGame(page, 101);
  const longest = longestCards(3);
  await page.evaluate((keys) => {
    const t = (window as unknown as { __tcg: { state: () => any; load: (s: unknown) => void } }).__tcg;
    const s = structuredClone(t.state());
    s.players[0].hand.slice(0, keys.length).forEach((c: number, i: number) => (s.cards[c].key = keys[i]));
    t.load(s);
  }, longest.map((c) => c.key));
  for (const c of longest) {
    await page.locator('.hcard').filter({ has: page.locator(`img[alt="${c.name}"]`) }).first().click();
    const box = page.locator(phone ? '.detail-layer .detail' : '.inspector');
    await expect(box).toContainText(c.name);
    // Measured once it has flown in.
    await box.evaluate((d) => Promise.all(d.getAnimations().map((a) => a.finished)));
    const m = await box.evaluate((d) => {
      const table = document.querySelector('.table')!.getBoundingClientRect();
      return { scroll: d.scrollHeight - d.clientHeight, bottom: d.getBoundingClientRect().bottom - table.top, half: table.height / 2 };
    });
    expect(m.scroll, `${c.name}: the text box scrolls`).toBeLessThanOrEqual(0);
    if (phone) expect(m.bottom, `${c.name}: the text box reaches into your half`).toBeLessThanOrEqual(m.half);
    await page.keyboard.press('Escape');
  }
}

test('the table keeps its place and size from your turn to the bot\'s', async ({ page }) => {
  await boardStaysPut(page);
});

test('"เกมใหม่" during a game asks first; the game goes on unless you say to leave it', async ({ page }) => {
  await startGame(page, 101);
  const turn = (await state(page)).turn;
  const ask = page.getByRole('alertdialog', { name: 'ออกจากเกมนี้' });
  await newGame(page);
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'เล่นต่อ' }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.locator('.board')).toBeVisible();
  expect((await state(page)).turn).toBe(turn);
  await newGame(page);
  await ask.getByRole('button', { name: 'ออกจากเกม' }).click();
  await expect(page.getByRole('button', { name: /เริ่มเกม/ })).toBeVisible();
});

test('a game left unfinished is kept: after a reload it goes on from the very same position', async ({ page }) => {
  await startGame(page, 101);
  await page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first().click();
  await page.locator('.side.mine .slot.target .card').first().click();
  await expect.poll(() => energyOnActive(page)).toBe(1);
  const before = await state(page);
  await page.reload();
  const kept = page.getByRole('region', { name: 'เกมที่ค้างไว้' });
  await expect(kept).toContainText(`เทิร์น ${before.turn}`);
  await kept.getByRole('button', { name: 'เล่นต่อเกมที่ค้างไว้' }).click();
  await expect(page.locator('.board')).toBeVisible();
  const after = await state(page);
  expect(JSON.stringify(after.players)).toBe(JSON.stringify(before.players));
  expect(after.steps).toBe(before.steps);
  // Leaving it forgets it.
  await newGame(page);
  await page.getByRole('alertdialog', { name: 'ออกจากเกมนี้' }).getByRole('button', { name: 'ออกจากเกม' }).click();
  await expect(page.getByRole('button', { name: /เริ่มเกม/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /เริ่มเกม/ })).toBeVisible();
  await expect(kept).toHaveCount(0);
});

test('the longest card texts fit the card text panel without scrolling', async ({ page }) => {
  await longTextsFit(page, false);
});

test('at the end, "เล่นอีกครั้ง" plays the same two decks again', async ({ page }) => {
  await page.goto('/play/?watch=1&test=1&speed=0&seed=9&me=basic-box&opp=dragapult-ex');
  const over = page.getByRole('dialog', { name: 'จบเกม' });
  await expect(over).toBeVisible({ timeout: 90_000 });
  await over.getByRole('button', { name: 'เล่นอีกตา (เด็คเดิม)' }).click();
  await expect(over).toHaveCount(0);
  await expect.poll(async () => (await engineState(page)).turn < 3 && (await engineState(page)).winner === null).toBe(true);
  await expect(page.locator('.status')).toContainText('Dragapult ex');
});

test('a finished game is saved, reviewed turn by turn in under 30 s, and can be played on from a turn', async ({ page }) => {
  // A seeded game (your deck played by the bot) saved like one of yours.
  await page.goto('/play/?watch=1&test=1&speed=0&seed=7&me=basic-box&opp=dragapult-ex&save=1');
  await expect(page.locator('.result')).toBeVisible({ timeout: 90_000 });
  // The game-over dialog covers the table; its link opens the review.
  const link = page.getByRole('dialog', { name: 'จบเกม' }).getByRole('link', { name: /รีวิวเกมนี้/ });
  await expect(link).toBeVisible();
  const started = Date.now();
  await link.click();

  // Every turn of yours reviewed on the workers.
  await expect(page.locator('.summary')).toContainText('เทิร์นของคุณ', { timeout: 30_000 });
  const seconds = (Date.now() - started) / 1000;
  const chips = page.locator('.strip .turn-chip');
  console.log(`review of a ${await chips.count()}-turn game: ${seconds.toFixed(1)} s`);
  expect(seconds).toBeLessThan(30);
  expect(await chips.count()).toBeGreaterThan(2);
  // One sentence sums it up; the chart has your turns (solid) and the bot's between them (dashed).
  await expect(page.locator('.sentence')).not.toBeEmpty();
  await expect(page.locator('figure.chart svg line.seg.mine').first()).toBeVisible();
  await expect(page.locator('figure.chart svg line.seg.theirs').first()).toBeVisible();
  await expect(page.locator('.turn-detail .badge')).toBeVisible();
  // A point on the chart picks its turn: the detail and the strip follow.
  const point = page.locator('figure.chart g.mark').nth(1);
  const picked = Number((await point.getAttribute('aria-label'))!.match(/เทิร์น (\d+)/)![1]);
  await point.click();
  await expect(page.locator('.turn-detail h2')).toHaveText(`เทิร์น ${picked}`);
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');

  // A computer: the turn on the table beside its detail; stepping on names each move.
  const stage = page.locator('.stage-card');
  await expect(stage.locator('.board')).toBeVisible();
  await expect(stage.locator('.caption')).toContainText('ต้นเทิร์น');
  await stage.getByRole('button', { name: 'ถัดไปหนึ่งขั้น' }).click();
  await expect(stage.locator('.caption')).toContainText('คุณ:');
  // The cards hidden then, shown.
  await page.locator('.hidden-cards summary').click();
  await expect(page.locator('.hidden-cards h4', { hasText: 'Prize ของบอท' })).toBeVisible();
  expect(await page.locator('.hidden-cards .cards').nth(1).locator('button').count()).toBeGreaterThan(0);

  // The bot's way from the same start, on the same table, for a turn where it plays otherwise.
  for (let i = 0; i < (await chips.count()); i++) {
    await chips.nth(i).click();
    const botTab = stage.getByRole('tab', { name: /บอทจะเล่น/ });
    if (!(await botTab.count())) continue;
    await botTab.click();
    await expect(botTab).toHaveAttribute('aria-selected', 'true');
    await stage.getByRole('button', { name: 'ถัดไปหนึ่งขั้น' }).click();
    await expect(stage.locator('.caption')).toContainText('บอท:');
    break;
  }

  // Reopening the review is instant (stored with the game).
  await page.reload();
  await expect(page.locator('.summary')).toContainText('เทิร์นของคุณ', { timeout: 3_000 });

  // Play on from the second turn of yours: the same position, and it is your move.
  await chips.nth(1).click();
  const turnNo = Number(await chips.nth(1).locator('.n').innerText());
  const href = await page.locator('.turn-detail').getByRole('link', { name: /ลองเล่นใหม่จากตรงนี้/ }).getAttribute('href');
  await page.goto(`${href}&test=1`);
  await expect(page.locator('.status')).toContainText('เล่นต่อจากเกมที่บันทึกไว้');
  await expect(page.locator('.status')).toContainText('ตาคุณ');
  const s = await engineState(page);
  expect(s.turn).toBe(turnNo);
  expect(s.winner).toBeNull();

  // The game list has it.
  await page.goto('/review/');
  await expect(page.locator('.games li').first()).toContainText('Basic Box vs Dragapult ex');
  await expect(page.locator('.record')).toContainText('1');

  // Deleting it can be undone for a few seconds: it comes back under the same id, its review with it.
  const games = page.locator('.games li');
  const first = await games.first().getByRole('link', { name: 'รีวิว' }).getAttribute('href');
  await games.first().getByRole('button', { name: 'ลบ' }).click();
  await expect(games).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: 'เลิกทำ' }).click();
  await expect(games.first().getByRole('link', { name: 'รีวิว' })).toHaveAttribute('href', first!);
  await page.goto(first!);
  await expect(page.locator('.summary')).toContainText('เทิร์นของคุณ', { timeout: 3_000 });
});

/** A seeded game (your deck played by the bot) saved like one of yours; its review opened, the review finished. */
async function reviewedGame(page: Page, me = 'basic-box', opp = 'dragapult-ex') {
  await page.goto(`/play/?watch=1&test=1&speed=0&seed=7&me=${me}&opp=${opp}&save=1`);
  await expect(page.locator('.result')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('dialog', { name: 'จบเกม' }).getByRole('link', { name: /รีวิวเกมนี้/ }).click();
  await expect(page.locator('.summary')).toContainText('เทิร์นของคุณ', { timeout: 30_000 });
}

test.describe('a review on a computer screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the first screen has the summary, the chart and the table of the turn worth a look', async ({ page }) => {
    await reviewedGame(page);
    const bottom = (sel: string) => page.locator(sel).first().evaluate((e) => e.getBoundingClientRect().bottom);
    for (const sel of ['.sentence', 'figure.chart', '.stage-card .board', '.stage-card .controls']) {
      expect(await bottom(sel), `${sel} is below the first screen`).toBeLessThanOrEqual(900);
    }
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a review is short and opens a turn on the table full screen', async ({ page }) => {
    // UI-PLAN.md's gate: the seed 7 game it measured at 3,794px, brought under 1,600; since then the turn worth a look
    // also shows what the better way gets you and plays around (TurnDetail's gains box, ~280px here).
    await reviewedGame(page, 'dragapult-ex', 'basic-box');
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(1850);
    await expect(page.locator('.stage-card')).toHaveCount(0);
    await page.locator('.turn-detail').getByRole('button', { name: 'ดูรีเพลย์ของคุณ' }).click();
    const viewer = page.getByRole('dialog', { name: /รีเพลย์เทิร์น/ });
    await expect(viewer.locator('.board')).toBeVisible();
    await viewer.getByRole('button', { name: 'ถัดไปหนึ่งขั้น' }).click();
    await expect(viewer.locator('.caption')).toContainText('คุณ:');
    await viewer.getByRole('button', { name: 'ปิด' }).first().click();
    await expect(viewer).toHaveCount(0);
  });

  test('the game fits the screen with every card in hand showing; swipe one up onto a Pokémon', async ({ page }) => {
    await startGame(page, 101);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, x = 0, y = 0) =>
      cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });

    // Nothing scrolls: the table, the buttons and the whole hand are on screen.
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
    const dock = (await page.locator('.dock').boundingBox())!;
    expect(dock.y + dock.height).toBeLessThanOrEqual(844 + 1);
    expect(await page.locator('.hand').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    const cards = await page.locator('.hcard .cardbox').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    expect(cards.length).toBeGreaterThan(5);
    for (const c of cards) {
      expect(c.left).toBeGreaterThanOrEqual(0);
      expect(c.right).toBeLessThanOrEqual(390);
      expect(c.bottom).toBeLessThanOrEqual(844);
    }

    const a = (await page.locator('.hcard.grab').filter({ has: page.locator('img[alt$="Energy"]') }).first().boundingBox())!;
    const b = await faceUp(page, '.side.mine .slot.active .card');
    const [sx, sy, tx, ty] = [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2 + 10];
    await touch('touchStart', sx, sy);
    for (let i = 1; i <= 12; i++) await touch('touchMove', sx + ((tx - sx) * i) / 12, sy + ((ty - sy) * i) / 12);
    await touch('touchEnd');
    await expect.poll(() => energyOnActive(page)).toBe(1);
  });

  test('the table keeps its place and size from your turn to the bot\'s', async ({ page }) => {
    await boardStaysPut(page);
  });

  test('the longest card texts fit their box without scrolling', async ({ page }) => {
    await longTextsFit(page, true);
  });

  test('everything pressed with a finger is at least 44px (cards and log lines aside)', async ({ page }) => {
    await startGame(page, 101);
    /** Buttons and fields on screen under `root` smaller than 44×44, cards left out. */
    const small = (root: string) =>
      page.locator(root).evaluate((el) => {
        const CARDS = '.card, .hcard, .pile, .stadium, .ghost-card, .pick, .thumb, .src, .line, .pip';
        return [...el.querySelectorAll<HTMLElement>('button, select, a, input, [role="button"]')]
          .filter((b) => !b.matches(CARDS) && !b.closest('.hand, .board .slot'))
          .map((b) => ({ what: (b.getAttribute('aria-label') || b.textContent || b.className).trim().slice(0, 30), r: b.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight)
          .filter(({ r }) => Math.min(r.width, r.height) < 44 - 0.5)
          .map(({ what, r }) => `${what} ${Math.round(r.width)}×${Math.round(r.height)}`);
      });
    expect(await small('.game')).toEqual([]);
    // A hand card picked up: its box and the dock's buttons.
    await page.locator('.hcard').first().click();
    await expect(page.locator('.detail-layer')).toBeVisible();
    await expect.poll(() => small('.game')).toEqual([]);
    await page.keyboard.press('Escape');
    // Your Active's pop-up (measured once it has grown in: it starts at 90% of its size).
    await faceUp(page, '.side.mine .slot.active .card');
    await page.locator('.side.mine .slot.active .card').click();
    await expect(page.locator('.pmenu')).toBeVisible();
    await expect.poll(() => small('.pmenu')).toEqual([]);
  });

  test('long press shows the card', async ({ page }) => {
    await startGame(page, 101);
    const cdp = await page.context().newCDPSession(page);
    const b = await faceUp(page, '.side.theirs .slot.active .card');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
