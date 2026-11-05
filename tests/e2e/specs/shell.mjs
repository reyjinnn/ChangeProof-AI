// Shell E2E (T-42): landmarks, theme persistence, responsive drawer,
// keyboard path, zero external requests, axe scan on both themes.
import assert from 'node:assert/strict';

import { axeScan } from '../helpers.mjs';

export async function spec({ base, context, rootDir }) {
  const external = [];
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') external.push(request.url());
  });

  const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });

  // Shell lands on live status, with landmarks and a skip link.
  assert.equal(await page.locator('.skip-link').getAttribute('href'), '#outlet');
  assert.ok(await page.locator('nav[aria-label="Primary"]').isVisible());
  assert.equal(await page.locator('main#outlet h1').textContent(), 'Workspace overview');
  assert.match((await page.locator('main#outlet .badge').textContent()) ?? '', /ok: ok/);

  // Route focus starts at the heading. New overview actions participate in
  // the tab order; the skip link must still be reachable on the next cycle.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.className === 'skip-link')) break;
  }
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'skip-link');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'outlet');
  // The skip link leaves the hash at #outlet; return to the status route.
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  await page.locator('main#outlet h1').waitFor();

  // Theme toggle persists across reload.
  await page.locator('.topbar button', { hasText: 'Dark mode' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');

  // Axe scans on both themes: zero violations allowed.
  for (const theme of ['dark', 'light']) {
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme) {
      await page.locator('.topbar button', { hasText: 'mode' }).click();
    }
    await page.locator('main#outlet h1').waitFor();
    const violations = await axeScan(page, rootDir);
    if (violations.length > 0) console.error(JSON.stringify(violations.map(v => ({
      id: v.id, nodes: v.nodes.map(node => ({ target: node.target, reason: node.failureSummary })),
    }))));
    assert.deepEqual(
      violations.map((v) => v.id),
      [],
      `axe violations on ${theme}: ${JSON.stringify(violations.map((v) => v.id))}`,
    );
  }

  // Mobile drawer: menu opens, Escape closes and refocuses the trigger.
  await page.setViewportSize({ width: 375, height: 800 });
  const menu = page.locator('.menu-button');
  assert.ok(await menu.isVisible());
  await menu.click();
  assert.equal(await menu.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'button menu-button');

  assert.deepEqual(external, [], `external requests leaked: ${external.join(', ')}`);
  await page.close();
}
