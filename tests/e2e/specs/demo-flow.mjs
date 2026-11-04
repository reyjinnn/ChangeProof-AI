// Real public → email account → project → versioned draft journey.
// No worker/model call, payment, PR or fabricated repair result.
import assert from 'node:assert/strict';

export const needsDb = true;
export const migrations = ['V1__identity_tenancy.sql', 'V2__identity_services.sql', 'V3__jobs.sql', 'V4__usage.sql', 'V5__email_identity.sql', 'V6__lifecycle.sql', 'V7__engagement.sql', 'V10__enterprise.sql'];

async function verificationToken(mailApi, email) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await (await fetch(`${mailApi}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=10`)).json();
    const mail = (result.messages ?? []).find(item => /verify/i.test(item.Subject));
    if (mail) {
      const full = await (await fetch(`${mailApi}/api/v1/message/${mail.ID}`)).json();
      const token = /Token \(single use[^\n]*\n(\S+)\s*/.exec(full.Text ?? '')?.[1];
      if (token) return token;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Verification mail did not arrive in the isolated Mailpit instance.');
}

export async function spec({ base, context, mailApi }) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now(), email = `demo-flow-${stamp}@example.com`, tenant = `demo-flow-${stamp}`, password = 'demo-flow-test-password-42';
  await page.goto(`${base}/#/p/`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('[role=tab]').count(), 3);
  await page.locator('[data-proof-tab=candidate]').click();
  assert.equal(await page.locator('#proof-panel-candidate').isVisible(), true);
  await page.locator('.cp-identity-hero a[href="#/register"]').click();
  await page.locator('#reg-email').fill(email);
  await page.locator('#reg-password').fill(password);
  await page.locator('#reg-confirm').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**#/check-email?email=**');
  const token = await verificationToken(mailApi, email);
  await page.goto(`${base}/#/verify-email?token=${encodeURIComponent(token)}`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Create organization', exact: true }).click();
  await page.locator('#org-slug').fill(tenant);
  await page.locator('main button[type=submit]').click();
  await page.getByText('Organization created', { exact: true }).waitFor();
  await page.goto(`${base}/#/login?tenant=${tenant}`, { waitUntil: 'networkidle' });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(`${base}/#/`);
  await page.locator('#account', { hasText: tenant }).waitFor();
  await page.goto(`${base}/#/projects/new`, { waitUntil: 'networkidle' });
  await page.locator('#project-name').fill('Demo review project');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForURL('**#/project?id=**');
  await page.getByRole('link', { name: 'Prepare a run', exact: true }).click();
  await page.locator('#draft-intent').fill('Investigate a controlled API change; do not claim a repaired workflow without evidence.');
  await page.locator('#save-draft').click();
  await page.locator('#draft-result', { hasText: /revision/i }).waitFor();
  assert.match(await page.locator('.run-form-summary').textContent(), /Muse and Modal are not configured/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#run-project').waitFor();
  assert.equal(await page.getByText('Page not found', { exact: true }).count(), 0);
  await page.goto(`${base}/#/billing`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Usage period not configured', exact: true }).waitFor();
  assert.equal(await page.locator('.usage-bar').count(), 0, 'An unconfigured entitlement is not a zero-valued budget');

  // Delay genuine HTTP session responses, then leave before they complete.
  // No auth outcome or backend response is fabricated by this check.
  for (const path of ['/projects', '/projects/new', '/impact']) {
    let release;
    let captured;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { captured = resolve; });
    await page.route('**/api/auth/session', async route => {
      const response = await route.fetch();
      captured();
      await gate;
      await route.fulfill({ response });
    }, { times: 1 });
    const response = page.waitForResponse('**/api/auth/session');
    await page.evaluate(path => { window.location.hash = `#${path}`; }, path);
    await started;
    await page.evaluate(() => { window.location.hash = '#/p/product'; });
    await page.getByRole('heading', { name: 'Clear changes. Confident decisions.', exact: true }).waitFor();
    release();
    await (await response).finished();
    await page.evaluate(() => new Promise(resolve => { window.requestAnimationFrame(() => { window.requestAnimationFrame(resolve); }); }));
    assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Clear changes. Confident decisions.', `${path}: stale session must not replace the public page`);
    assert.ok(page.url().endsWith('#/p/product'));
  }
  await page.close();
}
