import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// The token file is the artifact under test: parse the real CSS variables
// and prove WCAG AA contrast for every text/background pair, in both
// themes, plus the focus ring, breakpoints, and self-hosted fonts.
// (Plain path math: `new URL(..., import.meta.url)` is a vite asset trap.)
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tokens.css'), 'utf8');

function block(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[[=\]"]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = pattern.exec(css);
  if (match?.[1] === undefined) throw new Error(`CSS block ${selector} is missing.`);
  return match[1];
}

function varsOf(selector: string): Map<string, string> {
  const vars = new Map<string, string>();
  const text = block(selector);
  const pattern = /--([\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) vars.set(name, value.trim());
  }
  return vars;
}

function normalizeHex(raw: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (short !== null) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return raw.toLowerCase();
}

function luminance(hex: string): number {
  const full = normalizeHex(hex);
  const rgb = [1, 3, 5].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const light = varsOf(':root');
// Dark inherits unset variables from :root; overlay the dark overrides.
const dark = new Map(light);
for (const [key, value] of varsOf('[data-theme="dark"]')) dark.set(key, value);

const PAIRS: readonly (readonly [string, string, string])[] = [
  ['ink', 'bg', 'body text'],
  ['muted', 'bg', 'secondary text'],
  ['accent-ink', 'accent', 'primary button'],
  ['ink', 'paper', 'card text'],
  ['green', 'green-soft', 'ok badge'],
  ['amber', 'amber-soft', 'warning badge'],
  ['red', 'red-soft', 'error badge'],
  ['info', 'info-soft', 'info badge'],
];

for (const [themeName, theme] of [
  ['light', light],
  ['dark', dark],
] as const) {
  test(`${themeName} theme: text pairs meet WCAG AA 4.5:1`, () => {
    for (const [fg, bg, label] of PAIRS) {
      // Dark warning badges keep the readable amber override (see tokens.css).
      const foreground = normalizeHex(
        themeName === 'dark' && fg === 'amber' ? '#f2cd88' : (theme.get(fg) ?? ''),
      );
      const background = normalizeHex(theme.get(bg) ?? '');
      expect(foreground, `${label} foreground`).toMatch(/^#[0-9a-f]{6}$/);
      expect(background, `${label} background`).toMatch(/^#[0-9a-f]{6}$/);
      const ratio = contrast(foreground, background);
      expect(ratio, `${themeName} ${label} (${foreground} on ${background})`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test('visible focus ring exists on every theme', () => {
  expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--blue\)/);
});

test('responsive breakpoints collapse the sidebar', () => {
  expect(css).toMatch(/@media\s*\(max-width:\s*1200px\)/);
  expect(css).toMatch(/@media\s*\(max-width:\s*760px\)/);
  expect(css).toMatch(/body\.sidebar-collapsed \.sidebar\s*\{\s*display:\s*none/);
});

test('fonts are self-hosted variable WOFF2 with a swap fallback', () => {
  expect(css).toMatch(/font-family:\s*"Inter"[\s\S]*?src:\s*url\("\/assets\/fonts\/inter-latin-variable\.woff2"\)/);
  expect(css).toMatch(
    /font-family:\s*"Plus Jakarta Sans"[\s\S]*?src:\s*url\("\/assets\/fonts\/plusjakartasans-latin-variable\.woff2"\)/,
  );
  expect(css).not.toMatch(/https?:\/\//);
  expect(css).toMatch(/--body-font:\s*"Inter",\s*"Segoe UI",\s*system-ui,\s*sans-serif/);
});

test('reduced motion disables animation and smooth scrolling', () => {
  expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});
