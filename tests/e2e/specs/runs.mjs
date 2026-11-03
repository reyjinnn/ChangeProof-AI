// Run journey E2E (T-45): register → org → file a run through the real
// form → poll the live timeline → cancel → retry, plus empty states
// and axe on the journey pages. Repository grants and the entitlement
// are seeded over SQL (no product API owns them yet — recorded gap);
// every journey step itself goes through the real UI + API.
import assert from 'node:assert/strict';
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
  'V10__enterprise.sql',
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
  assert.ok(databaseUrl, 'runs spec needs databaseUrl for recorded-gap seeding');
  const admin = new Pool({ connectionString: databaseUrl });
  const external = [];
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') external.push(request.url());
  });
  try {
    const stamp = Date.now();
    const email = `e2e-runs-${stamp}@example.com`;
    const password = 'correct-horse-42';
    const tenantId = `e2e-runs-${stamp}`;
    const repositoryId = `e2e-repo-${stamp}`;
    const page = await context.newPage({ viewport: { width: 1280, height: 900 } });

    // Guests see login cards on the journey routes, never data.
    await page.goto(`${base}/#/runs`, { waitUntil: 'networkidle' });
    await page.locator('main#outlet h1').waitFor();
    assert.equal(await page.locator('main#outlet h1').textContent(), 'Runs need a login');

    // Register → verify → create-org → login.
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
    await page.locator('#account', { hasText: new RegExp(`${tenantId}.*owner`) }).waitFor();

    // Entitlement first (tenant is known); the repo grant follows the
    // project the form creates. Both are recorded backend gaps.
    await admin.query(
      'INSERT INTO entitlements (tenant_id, period_id, cap_amount, rate_version, created_at, superseded_at) VALUES ($1, $2, $3, $4, $5, NULL)',
      [tenantId, 'period-1', 1000, 'test-rates-1', new Date().toISOString()],
    );

    // Empty lists explain the next step.
    await page.goto(`${base}/#/runs`, { waitUntil: 'networkidle' });
    await page.getByText('No runs yet').waitFor();
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);

    // Create the project through the form, then grant the repo to it.
    await page.goto(`${base}/#/runs/new`, { waitUntil: 'networkidle' });
    await page.locator('#new-project-name').waitFor();
    await page.locator('#new-project-name').fill(`e2e project ${stamp}`);
    await page.locator('#create-project').click();
    await page.getByText(/Project project-.* created/).waitFor();
    const projectId = await page.locator('#run-project').inputValue();
    assert.match(projectId, /^project-[0-9a-f]+$/);
    await admin.query('INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ($1, $2, $3)', [
      tenantId,
      repositoryId,
      projectId,
    ]);

    // Fresh form, full journey: template → draft → submit → receipt.
    // (Navigate away first: an identical hash is not a navigation.)
    await page.goto(`${base}/#/runs`, { waitUntil: 'networkidle' });
    await page.goto(`${base}/#/runs/new`, { waitUntil: 'networkidle' });
    await page.locator('#run-template').waitFor();
    await page.locator('#run-template').selectOption('bugfix-run');
    await page.locator('#tpl-intent').fill(`checkout works again ${stamp}`);
    await page.locator('#tpl-failure').fill('500 on pay');
    await page.locator('#run-template').dispatchEvent('change');
    assert.equal(await page.locator('#draft-intent').inputValue(), `checkout works again ${stamp}`);
    await page.locator('#run-project').fill(projectId);
    await page.locator('#save-draft').click();
    await page.getByText(/Draft draft-.* revision 1 saved/).waitFor();
    assert.ok((await page.locator('#recent-drafts a').count()) >= 1);
    await page.locator('input[name="repo"]').check();
    await page.locator('#submit-sources').fill('src/checkout.ts');
    await page.locator('#submit-intent').fill(`intent-${stamp}`);
    await page.locator('#submit-invariants').fill(`inv-${stamp}`);
    await page.locator('#submit-plan').fill(`plan-${stamp}`);
    await page.locator('#submit-budget-profile').fill(`budget-${stamp}`);
    await page.locator('#submit-budget').fill('50');
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
    await page.locator('#submit-run').click();
    await page.getByText('Run filed').waitFor();
    await page.getByText('New run.').waitFor();
    const runLink = await page.locator('main#outlet a', { hasText: 'Open run' }).getAttribute('href');
    assert.match(runLink ?? '', /^#\/run\?id=run-[0-9a-f]+$/);

    // Live timeline: queued header plus the submitted event.
    await page.locator('main#outlet a', { hasText: 'Open run' }).click();
    await page.getByText('submitted').first().waitFor();
    assert.match((await page.locator('main#outlet').textContent()) ?? '', /queued/);
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);

    // Cancel lands, then retry files a new run for the same meaning.
    await page.locator('#cancel-run').click();
    await page.getByText('Run cancelled.').waitFor();
    await page.locator('#retry-run').click();
    await page.getByText(/Retried as run-/).waitFor();
    await page.locator('main#outlet a', { hasText: 'Open retried run' }).click();
    await page.getByText('submitted').first().waitFor();

    assert.deepEqual(external, [], `external requests leaked: ${external.join(', ')}`);
    await page.close();
  } finally {
    await admin.end();
  }
}
