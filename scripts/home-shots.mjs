// The home page's pictures, taken of the built site in both languages (public/home/board.jpg, review.jpg, -en for
// English; board.jpg is also the shared link's og:image). Retake them after restyling the play screen or the review:
//   npm run build && npx astro preview --port 4330      (then, in another terminal)
//   node scripts/home-shots.mjs [--base http://127.0.0.1:4330]
// review: your Basic Box vs Dragapult ex (seed 7), reviewed, at its turns worth a look (1216x760);
// board: Dragapult ex vs Basic Box (seed 7) played on from a saved game at your 4th turn, a card in hand picked up.
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const base = arg('--base', 'http://127.0.0.1:4330');
const out = arg('--out', 'public/home');

const browser = await chromium.launch();
for (const lang of ['th', 'en']) {
  const pre = lang === 'en' ? '/en' : '';
  const suffix = lang === 'en' ? '-en' : '';
  const reviewed = lang === 'en' ? 'of your' : 'เทิร์นของคุณ';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: lang === 'en' ? 'en-US' : 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  const jpg = (name) => page.screenshot({ path: `${out}/${name}${suffix}.jpg`, type: 'jpeg', quality: 86 });
  /** A seeded game played to its end by the bot on your side and saved: the address of its review. */
  const savedGame = async (me, opp) => {
    await page.goto(`${base}${pre}/play/?watch=1&test=1&speed=0&seed=7&me=${me}&opp=${opp}&save=1`);
    await page.locator('.result').waitFor({ timeout: 120_000 });
    return page.locator('[role=dialog] a[href*="/review/?id="]').first().getAttribute('href');
  };

  const review = await savedGame('basic-box', 'dragapult-ex');
  await page.setViewportSize({ width: 1216, height: 760 });
  await page.goto(`${base}${review}`);
  await page.locator('.summary').filter({ hasText: reviewed }).waitFor({ timeout: 60_000 });
  const key = page.locator('.head button.primary');
  if (await key.count()) await key.first().click();
  await page.waitForTimeout(1500);
  await jpg('review');

  const game = await savedGame('dragapult-ex', 'basic-box');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}${game}`);
  await page.locator('.summary').filter({ hasText: reviewed }).waitFor({ timeout: 60_000 });
  await page.locator('.strip .turn-chip').nth(3).click();
  const resume = await page.locator('.turn-detail a[href*="resume="]').getAttribute('href');
  await page.goto(`${base}${resume}&test=1`);
  await page.locator('.hcard').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.locator('.hcard').nth(1).hover();
  await page.waitForTimeout(1200);
  await jpg('board');
  await ctx.close();
  console.log(`${lang}: review${suffix}.jpg, board${suffix}.jpg`);
}
await browser.close();
