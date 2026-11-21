// The site in two languages: Thai at /, English at /en/ (each page built in its own language, for search engines).
// Card names and card text stay English in both. Text is written in place, Thai first: tx('จบเทิร์น', 'End turn').
// Astro pages pass their language explicitly (tFor); the Svelte islands, the engine, bots and workers read the one
// current language, set once at start (setLang) from the page or the worker's name.

export type Lang = 'th' | 'en';
export const LANGS: readonly Lang[] = ['th', 'en'];

let current: Lang = 'th';

export function setLang(l: Lang): void {
  current = l;
}

export function lang(): Lang {
  return current;
}

/** The text in the current language. */
export function tx(th: string, en: string): string {
  return current === 'en' ? en : th;
}

/** A text function bound to one language (Astro pages, which render both languages in one build). */
export function tFor(l: Lang): (th: string, en: string) => string {
  return (th, en) => (l === 'en' ? en : th);
}

export function asLang(x: string | undefined | null): Lang {
  return x === 'en' ? 'en' : 'th';
}

/** The language of a site path: /en/… is English, everything else Thai. */
export function langOfPath(path: string): Lang {
  return path === '/en' || path.startsWith('/en/') ? 'en' : 'th';
}

/** A site path ('/play/') in a language: '/en/play/' for English. */
export function localePath(l: Lang, path: string): string {
  const p = stripLang(path);
  return l === 'en' ? (p === '/' ? '/en/' : `/en${p}`) : p;
}

/** The path without its language prefix: '/en/play/' -> '/play/'. */
export function stripLang(path: string): string {
  if (path === '/en' || path === '/en/') return '/';
  return path.startsWith('/en/') ? path.slice(3) : path;
}

/** getStaticPaths of a page under src/pages/[...lang]/: built at /… (Thai) and /en/… (English). */
export function langPaths(): { params: { lang: string | undefined }; props: { lang: Lang } }[] {
  return LANGS.map((l) => ({ params: { lang: l === 'th' ? undefined : l }, props: { lang: l } }));
}

/** The current language's link to a site path (islands: links between pages keep the language). */
export function href(path: string): string {
  return localePath(current, path);
}

/** What the player is called in the log and prompts. */
export function youName(): string {
  return tx('คุณ', 'You');
}

export function botName(): string {
  return tx('บอท', 'Bot');
}

/**
 * An English verb agreeing with its subject: "You draw", "Bot draws". The subject is a player's name
 * (state.names); only "You" takes the plain form.
 */
export function verb(who: string, plain: string, third = `${plain}s`): string {
  return who === 'You' ? plain : third;
}

/** "Your" / "Bot's" for a player's name. */
export function possessive(who: string): string {
  return who === 'You' ? 'Your' : `${who}'s`;
}

/** "1 card", "2 cards". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A number and a Thai counting word or an English noun: count(2, 'ใบ', 'card') = '2 ใบ' / '2 cards'. */
export function count(n: number, thUnit: string, enOne: string, enMany?: string): string {
  return current === 'en' ? plural(n, enOne, enMany) : `${n} ${thUnit}`;
}
