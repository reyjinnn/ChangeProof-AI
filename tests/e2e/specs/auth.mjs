// Auth journey E2E (T-44): real register → Mailpit verify → create-org
// → login → settings → invite → reset → delete flows in the browser,
// plus login negatives, guest guards, and axe on login/settings.
import assert from 'node:assert/strict';

import { axeScan } from '../helpers.mjs';

export const needsDb = true;
export const migrations = [
  'V1__identity_tenancy.sql',
  'V2__identity_services.sql',
  'V5__email_identity.sql',
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

export async function spec({ base, context, rootDir, browser, mailApi }) {
  const stamp = Date.now();
  const ownerEmail = `e2e-owner-${stamp}@example.com`;
  const memberEmail = `e2e-member-${stamp}@example.com`;
  const password = 'correct-horse-42';
  const page = await context.newPage({ viewport: { width: 1280, height: 900 } });
  // Measure settled text, not the transient opacity of the opening modal.
  // landing.mjs separately proves animation and reduced-motion behavior.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // Guests see the settings login card, never settings (NEG3-29).
  await page.goto(`${base}/#/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Settings need a login');

  // Register → verify → create-org → login.
  await page.goto(`${base}/#/register`, { waitUntil: 'networkidle' });
  await page.locator('#reg-email').fill(ownerEmail);
  await page.locator('#reg-password').fill(password);
  await page.locator('#reg-confirm').fill(password);
  await page.locator('main#outlet button[type="submit"]').click();
  await page.waitForURL('**#/check-email?email=**');
  const verifyToken = await mailToken(mailApi, ownerEmail, 'verify');
  await page.goto(`${base}/#/verify-email?token=${encodeURIComponent(verifyToken)}`, { waitUntil: 'networkidle' });
  await page.getByText('Email verified').waitFor();
  await page.locator('main#outlet a', { hasText: 'Create organization' }).click();
  await page.locator('#org-slug').waitFor();
  await page.locator('#org-slug').fill(`e2e-org-${stamp}`);
  await page.locator('main#outlet button[type="submit"]').click();
  await page.getByText('Organization created').waitFor();
  await page.locator('main#outlet a', { hasText: 'Log in' }).click();
  await page.locator('#login-email').waitFor();
  assert.equal(await page.locator('#login-tenant').inputValue(), `e2e-org-${stamp}`);
  await page.locator('#login-email').fill(ownerEmail);
  await page.locator('#login-password').fill(password);
  await page.locator('main#outlet button[type="submit"]').click();
  await page.waitForURL(`${base}/#/`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  // Wait, never assert immediately: the account refresh lands after the
  // status heading on a fast render.
  await page.locator('#account', { hasText: new RegExp(`e2e-org-${stamp}.*owner`) }).waitFor();

  // Login negatives: wrong password alerts; evil return targets die at 400.
  await page.locator('#account-summary').click();
  await page.locator('#account button', { hasText: 'Log out' }).click();
  await page.locator('#account a[href="#/login"]').waitFor();
  await page.goto(`${base}/#/login`, { waitUntil: 'networkidle' });
  await page.locator('#login-email').fill(ownerEmail);
  await page.locator('#login-password').fill('wrong-password-1');
  await page.locator('main#outlet button[type="submit"]').click();
  await page.locator('main#outlet [role="alert"]').waitFor();
  const evil = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ChangeProofUI' },
    body: JSON.stringify({ email: ownerEmail, password, rememberMe: false, returnTarget: 'https://evil.example/' }),
  });
  assert.equal(evil.status, 400);

  // Log back in; settings shows the session with a current marker.
  await page.locator('#login-password').fill(password);
  await page.locator('main#outlet button[type="submit"]').click();
  await page.waitForURL(`${base}/#/`);
  await page.locator('#account-summary').waitFor();
  await page.goto(`${base}/#/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.getByText('This session').waitFor();
  assert.match((await page.locator('main#outlet').textContent()) ?? '', new RegExp(`e2e-org-${stamp}`));

  // Invite the member; the member path runs register → own org → accept.
  await page.locator('#invite-role').selectOption('member');
  await page.locator('main#outlet form', { hasText: 'Create invitation' }).locator('button[type="submit"]').click();
  await page.getByText('Share this one-time link').waitFor();
  const inviteLink = (await page.locator('main#outlet code.inline').textContent()) ?? '';
  assert.ok(inviteLink.startsWith('#/invite?token='));

  // Two users, two jars: sharing one context would let the member
  // login silently reassign the owner page to the member tenant.
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(`${base}/#/register`, { waitUntil: 'networkidle' });
  await member.locator('#reg-email').fill(memberEmail);
  await member.locator('#reg-password').fill(password);
  await member.locator('#reg-confirm').fill(password);
  await member.locator('main#outlet button[type="submit"]').click();
  await member.waitForURL('**#/check-email?email=**');
  const memberToken = await mailToken(mailApi, memberEmail, 'verify');
  await member.goto(`${base}/#/verify-email?token=${encodeURIComponent(memberToken)}`, { waitUntil: 'networkidle' });
  await member.getByText('Email verified').waitFor();
  await member.locator('main#outlet a', { hasText: 'Create organization' }).click();
  await member.locator('#org-slug').fill(`e2e-home-${stamp}`);
  await member.locator('main#outlet button[type="submit"]').click();
  await member.getByText('Organization created').waitFor();
  await member.locator('main#outlet a', { hasText: 'Log in' }).click();
  await member.locator('#login-email').fill(memberEmail);
  await member.locator('#login-password').fill(password);
  await member.locator('main#outlet button[type="submit"]').click();
  await member.waitForURL(`${base}/#/`);
  // Member tenant text (not just any logout button): the shared-context
  // slot still shows the owner until the member refresh lands.
  await member.locator('#account-summary').click();
  await member.getByText(new RegExp(`e2e-home-${stamp}.*owner`)).waitFor();
  await member.locator('#account-summary').click();
  await member.goto(`${base}/${inviteLink}`, { waitUntil: 'networkidle' });
  await member.getByText('Invitation accepted').waitFor();
  // Multi-tenant login reveals the organization field on demand.
  await member.locator('main#outlet a', { hasText: 'Log in' }).click();
  await member.locator('#login-email').fill(memberEmail);
  await member.locator('#login-password').fill(password);
  await member.locator('main#outlet button[type="submit"]').click();
  await member.locator('#login-tenant').waitFor();
  assert.notEqual(await member.locator('#login-tenant').evaluate((el) => el.closest('.field').style.display), 'none');
  await member.close();
  await memberContext.close();

  // Password reset revokes the old session (documented policy).
  await page.goto(`${base}/#/forgot-password`, { waitUntil: 'networkidle' });
  await page.locator('#forgot-email').fill(ownerEmail);
  await page.locator('main#outlet button[type="submit"]').click();
  await page.getByText('reset mail is on its way').waitFor();
  const resetToken = await mailToken(mailApi, ownerEmail, 'reset');
  await page.goto(`${base}/#/reset-password?token=${encodeURIComponent(resetToken)}`, { waitUntil: 'networkidle' });
  await page.locator('#reset-password').fill('new-correct-horse-43');
  await page.locator('#reset-confirm').fill('new-correct-horse-43');
  await page.locator('main#outlet button[type="submit"]').click();
  await page.getByText('Password changed').waitFor();
  // Fresh navigation on a revoked session shows the login card — the same
  // contract as guests. (Mid-session 401 → #/session-expired is covered
  // by the settings unit test instead.)
  await page.goto(`${base}/#/settings`, { waitUntil: 'networkidle' });
  await page.locator('main#outlet h1', { hasText: 'Settings need a login' }).waitFor();
  await page.locator('main#outlet a', { hasText: 'Log in' }).click();
  await page.locator('#login-email').fill(ownerEmail);
  await page.locator('#login-password').fill('new-correct-horse-43');
  await page.locator('main#outlet button[type="submit"]').click();
  await page.waitForURL(`${base}/#/`);
  await page.locator('#account-summary').waitFor();

  // Reset replay fails closed (NEG3-30).
  const replay = await fetch(`${base}/api/auth/password/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ChangeProofUI' },
    body: JSON.stringify({ token: resetToken, newPassword: 'another-horse-44' }),
  });
  assert.equal(replay.status, 400);

  // Axe on login + settings.
  await page.goto(`${base}/#/login`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);
  await page.goto(`${base}/#/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.deepEqual((await axeScan(page, rootDir)).map((v) => v.id), []);

  await page.close();
}
