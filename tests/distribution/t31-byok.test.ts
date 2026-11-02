import { describe, expect, it } from 'vitest';

import {
  ByokCredentialSchema,
  type ByokCredential,
  type SecretBrokerPort,
  type TenantContext,
} from '../../src/core/index.js';
import {
  assertByokAuthority,
  assertByokRead,
  createRevocationCheckedBroker,
  type ByokStatusReader,
} from '../../src/modules/distribution/index.js';

/**
 * WP3-31 / T-31 — BYOK credential failure-path tests (NEG3-21, NEG3-37).
 *
 * Written before the implementation. Key material never appears in a contract
 * (strict schema rejects it), only owner/admin mutate credentials, reads stay
 * inside the tenant, and a revoked ref refuses at the broker — the value a
 * revoked credential once held is never served again.
 */

const fingerprint = 'a'.repeat(64);

function credential(overrides: Partial<ByokCredential> = {}): ByokCredential {
  return ByokCredentialSchema.parse({
    schemaVersion: '1',
    refId: 'byok-ref-1',
    tenantId: 'tenant-a',
    provider: 'meta',
    model: 'muse-spark-1.3',
    fingerprint,
    status: 'active',
    rotationVersion: 1,
    createdAt: '2026-11-02T00:00:00.000Z',
    rotatedAt: '2026-11-02T00:00:00.000Z',
    ...overrides,
  });
}

function context(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    schemaVersion: '1',
    tenantId: 'tenant-a',
    userId: 'user-owner',
    sessionId: 'session-1',
    role: 'owner',
    projectGrants: [],
    repositoryGrants: [],
    grantVersion: 0,
    expiresAt: '2026-11-03T00:00:00.000Z',
    authoritySource: 'server',
    ...overrides,
  };
}

function readerFor(records: Readonly<Record<string, ByokCredential>>): ByokStatusReader {
  return {
    getCredential: (input: { context: TenantContext; refId: string }): Promise<ByokCredential> => {
      const found = records[input.refId];
      if (found === undefined) {
        return Promise.reject(new Error('unknown credential ref'));
      }
      return Promise.resolve(found);
    },
  };
}

function mapBroker(values: ReadonlyMap<string, string>): SecretBrokerPort {
  return {
    readCredential: (refId: string): Promise<string> => {
      const value = values.get(refId);
      if (value === undefined || value.length === 0) {
        return Promise.reject(new Error('unknown or missing'));
      }
      return Promise.resolve(value);
    },
  };
}

describe('BYOK contract carries metadata only (NEG3-37)', () => {
  it('accepts a well-formed active credential record', () => {
    expect(() => {
      credential();
    }).not.toThrow();
  });

  it('rejects key material smuggled into the contract', () => {
    expect(() => {
      ByokCredentialSchema.parse({ ...credential(), keyMaterial: 'sk-live-secret' });
    }).toThrow();
  });

  it('rejects a non-SHA-256 fingerprint instead of storing an uncheckable value', () => {
    expect(() => {
      credential({ fingerprint: 'not-a-hash' });
    }).toThrow();
  });

  it('rejects an unknown schemaVersion instead of reinterpreting the record', () => {
    expect(() => {
      ByokCredentialSchema.parse({ ...credential(), schemaVersion: '2' });
    }).toThrow();
  });
});

describe('BYOK authority (NEG3-21, NEG3-37)', () => {
  it('admits owner and admin mutations inside their tenant', () => {
    expect(() => {
      assertByokAuthority(context({ role: 'owner' }), 'tenant-a');
    }).not.toThrow();
    expect(() => {
      assertByokAuthority(context({ role: 'admin' }), 'tenant-a');
    }).not.toThrow();
  });

  it('denies member, viewer, and operator mutations without disclosure', () => {
    for (const role of ['member', 'viewer', 'operator'] as const) {
      expect(() => {
        assertByokAuthority(context({ role }), 'tenant-a');
      }).toThrow(/owner or admin/);
    }
  });

  it('denies non-server authority and foreign tenants', () => {
    expect(() => {
      assertByokAuthority(context({ authoritySource: 'browser' as never }), 'tenant-a');
    }).toThrow();
    expect(() => {
      assertByokAuthority(context(), 'tenant-b');
    }).toThrow(/not authorized for this tenant/);
  });

  it('admits owner/admin/member reads and denies viewer/operator reads', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(() => {
        assertByokRead(context({ role }), 'tenant-a');
      }).not.toThrow();
    }
    for (const role of ['viewer', 'operator'] as const) {
      expect(() => {
        assertByokRead(context({ role }), 'tenant-a');
      }).toThrow();
    }
  });
});

describe('revocation-checked broker (NEG3-37)', () => {
  it('serves the broker value while the credential is active', async () => {
    const broker = createRevocationCheckedBroker(
      mapBroker(new Map([['byok-ref-1', 'live-key-value']])),
      readerFor({ 'byok-ref-1': credential() }),
      context(),
    );
    await expect(broker.readCredential('byok-ref-1')).resolves.toBe('live-key-value');
  });

  it('refuses a revoked ref even when the broker still holds a value', async () => {
    const broker = createRevocationCheckedBroker(
      mapBroker(new Map([['byok-ref-1', 'stale-key-value']])),
      readerFor({ 'byok-ref-1': credential({ status: 'revoked' }) }),
      context(),
    );
    await expect(broker.readCredential('byok-ref-1')).rejects.toThrow(/revoked/);
  });

  it('refuses an unknown ref instead of serving a default', async () => {
    const broker = createRevocationCheckedBroker(mapBroker(new Map()), readerFor({}), context());
    await expect(broker.readCredential('byok-nope')).rejects.toThrow();
  });
});
