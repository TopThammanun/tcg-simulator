// The site's components stay on the design tokens (layouts/Base.astro :root, UI-PLAN.md U4): text sizes from the one
// scale (12 … 60px, and --fs-card for what is drawn on a card), colours from tokens. Black and white with an alpha
// (shadows, scrims, a card's own white text) are neutral shades and allowed. The drawn cards scale with the card, so
// they are the exceptions: FxLayer (the animations' copies), CardBack (the drawn back), CardFace (its text frame).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src/components';
const SCALE = new Set(['12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px', '48px', '60px', 'var(--fs-card)', 'inherit']);
const FONT_EXEMPT = new Set(['FxLayer.svelte', 'CardBack.svelte', 'CardFace.svelte']);
const COLOUR_EXEMPT = new Set(['FxLayer.svelte', 'CardBack.svelte']);
const NEUTRAL = /^#(0{3}|0{6}|f{3}|f{6})([0-9a-f]{1,2})?$/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(svelte|astro)$/.test(f) ? [p] : [];
  });
}

/** Each component's <style>, with its file name and the rest of the file (where `style:--x={…}` sets its own). */
const styles = files(ROOT).flatMap((p) => {
  const text = readFileSync(p, 'utf8');
  const m = text.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return m
    ? [{ file: relative(ROOT, p).replace(/\\/g, '/'), name: p.split(/[\\/]/).pop()!, css: m[1]!, markup: text.replace(m[0], '') }]
    : [];
});

describe('the design tokens', () => {
  it('finds the components', () => {
    expect(styles.length).toBeGreaterThan(30);
  });

  it('text sizes come from the scale', () => {
    const off = styles
      .filter((s) => !FONT_EXEMPT.has(s.name))
      .flatMap((s) => [...s.css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim()).filter((v) => !SCALE.has(v)).map((v) => `${s.file}: ${v}`));
    expect(off).toEqual([]);
  });

  it('colours come from tokens (black and white shades aside)', () => {
    const off = styles
      .filter((s) => !COLOUR_EXEMPT.has(s.name))
      .flatMap((s) => [...s.css.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]).filter((h) => !NEUTRAL.test(h)).map((h) => `${s.file}: ${h}`));
    expect(off).toEqual([]);
  });

  it('every token a component uses is defined', () => {
    const base = readFileSync('src/layouts/Base.astro', 'utf8');
    const defined = new Set([...base.matchAll(/(--[\w-]+):/g)].map((m) => m[1]!));
    // Custom properties a component sets for itself (--w, --fill, --pct, style:--o …) are its own; one read with a
    // fallback, var(--hand-w, …), may be set by a parent or not at all.
    const own = new Set(styles.flatMap((s) => [...s.css.matchAll(/(--[\w-]+):/g), ...s.markup.matchAll(/(--[\w-]+)/g)].map((m) => m[1]!)));
    const missing = styles.flatMap((s) =>
      [...s.css.matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]!).filter((t) => !defined.has(t) && !own.has(t)).map((t) => `${s.file}: ${t}`),
    );
    expect([...new Set(missing)]).toEqual([]);
  });
});
