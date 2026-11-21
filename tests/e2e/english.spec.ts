// The English site (/en/…): its own pages for search engines, a link to the same page in Thai, and a game and its
// review with no Thai on screen.
import { expect, test, type Page } from '@playwright/test';

const THAI = /[฀-๿]/;

/** The page's visible text without the link to the Thai site. */
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.lang-switch, script, style').forEach((el) => el.remove());
    return clone.innerText;
  });
}

test('the English pages are built in English and point at their Thai versions', async ({ page }) => {
  for (const path of ['/en/', '/en/decks/', '/en/decks/dragapult-ex/', '/en/review/']) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('link[rel="alternate"][hreflang="th"]')).toHaveAttribute('href', path.replace(/^\/en/, ''));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', path);
    await page.waitForLoadState('networkidle');
    expect(await visibleText(page)).not.toMatch(THAI);
  }
  // The Thai page links back to the English one.
  await page.goto('/decks/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await expect(page.locator('.nav .lang-switch')).toHaveAttribute('href', '/en/decks/');
});

test('switching language keeps the page and its query', async ({ page }) => {
  await page.goto('/play/?opp=basic-box');
  await page.locator('.nav .lang-switch').click();
  await expect(page).toHaveURL(/\/en\/play\/\?opp=basic-box$/);
  await expect(page.getByRole('heading', { name: 'Pick the decks and play' })).toBeVisible();
});

test('an English game plays to the end and its review is in English', async ({ page }) => {
  await page.goto('/en/play/?watch=1&test=1&speed=0&seed=7&me=basic-box&opp=dragapult-ex&save=1');
  await expect(page.locator('.result')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.log .line').first()).toBeVisible();
  const over = page.getByRole('dialog', { name: 'Game over' });
  await expect(over).toBeVisible();
  expect(await visibleText(page)).not.toMatch(THAI);

  await over.getByRole('link', { name: /Review this game/ }).click();
  await expect(page).toHaveURL(/\/en\/review\/\?id=\d+/);
  await expect(page.locator('.summary')).toContainText('of your', { timeout: 30_000 });
  await expect(page.locator('.sentence')).not.toBeEmpty();
  expect(await visibleText(page)).not.toMatch(THAI);
});

test('the sitemap lists every page in both languages, each with its other-language address', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.replace(/^https?:\/\/[^/]+/, ''));
  for (const path of ['/', '/play/', '/decks/', '/decks/dragapult-ex/', '/review/']) {
    expect(locs).toContain(path);
    expect(locs).toContain(path === '/' ? '/en/' : `/en${path}`);
  }
  expect(xml.match(/hreflang="en"/g)!.length).toBe(locs.length);
  expect(await (await request.get('/robots.txt')).text()).toContain('Allow: /');
});
