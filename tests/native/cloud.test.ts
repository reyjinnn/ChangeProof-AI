import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CloudProfileSchema,
  CloudQualificationSchema,
  type CloudProfile,
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
 * WP3-34 / T-39 — cloud lifecycle mechanics on real containers (native).
 *
 * A docker driver executes the full provision → run → upgrade → rollback →
 * snapshot → restore → delete → teardown lifecycle against real local
 * PostgreSQL containers, with image digests read from the actual images
 * and a genuine dump/reload round-trip for restore. Every provider row
 * stays `probe-only`: no live cloud credential is used here, and live
 * AWS/Azure/GCP qualification waits for session-authorized credentials
 * in phase-7 (NEG3-40).
 */

const NOW = new Date().toISOString();
const STACK = `t39-cloud-${String(process.pid)}`;
const PASSWORD = 't39-probe-only';
const IMAGE_OLD = 'postgres:16-alpine';
const IMAGE_NEW = 'postgres:16';

function docker(args: readonly string[]): string {
  return execFileSync('docker', [...args], { encoding: 'utf8', timeout: 120_000 }).trim();
}

function imageId(image: string): string {
  const id = docker(['inspect', image, '--format', '{{.Id}}']);
  if (!id.startsWith('sha256:')) {
    throw new Error(`Image ${image} has no sha256 id; refusing.`);
  }
  return id;
}

function waitReady(stack: string): void {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      docker(['exec', stack, 'pg_isready', '-U', 'postgres']);
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`Stack ${stack} never became ready.`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }
}

function removeStack(stack: string): void {
  try {
    docker(['rm', '-f', stack]);
  } catch {
    // Already gone; teardown asserts absence separately.
  }
}

function stackExists(stack: string): boolean {
  try {
    docker(['inspect', stack]);
    return true;
  } catch {
    return false;
  }
}

function localDriver(workdir: string, oldId: string, newId: string): CloudDriver {
  const dumpPath = join(workdir, 'snapshot.sql');
  return {
    execute: (step, input): CloudDriverStep => {
      const stack = input.stackId ?? STACK;
      switch (step) {
        case 'provision': {
          removeStack(stack);
          docker(['run', '-d', '--name', stack, '-e', `POSTGRES_PASSWORD=${PASSWORD}`, IMAGE_OLD]);
          waitReady(stack);
          docker(['exec', stack, 'psql', '-U', 'postgres', '-c', 'CREATE TABLE marker (id INTEGER PRIMARY KEY); INSERT INTO marker VALUES (7);']);
          return { externalId: stack, observed: { imageDigest: oldId }, detail: 'provisioned local postgres' };
        }
        case 'run': {
          docker(['exec', stack, 'pg_isready', '-U', 'postgres']);
          const running = docker(['inspect', stack, '--format', '{{.Image}}']);
          return { externalId: stack, observed: { imageDigest: running }, detail: 'health check passed' };
        }
        case 'upgrade': {
          const target = input.targetImage ?? newId;
          removeStack(stack);
          docker(['run', '-d', '--name', stack, '-e', `POSTGRES_PASSWORD=${PASSWORD}`, IMAGE_NEW]);
          waitReady(stack);
          const running = docker(['inspect', stack, '--format', '{{.Image}}']);
          if (running !== target) {
            throw new Error(`Upgraded image ${running} does not match target ${target}.`);
          }
          return { externalId: stack, observed: { imageDigest: running }, detail: 'upgraded image' };
        }
        case 'rollback': {
          removeStack(stack);
          docker(['run', '-d', '--name', stack, '-e', `POSTGRES_PASSWORD=${PASSWORD}`, IMAGE_OLD]);
          waitReady(stack);
          const running = docker(['inspect', stack, '--format', '{{.Image}}']);
          return { externalId: stack, observed: { imageDigest: running }, detail: 'rolled back image' };
        }
        case 'snapshot': {
          docker(['exec', stack, 'psql', '-U', 'postgres', '-c', 'CREATE TABLE IF NOT EXISTS marker (id INTEGER PRIMARY KEY); DELETE FROM marker; INSERT INTO marker VALUES (7);']);
          const dump = docker(['exec', stack, 'pg_dumpall', '-U', 'postgres']);
          writeFileSync(dumpPath, dump, 'utf8');
          const snapshotId = createHash('sha256').update(dump, 'utf8').digest('hex');
          const running = docker(['inspect', stack, '--format', '{{.Image}}']);
          return { externalId: stack, observed: { snapshotId, imageDigest: running }, detail: 'snapshot dumped' };
        }
        case 'restore': {
          if (!existsSync(dumpPath)) {
            throw new Error('Snapshot file is missing; refusing a restore from nothing.');
          }
          docker(['exec', stack, 'psql', '-U', 'postgres', '-c', 'DROP TABLE IF EXISTS marker;']);
          docker(['cp', dumpPath, `${stack}:/tmp/snapshot.sql`]);
          docker(['exec', stack, 'psql', '-U', 'postgres', '-f', '/tmp/snapshot.sql']);
          const count = docker(['exec', stack, 'psql', '-U', 'postgres', '-tA', '-c', 'SELECT COUNT(*) FROM marker;']);
          if (count !== '1') {
            throw new Error(`Restore reloaded ${count} marker rows, expected 1.`);
          }
          const dump = readFileSync(dumpPath, 'utf8');
          const snapshotId = createHash('sha256').update(dump, 'utf8').digest('hex');
          const running = docker(['inspect', stack, '--format', '{{.Image}}']);
          return { externalId: stack, observed: { snapshotId, imageDigest: running }, detail: 'snapshot restored' };
        }
        case 'delete':
        case 'teardown': {
          removeStack(stack);
          if (stackExists(stack)) {
            throw new Error(`Stack ${stack} still exists after ${step}.`);
          }
          return { externalId: stack, observed: {}, detail: `${step} removed the stack` };
        }
      }
    },
  };
}

describe('native cloud lifecycle on real containers', () => {
  const workdir = mkdtempSync(join(tmpdir(), 't39-native-'));

  afterAll(() => {
    removeStack(STACK);
    rmSync(workdir, { recursive: true, force: true });
    expect(stackExists(STACK)).toBe(false);
  });

  it('provisions, upgrades, rolls back, restores, and tears down for real', async () => {
    expect(process.env['AWS_ACCESS_KEY_ID']).toBeUndefined();
    expect(process.env['AZURE_CLIENT_SECRET']).toBeUndefined();
    expect(process.env['GOOGLE_APPLICATION_CREDENTIALS']).toBeUndefined();

    const oldId = imageId(IMAGE_OLD);
    const newId = imageId(IMAGE_NEW);
    const profile: CloudProfile = CloudProfileSchema.parse({
      schemaVersion: '1',
      profileId: 'aws-ecs-fargate-1',
      provider: 'aws',
      region: 'eu-central-1',
      computeType: 'ecs-fargate',
      imageDigest: oldId,
      nodePin: '26.12.1',
      pnpmPin: '12.5.1',
      postgresPin: '16',
      secretBroker: { kind: 'broker', refPrefix: 'changeproof/aws-1/' },
      maxConcurrentRuns: 4,
      diskGb: 20,
      qualificationMethod: 'qual-cloud-1',
    });
    const qualification = CloudQualificationSchema.parse({
      schemaVersion: '1',
      profileId: 'aws-ecs-fargate-1',
      method: 'qual-cloud-1',
      receiptRefs: ['native-probe'],
      qualifiedAt: NOW,
    });
    const args = { profile, qualification, driver: localDriver(workdir, oldId, newId), workdir, nowIso: NOW };

    const provisioned = await provisionCloud(args);
    expect(provisioned.success).toBe(true);
    await expect(runCloudHealth(args)).resolves.toMatchObject({ success: true });
    await expect(upgradeCloud({ ...args, targetImage: newId })).resolves.toMatchObject({ success: true });
    await expect(rollbackCloud(args)).resolves.toMatchObject({ success: true });
    await expect(snapshotCloud(args)).resolves.toMatchObject({ success: true });
    await expect(restoreCloud(args)).resolves.toMatchObject({ success: true });
    await expect(deleteCloudStack(args)).resolves.toMatchObject({ success: true });
    await expect(teardownCloudStack({ ...args, confirm: 'aws-ecs-fargate-1' })).resolves.toMatchObject({
      success: true,
    });
    expect(stackExists(STACK)).toBe(false);
    expect(existsSync(join(workdir, 'cloud-state.json'))).toBe(false);
  }, 240_000);
});
