// Evidence E2E (T-46): submit a run through the real form, attach an
// artifact as a worker would (SQL event row + evidence file — the worker
// itself is unbuilt backend, not UI scope), then drive the library and
// the read-only viewer in the browser, including the tamper refusal
// (NEG3-33) and the honest publication absence. Repository grants and
// the entitlement are seeded over SQL (recorded gaps from T-45).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

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

export async function spec({ base, context, rootDir, mailApi, databaseUrl, evidenceDir }) {
  assert.ok(databaseUrl, 'evidence spec needs databaseUrl for worker-simulation seeding');
  assert.ok(evidenceDir, 'evidence spec needs evidenceDir for artifact bytes');
  const admin = new Pool({ connectionString: databaseUrl });
  const external = [];
  context.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') external.push(request.url());
  });
  try {
    const stamp = Date.now();
    const email = `e2e-evidence-${stamp}@example.com`;
    const password = 'correct-horse-42';
    const tenantId = `e2e-evidence-${stamp}`;
    const repositoryId = `e2e-evrepo-${stamp}`;
    const width = Number(process.env.CP_E2E_WIDTH ?? '1280');
    const page = await context.newPage({ viewport: { width, height: 900 } });
    if (process.env.CP_E2E_DARK === '1') await page.emulateMedia({ colorScheme: 'dark' });
    const consoleErrors = [];
    page.on('console', (message) => {
      // Expected HTTP negatives (the 400 tamper refusal) surface as
      // resource-load noise; app breakage arrives as pageerror or text.
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

    // Guest on evidence routes: login card, never data.
    await page.goto(`${base}/#/evidence?run=run-x`, { waitUntil: 'networkidle' });
    await page.locator('main#outlet h1').waitFor();
    assert.equal(await page.locator('main#outlet h1').textContent(), 'Evidence needs a login');

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

    // Project + submit through the real form.
    await page.goto(`${base}/#/runs/new`, { waitUntil: 'networkidle' });
    await page.locator('#new-project-name').waitFor();
    await page.locator('#new-project-name').fill(`e2e evidence project ${stamp}`);
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
    await page.locator('#tpl-intent').fill(`evidence proves it ${stamp}`);
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

    // Worker simulation at the storage boundary: digest-named bytes plus
    // the linked artifact event row. Payload carries hostile-looking
    // text; the UI must show it as text, never run it.
    const artifactText = `receipt for ${stamp}\n<script>alert('xss')</script>\nsecond line`;
    const digest = createHash('sha256').update(artifactText, 'utf8').digest('hex');
    writeFileSync(join(evidenceDir, digest), artifactText, 'utf8');
    const seqRow = await admin.query('SELECT COALESCE(MAX(seq), 0) AS top FROM run_events WHERE run_id = $1', [runId]);
    await admin.query(
      'INSERT INTO run_events (tenant_id, run_id, seq, kind, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [tenantId, runId, Number(seqRow.rows[0].top) + 1, 'artifact', JSON.stringify({ digest }), new Date().toISOString()],
    );

    // Run detail links into the library; the library lists the artifact.
    await page.goto(`${base}/#/run?id=${encodeURIComponent(runId)}`, { waitUntil: 'networkidle' });
    await page.getByText('submitted').first().waitFor();
    await page.locator('main#outlet a', { hasText: 'Open the evidence library' }).click();
    await page.getByText(digest.slice(0, 12)).first().waitFor();
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
    await assertNoOverflow('evidence library');

    // Publication absence is explicit, and export is offered.
    await page.getByText('no authorized GitHub App').waitFor();
    await page.getByText('Download run evidence (JSON)').waitFor();

    // Viewer previews escaped text with the full digest.
    await page.locator('main#outlet a', { hasText: `View ${digest.slice(0, 12)}` }).click();
    await page.getByText('Evidence viewer').first().waitFor();
    await page.getByText(`receipt for ${stamp}`).waitFor();
    assert.equal(await page.locator('main#outlet script').count(), 0);
    assert.ok(((await page.locator('main#outlet').textContent()) ?? '').includes(digest));
    assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
    await assertNoOverflow('evidence viewer');

    // Tampered bytes: same digest name, different content — the server
    // recomputes the hash and the UI repeats its refusal (NEG3-33).
    writeFileSync(join(evidenceDir, digest), 'forged bytes, wrong hash', 'utf8');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Artifact failed its integrity check').waitFor();
    await page.getByText('failed integrity verification').waitFor();

    assert.deepEqual(external, [], `external requests leaked: ${external.join(', ')}`);
    assert.deepEqual(consoleErrors, [], `console errors leaked: ${consoleErrors.join(' | ')}`);
    await page.close();
  } finally {
    await admin.end();
  }
}
