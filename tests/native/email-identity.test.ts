import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EmailDeliveryReceipt, EmailMessage } from '../../src/core/index.js';
import { createEmailIdentityStore } from '../../src/modules/identity/index.js';
import { createMapSecretBroker } from '../../src/modules/github/broker.js';

import { databaseUrlFor, resetProbeDatabase } from './db.js';

/**
 * WP3-28 / T-18 — email identity flows on real PostgreSQL (FR3-38, NEG3-29/30).
 *
 * Native check, reported separately from the pure suite: `pnpm test` excludes
 * `tests/native/**`; run with `DATABASE_URL=… pnpm test:identity:native`
 * against a disposable PostgreSQL 16 container. Fails closed without
 * DATABASE_URL. Applies V1 (tenancy) + V2 (services) + V5 (email); every test
 * uses its own addresses so tests never share state.
 *
 * Delivery here is an in-memory recorder: it proves the store composes and
 * sends the right messages. Actual SMTP delivery is proven separately in
 * `email-delivery.test.ts` against a disposable Mailpit server.
 *
 * Written before the implementation ran green. Registration, verification,
 * login, recovery, and onboarding consume single-use purpose-bound tokens;
 * unknown addresses and wrong passwords share response shapes with the
 * legitimate paths so neither is an oracle.
 */

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    'DATABASE_URL is required (e.g. postgresql://postgres:<pw>@127.0.0.1:55433/postgres). ' +
      'Start the disposable probe container first; see docs/phase-reports/phase-2.md.',
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const migration = (name: string): string =>
  readFileSync(join(here, '..', '..', 'infra', 'postgres', name), 'utf8');
const v1 = migration('V1__identity_tenancy.sql');
const v2 = migration('V2__identity_services.sql');
const v5 = migration('V5__email_identity.sql');

// Own database per file: scheduling (serial or parallel) cannot cross-talk.
const fileDbUrl = databaseUrlFor(databaseUrl, 't_email');
const admin = new Pool({ connectionString: fileDbUrl });
const appUrl = new URL(fileDbUrl);
appUrl.username = 'app_user';
appUrl.password = 'app-probe-only';
const appPool = new Pool({ connectionString: appUrl.toString() });

const sent: EmailMessage[] = [];
const delivery = {
  send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    sent.push(message);
    return Promise.resolve({ messageId: `fake-${sent.length}`, acceptedAt: NOW });
  },
};
const secrets = createMapSecretBroker(new Map([['email-challenge-secret', 'test-challenge-secret-32-chars!!']]));
const store = createEmailIdentityStore(appPool, {
  delivery,
  secrets,
  challengeSecretRef: 'email-challenge-secret',
});

const NOW = '2026-11-01T00:00:00.000Z';
const PASSWORD = 'correct-horse-42';

let counter = 0;
function uniqueEmail(): string {
  counter += 1;
  return `user-${counter}@example.test`;
}

function lastToken(): string {
  const body = sent[sent.length - 1]?.textBody ?? '';
  const lines = body.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const token = lines[lines.length - 1] ?? '';
  if (!token.startsWith('v1.')) {
    throw new Error('Expected the last delivery to carry a challenge token.');
  }
  return token;
}

function sentCount(): number {
  return sent.length;
}

beforeAll(async () => {
  await resetProbeDatabase(databaseUrl, 't_email');
  await admin.query(v1);
  await admin.query(v2);
  await admin.query(v5);
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await admin.end();
});

describe('registration, verification, and onboarding', () => {
  it('registers, verifies, claims an organization, and logs in with a session', async () => {
    const email = uniqueEmail();
    const before = sentCount();
    const { userId } = await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    expect(sentCount()).toBe(before + 1);
    expect(sent[sent.length - 1]?.to).toBe(email);
    expect(sent[sent.length - 1]?.subject).toMatch(/verif/i);

    const verified = await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    expect(verified.userId).toBe(userId);

    const tenantId = `tenant-${userId}`;
    await store.claimTenant({ ticket: verified.claimTicket, tenantId, nowIso: NOW });
    const login = await store.loginWithPassword({ email, password: PASSWORD, rememberMe: false, nowIso: NOW });
    expect(login.tenantId).toBe(tenantId);
    const sessions = await store.listUserSessions({ userId });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.revoked).toBe(false);
  });

  it('answers duplicate registration with the same shape, never a second user', async () => {
    const email = uniqueEmail();
    const first = await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    const second = await store.registerUser({ email, password: 'another-valid-1', nowIso: NOW });
    expect(second.userId).toBe(first.userId);
    // Unverified duplicates re-trigger verification, like a resend.
    expect(sent[sent.length - 1]?.subject).toMatch(/verif/i);

    await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    const third = await store.registerUser({ email, password: 'third-valid-pass-1', nowIso: NOW });
    expect(third.userId).toBe(first.userId);
    expect(sent[sent.length - 1]?.subject).toMatch(/already exists/i);
  });

  it('rejects malformed addresses and weak passwords at registration', async () => {
    await expect(store.registerUser({ email: 'not-an-email', password: PASSWORD, nowIso: NOW })).rejects.toThrow(
      /malformed/i,
    );
    await expect(store.registerUser({ email: uniqueEmail(), password: 'short', nowIso: NOW })).rejects.toThrow(
      /10\.\.128/,
    );
  });
});

describe('tokens are single-use, expiring, and purpose-bound (NEG3-30)', () => {
  it('rejects a replayed verification token', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    const token = lastToken();
    await store.verifyEmail({ token, nowIso: NOW });
    await expect(store.verifyEmail({ token, nowIso: NOW })).rejects.toThrow(/invalid|used|expired/i);
  });

  it('rejects an expired token instead of verifying late', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    const token = lastToken();
    await expect(store.verifyEmail({ token, nowIso: '2026-11-03T00:00:00.001Z' })).rejects.toThrow(/expir/i);
  });

  it('refuses to spend a reset token as a verification', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    await store.requestPasswordReset({ email, nowIso: NOW });
    const resetToken = lastToken();
    await expect(store.verifyEmail({ token: resetToken, nowIso: NOW })).rejects.toThrow(/purpose|invalid/i);
  });

  it('rejects a replayed claim ticket and a taken tenant id', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    const { claimTicket } = await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    const tenantId = `tenant-claim-${counter}`;
    await store.claimTenant({ ticket: claimTicket, tenantId, nowIso: NOW });
    await expect(store.claimTenant({ ticket: claimTicket, tenantId: `tenant-other-${counter}`, nowIso: NOW }))
      .rejects.toThrow(/invalid|used|expired/i);

    const email2 = uniqueEmail();
    await store.registerUser({ email: email2, password: PASSWORD, nowIso: NOW });
    const second = await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    await expect(store.claimTenant({ ticket: second.claimTicket, tenantId, nowIso: NOW })).rejects.toThrow(/taken/i);
  });
});

describe('resend and reset reveal nothing (NEG3-30)', () => {
  it('answers unknown and verified addresses silently', async () => {
    const before = sentCount();
    await store.resendVerification({ email: 'nobody-knows@example.test', nowIso: NOW });
    await store.requestPasswordReset({ email: 'nobody-knows@example.test', nowIso: NOW });
    expect(sentCount()).toBe(before);

    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    const verifiedBefore = sentCount();
    await store.resendVerification({ email, nowIso: NOW });
    expect(sentCount()).toBe(verifiedBefore);
  });

  it('rate-limits resends without revealing anything else', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await store.resendVerification({ email, nowIso: NOW });
    }
    await expect(store.resendVerification({ email, nowIso: NOW })).rejects.toThrow(/too many/i);
  });
});

describe('login shares one failure shape (NEG3-30) and guards its target (NEG3-29)', () => {
  it('reports unknown users and wrong passwords identically', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    const { claimTicket } = await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    await store.claimTenant({ ticket: claimTicket, tenantId: `tenant-login-${counter}`, nowIso: NOW });

    const wrong = await store
      .loginWithPassword({ email, password: 'wrong-password-1', rememberMe: false, nowIso: NOW })
      .then(
        () => 'unexpected-success',
        (error: unknown) => (error instanceof Error ? error.message : 'unexpected-shape'),
      );
    const unknown = await store
      .loginWithPassword({ email: 'ghost@example.test', password: 'wrong-password-1', rememberMe: false, nowIso: NOW })
      .then(
        () => 'unexpected-success',
        (error: unknown) => (error instanceof Error ? error.message : 'unexpected-shape'),
      );
    expect(wrong).toBe('Email or password is incorrect.');
    expect(unknown).toBe(wrong);
  });

  it('rejects a forged return target instead of redirecting away', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    const { claimTicket } = await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    await store.claimTenant({ ticket: claimTicket, tenantId: `tenant-target-${counter}`, nowIso: NOW });
    await expect(
      store.loginWithPassword({
        email,
        password: PASSWORD,
        rememberMe: false,
        returnTarget: 'https://evil.example/',
        nowIso: NOW,
      }),
    ).rejects.toThrow(/return target/i);
    const ok = await store.loginWithPassword({
      email,
      password: PASSWORD,
      rememberMe: false,
      returnTarget: '/dashboard',
      nowIso: NOW,
    });
    expect(ok.sessionId.length).toBeGreaterThan(0);
  });

  it('refuses login before the organization is claimed', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    await expect(
      store.loginWithPassword({ email, password: PASSWORD, rememberMe: false, nowIso: NOW }),
    ).rejects.toThrow(/organization/i);
  });

  it('names the tenant explicitly when the user owns several', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    const { userId, claimTicket } = await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    const firstTenant = `tenant-multi-a-${counter}`;
    await store.claimTenant({ ticket: claimTicket, tenantId: firstTenant, nowIso: NOW });
    const secondTenant = `tenant-multi-b-${counter}`;
    await admin.query(`INSERT INTO tenants (id) VALUES ($1)`, [secondTenant]);
    await admin.query(`INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES ($1, $2, 'owner', 0)`, [
      secondTenant,
      userId,
    ]);
    await expect(
      store.loginWithPassword({ email, password: PASSWORD, rememberMe: false, nowIso: NOW }),
    ).rejects.toThrow(/several|name the tenant/i);
    const explicit = await store.loginWithPassword({
      email,
      password: PASSWORD,
      tenantId: secondTenant,
      rememberMe: true,
      nowIso: NOW,
    });
    expect(explicit.tenantId).toBe(secondTenant);
    // A 30-day remember-me session outlives the default 12-hour one.
    expect(Date.parse(explicit.expiresAt) - Date.parse(NOW)).toBe(30 * 24 * 3_600_000);
    await expect(
      store.loginWithPassword({
        email,
        password: PASSWORD,
        tenantId: 'tenant-stranger-1',
        rememberMe: false,
        nowIso: NOW,
      }),
    ).rejects.toThrow(/membership|tenant/i);
  });
});

describe('password reset rotates credentials and revokes sessions (NEG3-30)', () => {
  it('resets with a fresh token, revokes every session, and rejects replays', async () => {
    const email = uniqueEmail();
    await store.registerUser({ email, password: PASSWORD, nowIso: NOW });
    const { userId, claimTicket } = await store.verifyEmail({ token: lastToken(), nowIso: NOW });
    await store.claimTenant({ ticket: claimTicket, tenantId: `tenant-reset-${counter}`, nowIso: NOW });
    await store.loginWithPassword({ email, password: PASSWORD, rememberMe: false, nowIso: NOW });
    await store.loginWithPassword({ email, password: PASSWORD, rememberMe: true, nowIso: NOW });
    expect(await store.listUserSessions({ userId })).toHaveLength(2);

    await store.requestPasswordReset({ email, nowIso: NOW });
    const token = lastToken();
    await store.resetPassword({ token, newPassword: 'brand-new-pass-1', nowIso: NOW });

    const sessions = await store.listUserSessions({ userId });
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.revoked)).toBe(true);
    await store.loginWithPassword({ email, password: 'brand-new-pass-1', rememberMe: false, nowIso: NOW });
    await expect(
      store.loginWithPassword({ email, password: PASSWORD, rememberMe: false, nowIso: NOW }),
    ).rejects.toThrow(/incorrect/i);
    await expect(store.resetPassword({ token, newPassword: 'another-new-pass-1', nowIso: NOW })).rejects.toThrow(
      /invalid|used|expired/i,
    );
  });
});
