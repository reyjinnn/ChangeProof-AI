import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CloudProfileSchema,
  CloudQualificationSchema,
  DeploymentBlockedError,
  type CloudProfile,
  type CloudQualification,
} from '../../src/core/index.js';
import {
  deleteCloudStack,
  provisionCloud,
  restoreCloud,
  rollbackCloud,
  runCloudHealth,
  snapshotCloud,
  teardownCloudStack,
  upgradeCloud,
  type CloudDriver,
  type CloudDriverStep,
} from '../../src/modules/distribution/index.js';

/**
 * WP3-34 / T-39 — cloud deployment automation failure-path tests
 * (NEG3-37, NEG3-40).
 *
 * Written before the implementation. An unqualified profile is `blocked`;
 * every step executes through an injected driver and drift-checks observed
 * reality against the pinned profile — config rendering alone never yields
 * a success receipt. Steps refuse out of order, destructive teardown needs
 * explicit confirmation, and secrets never appear in profiles or receipts.
 */

const NOW = '2026-11-02T00:00:00.000Z';
const IMAGE = 'sha256:' + 'a'.repeat(64);
const IMAGE_NEXT = 'sha256:' + 'b'.repeat(64);

function profile(overrides: Partial<CloudProfile> = {}): CloudProfile {
  return CloudProfileSchema.parse({
    schemaVersion: '1',
    profileId: 'aws-ecs-fargate-1',
    provider: 'aws',
    region: 'eu-central-1',
    computeType: 'ecs-fargate',
    imageDigest: IMAGE,
    nodePin: '26.12.1',
    pnpmPin: '12.5.1',
    postgresPin: '16',
    secretBroker: { kind: 'broker', refPrefix: 'changeproof/aws-1/' },
    maxConcurrentRuns: 4,
    diskGb: 20,
    qualificationMethod: 'qual-cloud-1',
    ...overrides,
  });
}

function qualification(overrides: Partial<CloudQualification> = {}): CloudQualification {
  return CloudQualificationSchema.parse({
    schemaVersion: '1',
    profileId: 'aws-ecs-fargate-1',
    method: 'qual-cloud-1',
    receiptRefs: ['receipt-provision-1'],
    qualifiedAt: NOW,
    ...overrides,
  });
}

function driver(overrides: Partial<Record<string, (input: { stackId?: string }) => CloudDriverStep>> = {}): CloudDriver {
  const ok = (externalId: string, observed: Record<string, string> = {}): CloudDriverStep => ({
    externalId,
    observed,
    detail: 'fake driver step',
  });
  return {
    execute: (step, input) => {
      const custom = overrides[step];
      if (custom !== undefined) {
        return custom(input);
      }
      switch (step) {
        case 'provision':
          return ok('stack-1', { imageDigest: IMAGE });
        case 'run':
          return ok(input.stackId ?? 'missing', { imageDigest: IMAGE });
        case 'upgrade':
          return ok(input.stackId ?? 'missing', { imageDigest: IMAGE_NEXT });
        case 'rollback':
          return ok(input.stackId ?? 'missing', { imageDigest: IMAGE });
        case 'snapshot':
          return ok('snap-1', { snapshotId: 'snap-1', imageDigest: IMAGE });
        case 'restore':
          return ok(input.stackId ?? 'missing', { snapshotId: 'snap-1', imageDigest: IMAGE });
        case 'delete':
          return ok(input.stackId ?? 'missing', {});
        case 'teardown':
          return ok(input.stackId ?? 'missing', {});
      }
    },
  };
}

let workdirs: string[] = [];
function workdir(): string {
  const dir = mkdtempSync(join(tmpdir(), 't39-cloud-'));
  workdirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of workdirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  workdirs = [];
});

describe('unqualified profiles are blocked', () => {
  it('refuses provision without a matching qualification', async () => {
    await expect(provisionCloud({ profile: profile(), qualification: null, driver: driver(), workdir: workdir(), nowIso: NOW })).rejects.toThrow(
      DeploymentBlockedError,
    );
    await expect(
      provisionCloud({ profile: profile(), qualification: qualification({ method: 'other' }), driver: driver(), workdir: workdir(), nowIso: NOW }),
    ).rejects.toThrow(DeploymentBlockedError);
  });

  it('refuses steps out of order', async () => {
    const dir = workdir();
    await expect(runCloudHealth({ profile: profile(), qualification: qualification(), driver: driver(), workdir: dir, nowIso: NOW })).rejects.toThrow(
      /provision|no stack/i,
    );
  });
});

describe('observed reality must match the pinned profile', () => {
  it('runs the full lifecycle only when every observation matches', async () => {
    const dir = workdir();
    const args = { profile: profile(), qualification: qualification(), driver: driver(), workdir: dir, nowIso: NOW };
    const provisioned = await provisionCloud(args);
    expect(provisioned.success).toBe(true);
    expect(provisioned.externalId).toBe('stack-1');
    await expect(runCloudHealth(args)).resolves.toMatchObject({ success: true });
    await expect(upgradeCloud({ ...args, targetImage: IMAGE_NEXT })).resolves.toMatchObject({ success: true });
    await expect(rollbackCloud(args)).resolves.toMatchObject({ success: true });
    await expect(snapshotCloud(args)).resolves.toMatchObject({ success: true });
    await expect(restoreCloud(args)).resolves.toMatchObject({ success: true });
    await expect(deleteCloudStack(args)).resolves.toMatchObject({ success: true });
    const files = readdirSync(join(dir, 'receipts'));
    expect(files.length).toBe(7);
  });

  it('blocks on drift and records a failure receipt', async () => {
    const dir = workdir();
    const args = { profile: profile(), qualification: qualification(), driver: driver(), workdir: dir, nowIso: NOW };
    await provisionCloud(args);
    const drifted = driver({ run: () => ({ externalId: 'stack-1', observed: { imageDigest: 'sha256:' + 'f'.repeat(64) }, detail: 'drift' }) });
    await expect(runCloudHealth({ ...args, driver: drifted })).rejects.toThrow(/drift/i);
    const files = readdirSync(join(dir, 'receipts'));
    expect(files.length).toBe(2);
  });

  it('refuses teardown without explicit confirmation', async () => {
    const dir = workdir();
    const args = { profile: profile(), qualification: qualification(), driver: driver(), workdir: dir, nowIso: NOW };
    await provisionCloud(args);
    await expect(teardownCloudStack({ ...args, confirm: 'wrong' })).rejects.toThrow(/confirm/i);
    await expect(teardownCloudStack({ ...args, confirm: 'aws-ecs-fargate-1' })).resolves.toMatchObject({ success: true });
  });
});

describe('secrets never enter profiles or receipts', () => {
  it('rejects smuggled secret material in strict profiles', () => {
    expect(() =>
      CloudProfileSchema.parse({
        schemaVersion: '1',
        profileId: 'aws-1',
        provider: 'aws',
        region: 'eu-central-1',
        computeType: 'ecs-fargate',
        imageDigest: IMAGE,
        nodePin: '26.12.1',
        pnpmPin: '12.5.1',
        postgresPin: '16',
        secretBroker: { kind: 'broker', refPrefix: 'changeproof/aws-1/' },
        maxConcurrentRuns: 4,
        diskGb: 20,
        qualificationMethod: 'qual-cloud-1',
        accessKey: 'AKIA-SMUGGLED-CANARY',
      }),
    ).toThrow();
  });
});
