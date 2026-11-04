// Public/local demo acceptance: real HTTP and browser, no invented run receipts.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { axeScan } from '../helpers.mjs';

export async function spec({ base, context, rootDir }) {
  const directory = process.env.CP_E2E_ARTIFACT_DIR ?? join(rootDir, 'runs', 'ui-demo');
  mkdirSync(directory, { recursive: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => {
    if (!['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)) external.push(request.url());
  });
  const check = async (name) => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name}: overflow`);
    await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
    const violations = await axeScan(page, rootDir);
    writeFileSync(join(directory, `${name}.axe.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map(item => item.id), [], `${name}: accessibility violations`);
  };

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Every change.One proof.');
  assert.equal(await page.locator('.sidebar').isVisible(), false);
  assert.ok(await page.getByRole('region', { name: 'Technology scope preview', exact: true }).isVisible());
  assert.ok(await page.getByText('Muse and Modal are unavailable in this demo', { exact: false }).isVisible());
  await check('home-desktop');
  const stillFrame = await page.locator('.cp-ghost-fibers').evaluate(canvas => canvas.toDataURL());
  await page.evaluate(() => new Promise(resolve => { window.requestAnimationFrame(() => { window.requestAnimationFrame(resolve); }); }));
  assert.ok(await page.locator('.cp-ghost-fibers').evaluate(canvas => canvas.toDataURL()) === stillFrame,
    'The decorative background stays still with reduced motion enabled');
  const stages = page.getByRole('tab');
  await stages.first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await stages.nth(1).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await stages.last().getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await stages.first().getAttribute('aria-selected'), 'true');

  await page.goto(`${base}/#/p/templates`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Start with the right question.');
  await check('templates-desktop');
  await page.goto(`${base}/#/p/sample-report`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Open sample' }).first().click();
  await page.getByText('Samples show the report layout only; they are not customer results.').waitFor();
  await check('synthetic-sample');

  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Workspace overview');
  assert.ok(await page.getByText(/No live Muse model or Modal sandbox connection is confirmed/).isVisible());
  const boxes = await page.locator('.sidebar .nav-icon').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height };
  }));
  assert.ok(boxes.length > 0);
  assert.ok(boxes.every(box => box.width <= 22 && box.height <= 22), 'Navigation icons must remain compact');
  await check('workspace-desktop');
  const geometry = await page.evaluate(() => {
    const heading = document.querySelector('main h1').getBoundingClientRect();
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    const brand = document.querySelector('.sidebar .brand').getBoundingClientRect();
    return { headingTop: heading.top, barBottom: bar.bottom, brandHeight: brand.height };
  });
  assert.ok(geometry.headingTop >= geometry.barBottom + 16, 'The fixed header must not cover the page heading');
  assert.ok(geometry.brandHeight >= 32, 'The sidebar wordmark must not be clipped');

  for (const width of [768, 390, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await check(`workspace-${width}`);
    if (width < 760) {
      const cards = await page.locator('.stats > .stat').evaluateAll(nodes => nodes.map(node => {
        const { x, y } = node.getBoundingClientRect(); return { x, y };
      }));
      assert.equal(cards[0].y, cards[1].y, 'Mobile status cards share a compact two-column row');
      assert.ok(cards[1].x > cards[0].x);
      const menu = page.locator('.menu-button');
      await menu.click();
      assert.equal(await menu.getAttribute('aria-expanded'), 'true');
      await check(`navigation-${width}`);
      const lastLink = page.locator('.sidebar a[href], .sidebar summary, .sidebar button').filter({ visible: true }).last();
      await lastLink.focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.sidebar .brand').evaluate(node => node === document.activeElement), true,
        'Tab must wrap from the final account link to the first drawer link');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await lastLink.evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(await menu.getAttribute('aria-expanded'), 'false');
      assert.ok(await menu.evaluate(node => node === document.activeElement));
    }
    await page.goto(`${base}/#/p/`, { waitUntil: 'networkidle' });
    await check(`home-${width}`);
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  }
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await check('workspace-dark-mobile');
  await page.goto(`${base}/#/p/`, { waitUntil: 'networkidle' });
  await check('home-dark-mobile');

  await page.goto(`${base}/#/login`, { waitUntil: 'networkidle' });
  assert.ok(await page.getByRole('dialog').isVisible(), 'Login uses the original accessible modal');
  await check('login-dark-mobile');

  // Deliberate network failure: no mock success or fabricated health result.
  await page.route('**/api/health', route => route.abort());
  await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Service unreachable' }).waitFor();
  await check('service-error-mobile');
  await page.unroute('**/api/health');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
  assert.deepEqual(errors, [], 'No JavaScript page errors');
  assert.deepEqual(external, [], 'Fonts and assets must stay local');
  await page.close();
}
