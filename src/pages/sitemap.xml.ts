// The sitemap: every page in both languages, each with its other-language address (hreflang), so search engines
// show the right one. Addresses are absolute once `site` is set in astro.config; until then they are paths.
import type { APIRoute } from 'astro';
import { LANGS, localePath } from '../i18n';
import { loadDecks, metaDecks } from '../lib/decks';

export const GET: APIRoute = async ({ site }) => {
  const url = (p: string) => (site ? new URL(p, site).href : p);
  const decks = metaDecks(await loadDecks());
  const pages = ['/', '/play/', '/decks/', ...decks.map((d) => `/decks/${d.slug}/`), '/review/'];
  const alternates = (p: string) =>
    [
      ...LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${url(localePath(l, p))}"/>`),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${url(localePath('th', p))}"/>`,
    ].join('\n');
  const entries = pages.flatMap((p) => LANGS.map((l) => `  <url>\n    <loc>${url(localePath(l, p))}</loc>\n${alternates(p)}\n  </url>`));
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
