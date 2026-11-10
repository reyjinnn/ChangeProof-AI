import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// Locks the mockup-parity direction for the workspace skin: the ported
// mockup layers in tokens.css own every shared surface, so the refinement
// file must stay additive (app-only DOM) and must never flatten, recolor,
// or de-glass what the mockup paints.
// Plain path math: `new URL(..., import.meta.url)` is a vite asset trap.
// (Same pattern as tokens.test.ts.)
const here = dirname(fileURLToPath(import.meta.url));
const refinement = readFileSync(join(here, 'workspace-refinement.css'), 'utf8');
const reset = readFileSync(join(here, 'pages', 'public-reset.css'), 'utf8');
const tokens = readFileSync(join(here, 'tokens.css'), 'utf8');
const pilot = readFileSync(join(here, 'pilot.css'), 'utf8');

describe('workspace skin stays on the mockup', () => {
  test('public reset stays scoped to the ported roots', () => {
    // A bare `.reyn-design :where(...) { all: revert; }` would also match the
    // live workspace shell (which reuses .reyn-design) and drop the sidebar
    // offset, sliding content under the fixed sidebar.
    expect(reset).not.toMatch(/^\.reyn-design\s+:where\(/m);
    expect(reset).toMatch(/#public-site-page\.reyn-design\s+:where\(/);
  });

  test('refinement preserves the mockup tinted stats and project cards', () => {
    // The mockup paints .stat/.project-card with distinct restrained tints;
    // the refinement must not flatten them back into a strip or rows.
    expect(refinement).not.toMatch(/\.stats?>\.stat[^}]*background:\s*(transparent|none)/);
    expect(refinement).not.toMatch(/\.project-card[^}]*box-shadow:\s*none/);
    expect(refinement).not.toMatch(/@layer\s+legacy\s*\{/);
    expect(tokens).toMatch(/--card-tint/);
  });

  test('refinement never recolors mockup surfaces with pilot tokens', () => {
    // Blanket #outlet heading/paragraph/link/card recolors used to paint the
    // navy welcome panel unreadable and kill the glass topbar/sidebar.
    expect(refinement).not.toMatch(/#outlet\s*:is\(h1/);
    expect(refinement).not.toMatch(/--pilot-/);
    // Pilot tokens may reach the workspace only through the alternate
    // pilot-overview page (service status); every other workspace surface
    // keeps the mockup tokens.
    const leaked = pilot.split('\n').filter((line) => line.includes('#shell.workspace-port') && !line.includes('pilot-overview'));
    expect(leaked).toEqual([]);
  });

  test('base focus ring stays on interactive controls only', () => {
    // Route focus lands on headings; a global :focus-visible rule would draw
    // a persistent box around every page title (the mockup rings controls).
    expect(tokens).toMatch(/:is\(a,\s*button,\s*input,\s*select,\s*textarea,\s*summary[^)]*\):focus-visible\s*\{[^}]*outline:\s*3px solid var\(--blue\)/);
  });

  test('collapsed rail keeps the mockup offsets', () => {
    // Desktop collapse narrows the rail to 78px and slides the topbar with
    // it (78 + 48); the divider-style section labels are restated where the
    // layered port cannot reach them.
    expect(refinement).toMatch(/body\.is-collapsed\s+#shell\.workspace-port\.workspace-refined\s*\{\s*--side-w:\s*78px/);
    expect(refinement).toMatch(/body\.is-collapsed\s+#shell\.workspace-port\.workspace-refined\s+\.topbar\s*\{\s*left:\s*126px/);
    expect(refinement).toMatch(/body\.is-collapsed\s+#shell\.workspace-port\.workspace-refined\s+\.nav-section\s*\{[^}]*height:\s*1px/);
  });
});
