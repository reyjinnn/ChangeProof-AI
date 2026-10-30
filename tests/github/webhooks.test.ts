import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assertDeliveryFresh,
  assertInstallationGrant,
  checkDuplicateDelivery,
  verifyWebhookSignature,
} from '../../src/modules/github/index.js';
import { RepositoryConnectionSchema } from '../../src/core/index.js';

/**
 * WP3-22 / T2-6 — webhook failure-path tests (NEG3-22, NEG3-23, NEG3-39).
 *
 * Written before the implementation. Signed webhooks are verified over the
 * raw body, delivery IDs are durably deduplicated, and revocation stops new
 * effects. Credentials stay in the secret broker (a parameter here, never
 * logged or stored). Live installation acceptance still needs an authorized
 * GitHub App and stays `blocked`; this is the pure verification core.
 */

const SECRET = 'broker-held-webhook-secret';
const BODY = JSON.stringify({ action: 'opened', installation: { id: 42 } });

function signatureFor(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function connection(overrides: Record<string, unknown> = {}) {
  return RepositoryConnectionSchema.parse({
    schemaVersion: '1',
    connectionId: 'conn-1',
    tenantId: 'tenant-a',
    installationId: 'install-42',
    provider: 'github',
    repositoryAllowlist: ['repo-1'],
    permissionMatrix: { contents: true },
    status: 'active',
    revocationVersion: 2,
    credentialRef: 'cred-1',
    ...overrides,
  });
}

describe('webhook signature verification (NEG3-39)', () => {
  it('accepts a correctly signed delivery', () => {
    expect(() => { verifyWebhookSignature({ rawBody: BODY, signatureHeader: signatureFor(BODY, SECRET), secret: SECRET }); },
    ).not.toThrow();
  });

  it('rejects a forged signature instead of treating the event as authority', () => {
    expect(() => { verifyWebhookSignature({ rawBody: BODY, signatureHeader: signatureFor(BODY, 'wrong-secret'), secret: SECRET }); },
    ).toThrow(/signature/);
  });

  it('rejects a body that was tampered with after signing', () => {
    expect(() => { verifyWebhookSignature({
        rawBody: `${BODY} `,
        signatureHeader: signatureFor(BODY, SECRET),
        secret: SECRET,
      }); },
    ).toThrow(/signature/);
  });

  it('rejects a missing or malformed signature header instead of defaulting to trust', () => {
    expect(() => { verifyWebhookSignature({ rawBody: BODY, signatureHeader: '', secret: SECRET }); }).toThrow();
    expect(() => { verifyWebhookSignature({ rawBody: BODY, signatureHeader: 'md5=deadbeef', secret: SECRET }); },
    ).toThrow();
  });

  it('rejects an empty secret rather than verifying against nothing', () => {
    expect(() => { verifyWebhookSignature({ rawBody: BODY, signatureHeader: signatureFor(BODY, SECRET), secret: '' }); },
    ).toThrow();
  });
});

describe('durable delivery dedup (NEG3-23)', () => {
  it('treats the first delivery as new', () => {
    expect(checkDuplicateDelivery(new Set(), 'delivery-1')).toBe(false);
  });

  it('treats a redelivered ID as a duplicate, never a second effect', () => {
    expect(checkDuplicateDelivery(new Set(['delivery-1']), 'delivery-1')).toBe(true);
  });

  it('rejects an empty delivery ID instead of deduping around it', () => {
    expect(() => checkDuplicateDelivery(new Set(), '')).toThrow();
  });
});

describe('installation grant and revocation (NEG3-22)', () => {
  it('accepts an active connection whose allowlist covers every required repo', () => {
    expect(() => { assertInstallationGrant(connection(), { repositoryIds: ['repo-1'], revocationVersion: 2 }); },
    ).not.toThrow();
  });

  it('stops new effects when the installation was revoked mid-run', () => {
    expect(() => { assertInstallationGrant(connection({ status: 'revoked' }), {
        repositoryIds: ['repo-1'],
        revocationVersion: 2,
      }); },
    ).toThrow(/revoked/i);
  });

  it('rejects a grant version that moved on (suspension/reinstall)', () => {
    expect(() => { assertInstallationGrant(connection(), { repositoryIds: ['repo-1'], revocationVersion: 3 }); },
    ).toThrow(/revocation/i);
  });

  it('rejects repos outside the installation allowlist without disclosure', () => {
    expect(() => { assertInstallationGrant(connection(), { repositoryIds: ['repo-1', 'repo-9'], revocationVersion: 2 }); },
    ).toThrow(/not authorized/);
  });
});

describe('delivery freshness (out-of-order protection)', () => {
  it('accepts a delivery inside the clock-skew window', () => {
    expect(() => { assertDeliveryFresh({
        deliveredAtMs: 1_000_000,
        receivedAtMs: 1_060_000,
        maxSkewMs: 300_000,
      }); },
    ).not.toThrow();
  });

  it('rejects a delivery older than the window instead of applying it out of order', () => {
    expect(() => { assertDeliveryFresh({
        deliveredAtMs: 1_000_000,
        receivedAtMs: 2_000_000,
        maxSkewMs: 300_000,
      }); },
    ).toThrow(/stale/i);
  });
});
