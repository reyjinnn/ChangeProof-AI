// Enterprise E2E (T-49): guests see login cards on billing/enterprise;
// an owner reads the seeded period cap, honestly finds no invoice
// listing, watches BYOK fail closed (this server's broker starts empty
// — values arrive out-of-band; the full cycle is proven natively),
// provisions/rotates/links/disables a SAML connection with real keys,
// and mints then revokes a SCIM token.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';

import { axeScan } from '../helpers.mjs';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

export const needsDb = true;
export const migrations = [
  'V1__identity_tenancy.sql',
  'V2__identity_services.sql',
  'V3__jobs.sql',
  'V4__usage.sql',
  'V5__email_identity.sql',
  'V6__lifecycle.sql',
  'V7__engagement.sql',
  'V8__teamwork.sql',
  'V9__distribution.sql',
  'V10__enterprise.sql',
  'V11__service_operations.sql',
];

async function mailToken(mailApi, to, subjectPart, timeoutMs = 30_000) {
  const started = Date.now();
  for (;;) {
    const search = await (await fetch(`${mailApi}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=10`)).json();
    const hit = (search.messages ?? []).find((m) => (m.Subject ?? '').toLowerCase().includes(subjectPart));
    if (hit !== undefined) {
      const full = await (await fetch(`${mailApi}/api/v1/message/${hit.ID}`)).json();
      const match = /Token \(single use[^\n]*\n(\S+)\s*/.exec(full.Text ?? '');
      if (match?.[1] !== undefined) return match[1];
      throw new Error(`mail to ${to} carries no extractable token`);
    }
    if (Date.now() - started > timeoutMs) throw new Error(`no ${subjectPart} mail arrived for ${to}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function spec({ base, context, rootDir, mailApi, databaseUrl }) {
  assert.ok(databaseUrl, 'enterprise spec needs databaseUrl for entitlement seeding');
  const admin = new Pool({ connectionString: databaseUrl });
  const external = [];
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') external.push(request.url());
  });
  try {
    const stamp = Date.now();
    const email = `e2e-enterprise-${stamp}@example.com`;
    const password = 'correct-horse-42';
    const tenantId = `e2e-enterprise-${stamp}`;
    const width = Number(process.env.CP_E2E_WIDTH ?? '1280');
    const page = await context.newPage({ viewport: { width, height: 900 } });
    if (process.env.CP_E2E_DARK === '1') await page.emulateMedia({ colorScheme: 'dark' });
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    async function assertNoOverflow(pg, where) {
      const overflow = await pg.evaluate(() => {
        const bad = [];
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
          bad.push(`page scrollWidth=${document.documentElement.scrollWidth}`);
        }
        for (const element of document.querySelectorAll('main#outlet *')) {
          const tag = element.tagName.toLowerCase();
          if (tag === 'pre' || tag === 'code' || tag === 'input' || tag === 'textarea' || tag === 'select') continue;
          if (element.scrollWidth > element.clientWidth + 1) bad.push(tag);
          if (bad.length >= 5) break;
        }
        return bad;
      });
      if (overflow.length > 0) console.log(`OVERFLOW at ${where}: ${JSON.stringify(overflow)}`);
      assert.deepEqual(overflow, [], `overflow at ${where} (width ${width})`);
    }

    // Guests: login cards, never tenant data.
    await page.goto(`${base}/#/billing`, { waitUntil: 'networkidle' });
    await page.locator('main#outlet h1').waitFor();
    assert.equal(await page.locator('main#outlet h1').textContent(), 'Billing needs a login');
    await page.goto(`${base}/#/enterprise`, { waitUntil: 'networkidle' });
    await page.locator('main#outlet h1').waitFor();
    assert.equal(await page.locator('main#outlet h1').textContent(), 'Enterprise needs a login');

    await page.goto(`${base}/#/register`, { waitUntil: 'networkidle' });
    await page.locator('#reg-email').fill(email);
    await page.locator('#reg-password').fill(password);
    await page.locator('#reg-confirm').fill(password);
    await page.locator('main#outlet button[type="submit"]').click();
    await page.waitForURL('**#/check-email?email=**');
    const verifyToken = await mailToken(mailApi, email, 'verify');
    await page.goto(`${base}/#/verify-email?token=${encodeURIComponent(verifyToken)}`, { waitUntil: 'networkidle' });
    await page.getByText('Email verified').waitFor();
    await page.locator('main#outlet a', { hasText: 'Create organization' }).click();
    await page.locator('#org-slug').fill(tenantId);
    await page.locator('main#outlet button[type="submit"]').click();
    await page.getByText('Organization created').waitFor();
    await page.locator('main#outlet a', { hasText: 'Log in' }).click();
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(password);
    await page.locator('main#outlet button[type="submit"]').click();
    await page.waitForURL(`${base}/#/`);
    await admin.query(
      'INSERT INTO entitlements (tenant_id, period_id, cap_amount, rate_version, created_at, superseded_at) VALUES ($1, $2, $3, $4, $5, NULL)',
      [tenantId, 'period-1', 1000, 'test-rates-1', new Date().toISOString()],
    );
    const membership = await admin.query('SELECT user_id FROM memberships WHERE tenant_id = $1', [tenantId]);
    const ownerId = membership.rows[0].user_id;

    // Billing: seeded cap, no reservations, no invoice listing.
    await page.goto(`${base}/#/billing`, { waitUntil: 'networkidle' });
    await page.getByText('period-1', { exact: true }).waitFor();
    assert.match((await page.locator('main#outlet').textContent()) ?? '', /remaining 1000/);
    await page.getByText('No open reservations').waitFor();
    await page.getByText('no invoice listing').waitFor();
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
    await assertNoOverflow(page, 'billing');

    // BYOK fails closed: this server's broker starts empty.
    await page.goto(`${base}/#/enterprise`, { waitUntil: 'networkidle' });
    await page.getByText('BYOK credentials').waitFor();
    const refId = `e2e-byok-${stamp}`;
    await page.locator('#byok-ref').fill(refId);
    await page.locator('#byok-provider').fill('acme-models');
    await page.locator('#byok-model').fill('fixer-2');
    await page.locator('#byok-fingerprint').fill('c'.repeat(64));
    await page.locator('#byok-provision').click();
    await page.getByText('unknown or missing').first().waitFor();
    await page.locator('#byok-lookup-ref').fill(refId);
    await page.locator('#byok-lookup').click();
    await page.getByText('unknown in this tenant').waitFor();

    // SAML with real generated keys: provision, rotate, link, disable.
    const certOne = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const certTwo = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const issuer = `https://idp-${stamp}.example.com/issuer`;
    await page.getByText('No SAML connection').waitFor();
    await page.locator('#saml-entity').fill(`https://idp-${stamp}.example.com/entity`);
    await page.locator('#saml-issuer').fill(issuer);
    await page.locator('#saml-audience').fill('https://changeproof.example.com/saml');
    await page.locator('#saml-acs').fill('https://changeproof.example.com/saml/acs');
    await page.locator('#saml-cert').fill(certOne);
    await page.locator('#saml-domain').fill('example.com');
    await page.locator('#saml-provision').click();
    await page.getByText(issuer).waitFor();
    await page.locator('#saml-rotate-cert').fill(certTwo);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/enterprise/saml/rotate') && r.request().method() === 'POST'),
      page.locator('#saml-rotate').click(),
    ]);
    await page.locator('#saml-subject').waitFor();
    await page.locator('#saml-subject').fill(`subject-${stamp}`);
    await page.locator('#saml-user').fill(ownerId);
    await page.locator('#saml-link').click();
    await page.getByText(`Linked subject-${stamp} to ${ownerId}`).waitFor();
    await page.locator('#saml-disable').click();
    await page.getByText('disabled').first().waitFor();
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
    await assertNoOverflow(page, 'enterprise');

    // SCIM: mint once, revoke unknown stays quiet, revoke real flips.
    await page.locator('#scim-mint').click();
    await page.getByText('shown once').waitFor();
    const mintText = (await page.locator('main#outlet').textContent()) ?? '';
    const tokenId = /Token (scim-[0-9a-f-]+) is shown once/.exec(mintText)[1];
    await page.locator('#scim-revoke-id').fill('scim-nope');
    await page.locator('#scim-revoke').click();
    await page.getByText('already revoked or unknown').waitFor();
    await page.locator('#scim-revoke-id').fill(tokenId);
    await page.locator('#scim-revoke').click();
    await page.getByText(`${tokenId} revoked`).waitFor();

    assert.deepEqual(external, [], `external requests leaked: ${external.join(', ')}`);
    assert.deepEqual(consoleErrors, [], `console errors leaked: ${consoleErrors.join(' | ')}`);
    await page.close();
  } finally {
    await admin.end();
  }
}
