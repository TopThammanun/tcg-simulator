// What search engines read besides the page itself: the words people search for in each language (the keywords
// tag, and the titles and descriptions written with them), and schema.org data (JSON-LD) describing the site, the
// game, where a page sits in the site, and the home page's questions. Addresses are absolute once `site` is set
// in astro.config (SITE_URL); until then they are paths.
import type { Lang } from '../i18n';

export type JsonLd = Record<string, unknown>;

/** The site's name (the same in both languages; mytrainergym is its domain). */
export const BRAND: Record<Lang, string> = { th: 'MyTrainerGym', en: 'MyTrainerGym' };
/** What it is, in each language: the name's second line in titles, shared links and schema.org. */
export const TAGLINE: Record<Lang, string> = { th: 'ยิมซ้อม Pokémon TCG ของเทรนเนอร์', en: 'The Pokémon TCG training gym' };

/** Searches the site should be found by: the game's names, in English and as Thai players write them. */
const KEYWORDS: Record<Lang, string[]> = {
  th: [
    'MyTrainerGym',
    'My Trainer Gym',
    'Pokémon TCG',
    'PTCG',
    'โปเกมอนการ์ดเกม',
    'การ์ดโปเกมอน',
    'โปเกม่อนการ์ด',
    'จัดเด็คโปเกมอน',
    'เด็คโปเกมอน',
    'ซ้อมเด็ค',
    'เด็ค meta',
    'เมต้า',
    'จำลองเกม Pokémon TCG',
    'เล่นกับบอท',
    'ยิมโปเกมอน',
    'เทรนเนอร์โปเกมอน',
    'Pokémon TCG Live',
    'Limitless',
  ],
  en: [
    'MyTrainerGym',
    'My Trainer Gym',
    'Pokémon TCG',
    'PTCG',
    'Pokémon TCG simulator',
    'Pokémon TCG deck builder',
    'Pokémon TCG playtest',
    'Pokémon TCG matchup',
    'meta decks',
    'decklist',
    'Pokémon TCG AI',
    'play Pokémon TCG online',
    'Pokémon TCG gym',
    'Pokémon TCG trainer',
    'Pokémon TCG Live',
    'Limitless',
    'Standard format',
  ],
};

/** The keywords tag: the page's own words first, then the site's. */
export function keywords(lang: Lang, own: readonly string[] = []): string {
  return [...new Set([...own, ...KEYWORDS[lang]])].join(', ');
}

type Url = (path: string) => string;

/** The site itself, on every page. */
export function websiteLd(lang: Lang, url: Url): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: BRAND[lang],
    alternateName: ['My Trainer Gym', 'mytrainergym'],
    description: TAGLINE[lang],
    url: url(lang === 'en' ? '/en/' : '/'),
    inLanguage: lang,
  };
}

/** The game in the browser (the home page): free, no account, both languages. */
export function appLd(lang: Lang, url: Url, description: string, image: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: BRAND[lang],
    url: url(lang === 'en' ? '/en/' : '/'),
    description,
    image,
    applicationCategory: 'GameApplication',
    genre: 'Trading card game',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript',
    inLanguage: ['th', 'en'],
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };
}

/** Questions and their answers, as on the page. */
export function faqLd(faq: readonly { q: string; a: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

/** Where a page sits: Home › Decks › one deck (paths already in the page's language). */
export function breadcrumbLd(url: Url, items: readonly { name: string; path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: url(it.path) })),
  };
}

/** A list of pages (the meta decks), in order. */
export function itemListLd(url: Url, items: readonly { name: string; path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: url(it.path) })),
  };
}

/** JSON-LD inside a script tag: `<` escaped so a text can't close the tag. */
export const ldJson = (data: JsonLd): string => JSON.stringify(data).replace(/</g, '\\u003c');

/** A site path as search engines want it: absolute once `site` is set in astro.config. */
export const siteUrl =
  (site: URL | undefined): Url =>
  (path) =>
    site ? new URL(path, site).href : path;
