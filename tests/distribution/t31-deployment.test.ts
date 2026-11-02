import { describe, expect, it } from 'vitest';

import {
  ByokCredentialSchema,
  DeploymentProfileSchema,
  DeploymentQualificationSchema,
  DeploymentReceiptSchema,
  DeploymentBlockedError,
  type DeploymentProfile,
  type DeploymentQualification,
} from '../../src/core/index.js';
import {
  assertDeploymentQualified,
  assertProfileRuntime,
  computeArtifactDigest,
} from '../../src/modules/distribution/index.js';
import { parseSelfHostArgs } from '../../src/cli/selfhost.js';

/**
 * WP3-31 / T-31 — deployment gate failure-path tests (NEG3-28, NEG3-37).
 *
 * Written before the implementation. An unqualified profile is `blocked`,
 * never installed on a guess; runtime pins must match exactly; the artifact
 * digest binds the exact profile plus migration bytes; and destructive CLI
 * commands refuse without explicit confirmation.
 */

function profile(overrides: Partial<DeploymentProfile> = {}): DeploymentProfile {
  return DeploymentProfileSchema.parse({
    schemaVersion: '1',
    profileId: 'local-linux',
    platform: 'linux-x64',
    nodePin: '26.12.1',
    pnpmPin: '12.5.1',
    postgresPin: '16',
    migrationFiles: ['V1__identity_tenancy.sql', 'V9__distribution.sql'],
    maxConcurrentRuns: 4,
    diskGb: 20,
    qualificationMethod: 'qual-method-1',
    ...overrides,
  });
}

function qualification(overrides: Partial<DeploymentQualification> = {}): DeploymentQualification {
  return DeploymentQualificationSchema.parse({
    schemaVersion: '1',
    profileId: 'local-linux',
    method: 'qual-method-1',
    receiptRefs: ['receipt-install-1'],
    qualifiedAt: '2026-11-02T00:00:00.000Z',
    ...overrides,
  });
}

describe('deployment contracts', () => {
  it('accepts a well-formed profile, qualification, and receipt', () => {
    expect(() => {
      profile();
      qualification();
      DeploymentReceiptSchema.parse({
        schemaVersion: '1',
        receiptId: 'receipt-1',
        profileId: 'local-linux',
        step: 'install',
        artifactDigest: 'b'.repeat(64),
        success: true,
        startedAt: '2026-11-02T00:00:00.000Z',
        finishedAt: '2026-11-02T00:01:00.000Z',
        detail: 'applied 2 migrations',
      });
    }).not.toThrow();
  });

  it('rejects a profile with no pinned migrations or non-positive limits', () => {
    expect(() => {
      profile({ migrationFiles: [] });
    }).toThrow();
    expect(() => {
      profile({ maxConcurrentRuns: 0 });
    }).toThrow();
  });

  it('keeps the BYOK credential key out of every deployment record shape', () => {
    const parsed = ByokCredentialSchema.parse({
      schemaVersion: '1',
      refId: 'byok-ref-1',
      tenantId: 'tenant-a',
      provider: 'meta',
      model: 'muse-spark-1.3',
      fingerprint: 'a'.repeat(64),
      status: 'active',
      rotationVersion: 1,
      createdAt: '2026-11-02T00:00:00.000Z',
      rotatedAt: '2026-11-02T00:00:00.000Z',
    });
    expect(JSON.stringify(parsed)).not.toContain('sk-live');
    expect(Object.keys(parsed)).not.toContain('keyMaterial');
  });
});

describe('deployment gate (NEG3-28, NEG3-37)', () => {
  it('admits a profile with a matching qualification', () => {
    expect(() => {
      assertDeploymentQualified(profile(), qualification());
    }).not.toThrow();
  });

  it('blocks when no qualification exists — never installs on a guess', () => {
    expect(() => {
      assertDeploymentQualified(profile(), null);
    }).toThrow(DeploymentBlockedError);
  });

  it('blocks on profile or method mismatch', () => {
    expect(() => {
      assertDeploymentQualified(profile(), qualification({ profileId: 'other-profile' }));
    }).toThrow(/blocked/);
    expect(() => {
      assertDeploymentQualified(profile(), qualification({ method: 'other-method' }));
    }).toThrow(/blocked/);
  });
});

describe('runtime pins (NEG3-37)', () => {
  const runtime = { nodeVersion: '26.12.1', pnpmVersion: '12.5.1', postgresMajor: '16' };

  it('admits an exact runtime match', () => {
    expect(() => {
      assertProfileRuntime(profile(), runtime);
    }).not.toThrow();
  });

  it('blocks when any pinned runtime differs', () => {
    expect(() => {
      assertProfileRuntime(profile(), { ...runtime, nodeVersion: '26.11.0' });
    }).toThrow(/blocked/);
    expect(() => {
      assertProfileRuntime(profile(), { ...runtime, postgresMajor: '15' });
    }).toThrow(/blocked/);
  });
});

describe('artifact digest', () => {
  it('is deterministic 64-hex over profile plus migration bytes', () => {
    const first = computeArtifactDigest('{"profileId":"local-linux"}', ['CREATE TABLE a (id TEXT);']);
    const second = computeArtifactDigest('{"profileId":"local-linux"}', ['CREATE TABLE a (id TEXT);']);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any migration byte changes', () => {
    const first = computeArtifactDigest('{"profileId":"local-linux"}', ['CREATE TABLE a (id TEXT);']);
    const second = computeArtifactDigest('{"profileId":"local-linux"}', ['CREATE TABLE a (id TEXT, x INT);']);
    expect(first).not.toBe(second);
  });
});

describe('operator CLI parsing', () => {
  it('parses install with required flags', () => {
    const parsed = parseSelfHostArgs([
      'install',
      '--profile=p.json',
      '--qualification=q.json',
      '--workdir=w',
      '--migrations=m',
      '--db=d',
    ]);
    expect(parsed).toMatchObject({
      command: 'install',
      profile: 'p.json',
      qualification: 'q.json',
      workdir: 'w',
      db: 'd',
    });
  });

  it('rejects an unknown command instead of guessing', () => {
    expect(() => {
      parseSelfHostArgs(['frobnicate']);
    }).toThrow(/unknown command/);
  });

  it('rejects destructive commands without explicit confirmation', () => {
    expect(() => {
      parseSelfHostArgs([
        'restore',
        '--profile=p.json',
        '--qualification=q.json',
        '--workdir=w',
        '--migrations=m',
        '--backup=b.json',
      ]);
    }).toThrow(/--confirm/);
    expect(() => {
      parseSelfHostArgs(['teardown', '--workdir=w']);
    }).toThrow(/--confirm/);
  });
});
