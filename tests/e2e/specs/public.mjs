// Public site E2E (T-43): all seventeen manifest routes render with
// working CTAs; FAQ search, template gate, synthetic sample,
// changelog, roadmap, and pricing read live data; no tenant-shaped
// key appears in any public payload (NEG3-21); axe on three pages.
import assert from 'node:assert/strict';

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

  // Every manifest route renders its title with resolving CTAs.
  for (const route of routes.data) {
    await page.goto(`${base}/#/p${route.path}`, { waitUntil: 'networkidle' });
    await page.locator('main#outlet h1').waitFor();
    assert.equal(await page.locator('main#outlet h1').textContent(), route.title);
    const ctas = page.locator('main#outlet .cta-row a');
    const count = await ctas.count();
    assert.equal(count, route.ctas.length, `CTA count on ${route.path}`);
    for (let i = 0; i < count; i += 1) {
      const href = await ctas.nth(i).getAttribute('href');
      assert.ok(href && href.length > 0, `CTA href on ${route.path}`);
      if (href.startsWith('#/p/') || href === '#/p/') {
        await page.goto(`${base}/${href}`, { waitUntil: 'networkidle' });
        await page.locator('main#outlet h1').waitFor();
        assert.doesNotMatch((await page.locator('main#outlet').textContent()) ?? '', /Page not found/);
        await page.goto(`${base}/#/p${route.path}`, { waitUntil: 'networkidle' });
        await page.locator('main#outlet h1').waitFor();
      } else if (href.startsWith('#/login')) {
        await page.goto(`${base}/${href}`, { waitUntil: 'networkidle' });
        await page.locator('main#outlet h1').waitFor();
        // T-44 replaced the login notice with the real form at the same
        // route; the CTA still lands on login with its return held.
        assert.match((await page.locator('main#outlet h1').textContent()) ?? '', /Log in/);
        assert.ok((await page.locator('#login-email').count()) === 1);
        await page.goto(`${base}/#/p${route.path}`, { waitUntil: 'networkidle' });
        await page.locator('main#outlet h1').waitFor();
      } else {
        assert.match(href, /^https?:\/\//, `unexpected CTA target ${href}`);
      }
    }
  }

  // FAQ search: ranked results, empty-query error, honest recovery.
  await page.goto(`${base}/#/p/help`, { waitUntil: 'networkidle' });
  await page.locator('main#outlet h1').waitFor();
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
  await page.locator('main#outlet h1').waitFor();
  assert.ok((await page.locator('main#outlet').textContent()).includes('What you will provide'));
  await page.locator('main#outlet .button.primary').click();
  await page.waitForURL('**#/login?return=**');
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /\/app\/projects\/new/);

  // Sample detail carries the synthetic provenance label.
  const samples = await (await fetch(`${base}/api/site/samples`)).json();
  await page.goto(`${base}/#/p/samples/${samples.data[0].id}`, { waitUntil: 'networkidle' });
  await page.locator('main#outlet h1').waitFor();
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /SYNTHETIC/i);

  // Changelog separates design from releases; roadmap and pricing show data.
  await page.goto(`${base}/#/p/changelog`, { waitUntil: 'networkidle' });
  await page.locator('main#outlet h1').waitFor();
  await page.locator('main#outlet h2', { hasText: 'Design notes' }).waitFor();
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /Design notes/);
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /Releases/);
  await page.goto(`${base}/#/p/roadmap`, { waitUntil: 'networkidle' });
  await page.locator('main#outlet h1').waitFor();
  await page.locator('main#outlet h2', { hasText: 'Qualification status' }).waitFor();
  assert.match((await page.locator('main#outlet').textContent()) ?? '', /in-qualification|planned/);
  await page.goto(`${base}/#/p/pricing`, { waitUntil: 'networkidle' });
  await page.locator('main#outlet h1').waitFor();
  await page.locator('main#outlet p', { hasText: 'Pricing version' }).first().waitFor();
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
    await page.locator('main#outlet h1').waitFor();
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

  await page.close();
}
