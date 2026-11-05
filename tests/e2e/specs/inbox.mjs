// Inbox + search-palette E2E (T-47): register → org → submit a run,
// then worker-simulation seeding (SQL notification rows — publishing
// has no HTTP route by design), then drive the inbox (read, dismiss,
// read-all, unread filter, preferences) and the Ctrl+K palette in the
// browser. Repository grants and the entitlement are seeded over SQL
// (recorded gaps from T-45).
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
  assert.ok(databaseUrl, 'inbox spec needs databaseUrl for worker-simulation seeding');
  const admin = new Pool({ connectionString: databaseUrl });
  const external = [];
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') external.push(request.url());
  });
  try {
    const stamp = Date.now();
    const email = `e2e-inbox-${stamp}@example.com`;
    const password = 'correct-horse-42';
    const tenantId = `e2e-inbox-${stamp}`;
    const repositoryId = `e2e-inrepo-${stamp}`;
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
    async function assertNoOverflow(where) {
      const overflow = await page.evaluate(() => {
        const bad = [];
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
          bad.push(`page scrollWidth=${document.documentElement.scrollWidth}`);
        }
        for (const element of document.querySelectorAll('main#outlet *')) {
          const tag = element.tagName.toLowerCase();
          if (tag === 'pre' || tag === 'code' || tag === 'input' || tag === 'textarea' || tag === 'select') continue; // internal scroll by design
          if (element.scrollWidth > element.clientWidth + 1) bad.push(tag);
          if (bad.length >= 5) break;
        }
        return bad;
      });
      assert.deepEqual(overflow, [], `overflow at ${where} (width ${width})`);
    }

    // Guest on the inbox: login card, never data.
    await page.goto(`${base}/#/inbox`, { waitUntil: 'networkidle' });
    await page.locator('main#outlet h1').waitFor();
    assert.equal(await page.locator('main#outlet h1').textContent(), 'Inbox needs a login');

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

    // Registration auto-provisions the initial free-tier entitlement (no manual seed).
    const entitled = await admin.query(
      'SELECT period_id, cap_amount, rate_version FROM entitlements WHERE tenant_id = $1 AND superseded_at IS NULL',
      [tenantId],
    );
    assert.equal(entitled.rows.length, 1);
    assert.equal(entitled.rows[0].period_id, 'period-free-1');
    assert.equal(entitled.rows[0].cap_amount, 1000);

    // Project + one run through the real form (search hits + run link).
    await page.goto(`${base}/#/runs/new`, { waitUntil: 'networkidle' });
    await page.locator('#new-project-name').waitFor();
    await page.locator('#new-project-name').fill(`e2e inbox project ${stamp}`);
    await page.locator('#create-project').click();
    await page.getByText(/Project project-.* created/).waitFor();
    const projectId = await page.locator('#run-project').inputValue();
    await admin.query('INSERT INTO repository_grants (tenant_id, repository_id, project_id) VALUES ($1, $2, $3)', [
      tenantId,
      repositoryId,
      projectId,
    ]);
    await page.goto(`${base}/#/runs`, { waitUntil: 'networkidle' });
    await page.goto(`${base}/#/runs/new`, { waitUntil: 'networkidle' });
    await page.locator('#run-template').waitFor();
    await page.locator('#run-template').selectOption('bugfix-run');
    await page.locator('#tpl-intent').fill(`inbox proves it ${stamp}`);
    await page.locator('#tpl-failure').fill('500 on pay');
    await page.locator('#run-template').dispatchEvent('change');
    await page.locator('#run-project').fill(projectId);
    await page.locator('#save-draft').click();
    await page.getByText(/Draft draft-.* revision 1 saved/).waitFor();
    await page.locator('input[name="repo"]').check();
    await page.locator('#submit-sources').fill('src/checkout.ts');
    await page.locator('#submit-intent').fill(`intent-${stamp}`);
    await page.locator('#submit-invariants').fill(`inv-${stamp}`);
    await page.locator('#submit-plan').fill(`plan-${stamp}`);
    await page.locator('#submit-budget-profile').fill(`budget-${stamp}`);
    await page.locator('#submit-budget').fill('50');
    await page.locator('#submit-run').click();
    await page.getByText('Run filed').waitFor();
    const runLink = await page.locator('main#outlet a', { hasText: 'Open run' }).getAttribute('href');
    assert.match(runLink ?? '', /^#\/run\?id=(run-[0-9a-f]+)$/);
    const runId = /^#\/run\?id=(run-[0-9a-f]+)$/.exec(runLink ?? '')[1];

    // Worker simulation: two inbox rows for this user, one run-linked.
    const member = await admin.query('SELECT user_id FROM memberships WHERE tenant_id = $1', [tenantId]);
    const userId = member.rows[0].user_id;
    const now = new Date().toISOString();
    await admin.query(
      'INSERT INTO notifications (id, tenant_id, user_id, event_id, category, title, body, run_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [`notif-e2e-a-${stamp}`, tenantId, userId, `evt-e2e-a-${stamp}`, 'results', `Run filed ${stamp}`, 'Your run is queued.', runId, now],
    );
    await admin.query(
      'INSERT INTO notifications (id, tenant_id, user_id, event_id, category, title, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [`notif-e2e-b-${stamp}`, tenantId, userId, `evt-e2e-b-${stamp}`, 'quota', `Quota note ${stamp}`, 'Budgets look fine.', now],
    );

    // Inbox: count, items, run link.
    await page.goto(`${base}/#/inbox`, { waitUntil: 'networkidle' });
    await page.getByText('2 unread').first().waitFor();
    await page.getByText(`Run filed ${stamp}`).waitFor();
    await page.getByText(`Quota note ${stamp}`).waitFor();
    assert.ok((await page.locator(`main#outlet a[href="#/run?id=${runId}"]`).count()) >= 1);
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
    await assertNoOverflow('inbox');

    // Mark read drops the count; dismiss removes the row.
    await page.locator(`main#outlet button[data-mark-read="notif-e2e-a-${stamp}"]`).click();
    await page.getByText('1 unread').first().waitFor();
    await page.locator(`main#outlet button[data-dismiss="notif-e2e-b-${stamp}"]`).click();
    await page.getByText(`Quota note ${stamp}`).waitFor({ state: 'detached' });

    // Unread filter + read-all + preferences persist over the API.
    await page.locator('#inbox-unread-only').check();
    await page.getByText('1 unread').first().waitFor();
    await page.locator('#inbox-read-all').click();
    await page.getByText('0 unread').first().waitFor();
    await page.locator('#pref-quota').check();
    await page.locator('#pref-save').click();
    await page.getByText('Preferences saved').waitFor();

    // Palette: Ctrl+K opens, search finds the run, Escape closes.
    await page.keyboard.press('Control+k');
    await page.locator('#palette-q').waitFor();
    await page.locator('#palette-q').fill(runId);
    await page.locator('#palette-scope').selectOption('runs');
    await page.locator('#palette-form button[type="submit"]').click();
    await page.getByText('1 match').waitFor();
    await page.locator(`.modal-backdrop a[href="#/run?id=${runId}"]`).click();
    await page.getByText('Run', { exact: true }).first().waitFor();
    await page.keyboard.press('Control+k');
    await page.locator('#palette-q').waitFor();
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
    await page.keyboard.press('Escape');
    await page.locator('#palette-q').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'palette-trigger');

    assert.deepEqual(external, [], `external requests leaked: ${external.join(', ')}`);
    assert.deepEqual(consoleErrors, [], `console errors leaked: ${consoleErrors.join(' | ')}`);
    await page.close();
  } finally {
    await admin.end();
  }
}
