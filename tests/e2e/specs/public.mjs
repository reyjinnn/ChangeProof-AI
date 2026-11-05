// Public site E2E (T-43): all seventeen manifest routes render with
// working CTAs; FAQ search, template gate, synthetic sample,
// changelog, roadmap, and pricing read live data; no tenant-shaped
// key appears in any public payload (NEG3-21); axe on three pages.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const reference = JSON.parse(readFileSync(new URL('../fixtures/root-mockup-pages.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const audited = new Set();

import { axeScan } from '../helpers.mjs';

const FORBIDDEN = [
  'tenant',
  'tenantid',
  'orgid',
  'organizationid',
  'repoid',
  'repositoryid',
  'email',
  'token',
  'secret',
  'credential',
  'password',
  'grant',
  'grants',
  'session',
  'sessionid',
  'apikey',
];

function deepKeys(value, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) deepKeys(entry, found);
    return found;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      found.push(key);
      deepKeys(entry, found);
    }
  }
  return found;
}

export async function spec({ base, context, rootDir }) {
  const page = await context.newPage({ viewport: { width: 1280, height: 900 } });

  const routes = await (await fetch(`${base}/api/site/routes`)).json();
  assert.equal(routes.ok, true);
  assert.equal(routes.data.length, 17);

  // The landing uses the owner's visual headline/two CTAs; other public
  // pages retain their published manifest titles and CTA counts.
  for (const route of routes.data) {
    await page.goto(`${base}/#/p${route.path}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).waitFor();
    const landing = route.path === '/';
    assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), reference[route.path].headline);
    const ctas = page.locator('main#outlet a[href]');
    const count = await ctas.count();
    assert.ok(count > 0, `Public destinations on ${route.path}`);
    if (landing) assert.deepEqual(await page.locator('.cp-identity-hero .modern-cta-pair a').evaluateAll(nodes => nodes.map(n => n.getAttribute('href'))), ['#/p/pricing', '#/register']);
    for (let i = 0; i < count; i += 1) {
      const href = await ctas.nth(i).getAttribute('href');
      assert.ok(href && href.length > 0, `CTA href on ${route.path}`); if (audited.has(href)) continue; audited.add(href);
      if (href.startsWith('#/p/') || href === '#/p/') {
        await page.goto(`${base}/${href}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).waitFor();
        assert.doesNotMatch((await page.locator('main#outlet').textContent()) ?? '', /Page not found/);
        await page.goto(`${base}/#/p${route.path}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).waitFor();
      } else if (href === '#/') {
        await page.goto(`${base}/${href}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Workspace overview', exact: true }).waitFor();
        await page.locator('.overview-facts').waitFor();
        assert.equal(await page.locator('[data-overview-primary]').getAttribute('href'), '#/login');
        await page.goto(`${base}/#/p${route.path}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).waitFor();
      } else if (href === '#/register') {
        await page.goto(`${base}/${href}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Create an account', exact: true }).waitFor();
        await page.goto(`${base}/#/p${route.path}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).waitFor();
      } else if (href.startsWith('#/login')) {
        await page.goto(`${base}/${href}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).waitFor();
        // T-44 replaced the login notice with the real form at the same
        // route; the CTA still lands on login with its return held.
        assert.match((await page.getByRole('heading', { level: 1 }).textContent()) ?? '', /Log in/);
        assert.ok((await page.locator('#login-email').count()) === 1);
        await page.goto(`${base}/#/p${route.path}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { level: 1 }).waitFor();
      } else {
        assert.match(href, /^https?:\/\//, `unexpected CTA target ${href}`);
      }
    }
  }

  // FAQ search: ranked results, empty-query error, honest recovery.
  await page.goto(`${base}/#/p/help`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.locator('#faq-q').fill('evidence');
  await page.locator('form[role="search"] button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelectorAll('main#outlet .faq-item').length > 0);
  await page.locator('#faq-q').fill('');
  await page.locator('form[role="search"] button[type="submit"]').click();
  assert.match((await page.locator('main#outlet .error-text').textContent()) ?? '', /at least one word/);
  await page.locator('#faq-q').fill('zzzqqqx-no-such-word');
  await page.locator('form[role="search"] button[type="submit"]').click();
  await page.waitForFunction(() => (document.querySelector('main#outlet [aria-live]')?.textContent ?? '').length > 0);

  // Template detail + guest apply gate to the login notice.
  const templates = await (await fetch(`${base}/api/site/templates`)).json();
  const templateId = templates.data[0].id;
  await page.goto(`${base}/#/p/templates/${templateId}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.ok((await page.locator('main#outlet').textContent()).includes('What you will provide'));
  await page.locator('main#outlet .button.primary').click();
  await page.waitForURL('**#/login?return=**');
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /\/app\/projects\/new/);

  // Sample detail carries the synthetic provenance label.
  const samples = await (await fetch(`${base}/api/site/samples`)).json();
  await page.goto(`${base}/#/p/samples/${samples.data[0].id}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /SYNTHETIC/i);

  // Changelog separates design from releases; roadmap and pricing show data.
  await page.goto(`${base}/#/p/changelog`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.locator('main#outlet h2', { hasText: 'Design notes' }).waitFor();
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /Design notes/);
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /Releases/);
  await page.goto(`${base}/#/p/roadmap`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.locator('main#outlet h2', { hasText: 'Qualification status' }).waitFor();
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /in-qualification|planned/);
  await page.goto(`${base}/#/p/pricing`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.locator('main#outlet p', { hasText: 'Published pricing' }).first().waitFor();
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /Free/);

  // Public/private boundary over every public payload (NEG3-21).
  const endpoints = [
    '/api/site/routes',
    '/api/site/faqs',
    '/api/site/faq?q=email',
    '/api/site/templates',
    `/api/site/templates/${templateId}`,
    '/api/site/samples',
    `/api/site/samples/${samples.data[0].id}`,
    '/api/site/changelog',
    '/api/site/roadmap',
    '/api/site/pricing',
  ];
  for (const endpoint of endpoints) {
    const payload = await (await fetch(`${base}${endpoint}`)).json();
    const leaked = deepKeys(payload).filter((key) => FORBIDDEN.includes(key.toLowerCase()));
    assert.deepEqual(leaked, [], `tenant-shaped keys in ${endpoint}: ${leaked.join(',')}`);
  }

  // Axe on three representative pages, plus a 768px no-overflow check.
  for (const hash of ['#/p/', '#/p/pricing', '#/p/help']) {
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { level: 1 }).waitFor();
    const violations = await axeScan(page, rootDir);
    assert.deepEqual(
      violations.map((v) => v.id),
      [],
      `axe violations on ${hash}`,
    );
  }
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(`${base}/#/p/pricing`, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow at 768px: ${overflow}px`);

  // Exact owner-reported public navigation regressions, including history/refresh.
  await page.goto(`${base}/#/p/`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'How it works', exact: true }).click();
  await page.waitForURL('**#/p/how-it-works');
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.doesNotMatch(await page.locator('main#outlet').textContent(), /Page not found/);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.doesNotMatch(await page.locator('main#outlet').textContent(), /Page not found/);
  await page.goBack({ waitUntil: 'networkidle' });
  await page.locator('.cp-identity-hero').waitFor();
  await page.goForward({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.ok(page.url().endsWith('#/p/how-it-works'));
  await page.goto(`${base}/#/p/missing-regression-page`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Page not found', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Back to start', exact: true }).click();
  await page.waitForURL('**#/p/');
  await page.locator('.cp-identity-hero').waitFor();
  assert.equal(await page.locator('.sidebar').isVisible(), false);

  // Composition regression: real DOM line boxes, not CSS-class presence alone.
  // Visual approval still requires inspecting the full-page screenshots.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto(`${base}/#/p/product`, { waitUntil: 'networkidle' });
    await page.locator('.contract-diff-header').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const rows = await page.locator('[data-feature-index]').evaluateAll(nodes => nodes.map(node => {
      const number = node.querySelector('.feature-number'), title = node.querySelector('h2');
      const n = number.getBoundingClientRect(), t = title.getBoundingClientRect(), container = node.getBoundingClientRect();
      const p = node.querySelector('p').getBoundingClientRect(), a = node.querySelector('a').getBoundingClientRect();
      return { text: number.textContent, size: Number.parseFloat(window.getComputedStyle(number).fontSize), numberX: n.x, titleX: t.x, topDelta: Math.abs(n.top - t.top), descriptionX: p.x, actionX: a.x, leftInset: n.left - container.left, rightInset: container.right - a.right };
    }));
    assert.deepEqual(rows.map(row => row.text), ['01', '02', '03', '04']);
    for (const row of rows) {
      assert.ok(row.size >= 18 && row.topDelta <= 8, `number is readable and anchored to its title at ${width}px`);
      assert.ok(row.leftInset >= 20 && row.rightInset >= 20, `Product content has internal horizontal breathing room at ${width}px`);
      assert.ok(Math.abs(row.numberX - rows[0].numberX) < 1 && Math.abs(row.titleX - rows[0].titleX) < 1, 'editorial columns align across all rows');
      if (width === 390) assert.ok(Math.abs(row.titleX - row.descriptionX) < 1 && Math.abs(row.titleX - row.actionX) < 1, 'mobile description and action align under the title');
    }
    assert.equal(await page.locator('.contract-diff-line').count(), 4);
    assert.equal(await page.locator('[data-diff=removed] code').textContent(), '  id: string;');
    assert.equal(await page.locator('[data-diff=added] code').textContent(), '  id: OrderId;');
    assert.match(await page.locator('.contract-diff-header').textContent(), /Illustrative.*Not executed/);
    assert.doesNotMatch(await page.locator('[data-product-illustration]').textContent(), /passed|successfully|execution complete/i);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.goto(`${base}/#/p/changelog`, { waitUntil: 'networkidle' });
    await page.locator('.public-release .release-entry').first().waitFor();
    const timeline = await page.locator('.public-release .release-entry').evaluateAll(nodes => nodes.map(node => {
      const heading = node.querySelector('h3').getBoundingClientRect(), date = node.querySelector('time').getBoundingClientRect(), body = node.querySelector('p').getBoundingClientRect();
      return { x: heading.x, width: heading.width, dateX: date.x, bodyX: body.x, y: heading.y, bottom: node.getBoundingClientRect().bottom };
    }));
    assert.ok(timeline.length >= 2, 'The published design-note fixtures exercise repeated timeline entries');
    for (const entry of timeline) {
      assert.ok(Math.abs(entry.x - timeline[0].x) < 1 && Math.abs(entry.x - entry.dateX) < 1 && Math.abs(entry.x - entry.bodyX) < 1, 'Every timeline marker/date/title/body shares one content column');
      assert.ok(entry.width >= (width === 390 ? 240 : 600), 'Timeline entries are not squeezed into the old date/sidebar column');
    }
    for (let i = 1; i < timeline.length; i += 1) assert.ok(timeline[i].y > timeline[i - 1].bottom, 'Entries follow one vertical reading order');
    await page.goto(`${base}/#/session-expired`, { waitUntil: 'networkidle' });
    const signIn = page.locator('.fresh-auth-form a.button.primary');
    await signIn.waitFor();
    const target = await signIn.boundingBox();
    assert.ok(target.height >= 44 && target.width >= 60, 'The expired-session recovery link remains a usable button, not an inline text sliver');
    await signIn.click();
    await page.waitForURL('**#/login');
    await page.locator('#login-email').waitFor();
  }
  await page.close();
}
