// Teamwork E2E (T-48): owner files and closes a ticket, requests and
// decides access, reads incidents, and is honestly denied the operator
// console; an operator (role flipped over SQL — no product API owns
// operator membership yet) reports/acks/resolves an incident and
// drains a seeded lease under the fence; threads on a real run carry
// a comment, an edit with history, and a resolve. Job leases are
// seeded over SQL; every teamwork step otherwise goes over HTTP.
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
  'V8__teamwork.sql',
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

export async function spec({ base, browser, context, rootDir, mailApi, databaseUrl }) {
  assert.ok(databaseUrl, 'teamwork spec needs databaseUrl for lease seeding');
  const admin = new Pool({ connectionString: databaseUrl });
  const external = [];
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') external.push(request.url());
  });
  const opContext = await browser.newContext();
  opContext.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') external.push(request.url());
  });
  try {
    const stamp = Date.now();
    const email = `e2e-teamwork-${stamp}@example.com`;
    const opEmail = `e2e-teamop-${stamp}@example.com`;
    const password = 'correct-horse-42';
    const tenantId = `e2e-teamwork-${stamp}`;
    const opTenantId = `e2e-teamop-${stamp}`;
    const repositoryId = `e2e-teamrepo-${stamp}`;
    const width = Number(process.env.CP_E2E_WIDTH ?? '1280');
    const page = await context.newPage({ viewport: { width, height: 900 } });
    if (process.env.CP_E2E_DARK === '1') await page.emulateMedia({ colorScheme: 'dark' });
    const consoleErrors = [];
    for (const pg of [page]) {
      pg.on('console', (message) => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
          consoleErrors.push(message.text());
        }
      });
      pg.on('pageerror', (error) => consoleErrors.push(String(error)));
    }
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
    async function registerOrgLogin(pg, userEmail, slug) {
      await pg.goto(`${base}/#/register`, { waitUntil: 'networkidle' });
      await pg.locator('#reg-email').fill(userEmail);
      await pg.locator('#reg-password').fill(password);
      await pg.locator('#reg-confirm').fill(password);
      await pg.locator('main#outlet button[type="submit"]').click();
      await pg.waitForURL('**#/check-email?email=**');
      const verifyToken = await mailToken(mailApi, userEmail, 'verify');
      await pg.goto(`${base}/#/verify-email?token=${encodeURIComponent(verifyToken)}`, { waitUntil: 'networkidle' });
      await pg.getByText('Email verified').waitFor();
      await pg.locator('main#outlet a', { hasText: 'Create organization' }).click();
      await pg.locator('#org-slug').fill(slug);
      await pg.locator('main#outlet button[type="submit"]').click();
      await pg.getByText('Organization created').waitFor();
      await pg.locator('main#outlet a', { hasText: 'Log in' }).click();
      await pg.locator('#login-email').fill(userEmail);
      await pg.locator('#login-password').fill(password);
      await pg.locator('main#outlet button[type="submit"]').click();
      await pg.waitForURL(`${base}/#/`);
    }

    // Guest on teamwork routes: login cards, never data.
    await page.goto(`${base}/#/support`, { waitUntil: 'networkidle' });
    await page.locator('main#outlet h1').waitFor();
    assert.equal(await page.locator('main#outlet h1').textContent(), 'Support needs a login');

    await registerOrgLogin(page, email, tenantId);
    // Registration auto-provisions the initial free-tier entitlement (no manual seed).
    const entitled = await admin.query(
      'SELECT period_id, cap_amount, rate_version FROM entitlements WHERE tenant_id = $1 AND superseded_at IS NULL',
      [tenantId],
    );
    assert.equal(entitled.rows.length, 1);
    assert.equal(entitled.rows[0].period_id, 'period-free-1');
    assert.equal(entitled.rows[0].cap_amount, 1000);

    // Owner files a ticket and walks it to closed.
    await page.goto(`${base}/#/support`, { waitUntil: 'networkidle' });
    await page.getByText('No tickets').waitFor();
    await page.locator('#ticket-summary').fill(`Checkout 500s ${stamp}`);
    await page.locator('#ticket-context').fill('Pay step fails on staging.');
    await page.locator('#ticket-file').click();
    await page.getByText(/Ticket ticket-.* filed as open/).waitFor();
    const receipt = (await page.locator('main#outlet').textContent()) ?? '';
    const ticketId = /Ticket (ticket-[0-9a-f]+) filed/.exec(receipt)[1];
    for (const step of ['triage', 'resolve', 'close']) {
      await page.locator(`main#outlet button[data-${step}="${ticketId}"]`).click();
      await page.waitForTimeout(400);
    }
    await page.getByText('closed', { exact: false }).first().waitFor();
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
    await assertNoOverflow(page, 'support');

    // Access request → approve → grant → revoke, all by receipt ids.
    await page.goto(`${base}/#/runs/new`, { waitUntil: 'networkidle' });
    await page.locator('#new-project-name').waitFor();
    await page.locator('#new-project-name').fill(`e2e teamwork project ${stamp}`);
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
    await page.locator('#tpl-intent').fill(`teamwork proves it ${stamp}`);
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
    const runId = /^#\/run\?id=(run-[0-9a-f]+)$/.exec(runLink ?? '')[1];

    await page.goto(`${base}/#/support`, { waitUntil: 'networkidle' });
    await page.getByText('Access requests').first().waitFor();
    await page.locator('#access-resource').fill(runId);
    await page.locator('#access-reason').fill(`review ${stamp}`);
    await page.locator('#access-file').click();
    await page.getByText(/Request accreq-.* is pending/).waitFor();
    const accessText = (await page.locator('main#outlet').textContent()) ?? '';
    const requestId = /Request (accreq-[0-9a-f]+) is pending/.exec(accessText)[1];
    await page.locator('#decide-request').fill(requestId);
    await page.locator('#decide-approve').click();
    await page.getByText(/grant grant-/).waitFor();
    const grantText = (await page.locator('main#outlet').textContent()) ?? '';
    const grantId = /grant (grant-[0-9a-f]+)/.exec(grantText)[1];
    await page.locator('#revoke-grant').fill(grantId);
    await page.locator('#revoke-run').click();
    await page.getByText(`Grant ${grantId} revoked`).waitFor();

    // Owner on the console route: honest denial, no console link.
    assert.equal(await page.locator('main#outlet a[href="#/operator"]').count(), 0);
    await page.goto(`${base}/#/operator`, { waitUntil: 'networkidle' });
    await page.getByText('Operator console is unavailable').waitFor();
    await page.getByText('Owner accounts cannot reach operator actions').waitFor();

    // Operator journey in a second context.
    const opPage = await opContext.newPage({ viewport: { width, height: 900 } });
    if (process.env.CP_E2E_DARK === '1') await opPage.emulateMedia({ colorScheme: 'dark' });
    await registerOrgLogin(opPage, opEmail, opTenantId);
    const opMember = await admin.query('SELECT user_id FROM memberships WHERE tenant_id = $1', [opTenantId]);
    await admin.query("UPDATE memberships SET role = 'operator' WHERE tenant_id = $1 AND user_id = $2", [
      opTenantId,
      opMember.rows[0].user_id,
    ]);
    await opPage.goto(`${base}/#/support`, { waitUntil: 'networkidle' });
    await opPage.locator('main#outlet a[href="#/operator"]').click();
    await opPage.getByText('Operator console').first().waitFor();
    await opPage.locator('#incident-component').fill('queue');
    await opPage.locator('#incident-summary').fill(`Backlog ${stamp}`);
    await opPage.locator('#incident-report').click();
    await opPage.getByText(/Incident inc-.* reported as open/).waitFor();
    const incText = (await opPage.locator('main#outlet').textContent()) ?? '';
    const incidentId = /Incident (inc-[0-9a-f]+) reported/.exec(incText)[1];
    await opPage.locator(`main#outlet button[data-ack="${incidentId}"]`).click();
    await opPage.waitForTimeout(400);

    // Lease seeding, then inspect → drain under the fence.
    const now = new Date().toISOString();
    const jobId = `job-e2e-${stamp}`;
    await admin.query(
      'INSERT INTO runs (id, tenant_id, idempotency_key, reservation_id, state, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [`runrec-${stamp}`, tenantId, `idem-${stamp}`, `res-${stamp}`, 'running', now],
    );
    await admin.query('INSERT INTO jobs (id, tenant_id, run_id, state, created_at) VALUES ($1, $2, $3, $4, $5)', [
      jobId,
      tenantId,
      `runrec-${stamp}`,
      'running',
      now,
    ]);
    await admin.query(
      'INSERT INTO job_leases (job_id, tenant_id, epoch, version, owner_id, guest_id, image_digest, candidate_digest, plan_digest, heartbeat_at, expires_at, state, retry_count, grant_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
      [jobId, tenantId, 4, 0, 'worker-1', 'guest-1', 'img', 'cand', 'plan', now, now, 'active', 0, 1],
    );
    await opPage.locator('#target-tenant').fill(tenantId);
    await opPage.locator('#target-job').fill(jobId);
    await opPage.locator('#target-inspect').click();
    await opPage.getByText('epoch 4').waitFor();
    await opPage.locator('#target-reason').fill(`stuck ${stamp}`);
    await opPage.locator('#target-drain').click();
    await opPage.getByText(/drain act-/).waitFor();
    assert.deepEqual((await axeScan(opPage, rootDir)).map((v) => v.id), []);
    await assertNoOverflow(opPage, 'operator console');

    // Threads on the real run: create, comment, edit, history, resolve.
    await page.goto(`${base}/#/threads?run=${encodeURIComponent(runId)}`, { waitUntil: 'networkidle' });
    await page.getByText('No threads').waitFor();
    await page.locator('#thread-create').click();
    await page.getByText(/Thread thread-.* started/).waitFor();
    const threadText = (await page.locator('main#outlet').textContent()) ?? '';
    const threadId = /Thread (thread-[0-9a-f]+) started/.exec(threadText)[1];
    await page.locator(`main#outlet textarea[data-post="${threadId}"]`).fill(`First look ${stamp}`);
    await page.locator(`main#outlet button[data-send="${threadId}"]`).click();
    await page.getByText(`First look ${stamp}`).waitFor();
    await page.locator(`main#outlet button[data-history]`).first().click();
    await page.getByText('No earlier versions.').waitFor();
    await page.locator(`main#outlet button[data-resolve="${threadId}"]`).click();
    await page.getByText('resolved', { exact: false }).first().waitFor();
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
    await assertNoOverflow(page, 'threads');

    assert.deepEqual(external, [], `external requests leaked: ${external.join(', ')}`);
    assert.deepEqual(consoleErrors, [], `console errors leaked: ${consoleErrors.join(' | ')}`);
    await page.close();
    await opPage.close();
  } finally {
    await opContext.close();
    await admin.end();
  }
}
