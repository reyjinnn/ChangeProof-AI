import { describe, expect, it } from 'vitest';

import {
  CleanupReceiptSchema,
  GuestRunner,
  QuarantineError,
  RunnerProfileSchema,
  buildRunnerProfile,
  planGuestRun,
} from '../../src/modules/verifier/index.js';

/**
 * WP3-04 / T1-6 — guest runner negatives (NEG3-10, NEG3-24).
 *
 * Written before the implementation. The runner is the boundary where hostile
 * customer source would run, so the negatives are about what must be *denied*
 * and about what must be *cleaned up*:
 *
 *  - a guest may not mount the Docker socket, receive secrets, or reach the
 *    host network (NEG3-24);
 *  - the oracle is mounted read-only and outside the candidate workspace;
 *  - a run that is cancelled or times out still has to produce a cleanup
 *    receipt, and a failed cleanup quarantines the environment instead of
 *    letting it be reused (NFR3-04, .claude/AGENTS.md §3 rule 8).
 *
 * These are contract-level checks. The native isolation probes live in the
 * runner-security script and are reported separately.
 */
describe('runner profile denies the host and the secrets', () => {
  it('builds a profile that runs as a non-root user with no host socket', () => {
    const profile = buildRunnerProfile({
      runnerProfile: 'node-linux',
      imageDigest: 'sha256:' + 'a'.repeat(64),
      cpuLimit: 2,
      memoryLimitMb: 2048,
      pidsLimit: 128,
      diskLimitMb: 4096,
      networkMode: 'private',
    });

    expect(profile.user).not.toBe('root');
    expect(profile.user).not.toBe('0');
    expect(profile.dockerSocketMounted).toBe(false);
    expect(profile.secretsProvided).toBe(false);
  });

  it('refuses a profile that would mount the Docker socket', () => {
    expect(() =>
      RunnerProfileSchema.parse({
        schemaVersion: '1',
        runnerProfile: 'node-linux',
        imageDigest: 'sha256:' + 'a'.repeat(64),
        user: 'app',
        dockerSocketMounted: true,
        secretsProvided: false,
        networkMode: 'private',
        limits: { cpu: 2, memoryMb: 2048, pids: 128, diskMb: 4096 },
      }),
    ).toThrow(/socket/i);
  });

  it('refuses a profile that would provide secrets to the guest', () => {
    expect(() =>
      RunnerProfileSchema.parse({
        schemaVersion: '1',
        runnerProfile: 'node-linux',
        imageDigest: 'sha256:' + 'a'.repeat(64),
        user: 'app',
        dockerSocketMounted: false,
        secretsProvided: true,
        networkMode: 'private',
        limits: { cpu: 2, memoryMb: 2048, pids: 128, diskMb: 4096 },
      }),
    ).toThrow(/secret/i);
  });

  it('refuses a profile with host networking', () => {
    expect(() =>
      RunnerProfileSchema.parse({
        schemaVersion: '1',
        runnerProfile: 'node-linux',
        imageDigest: 'sha256:' + 'a'.repeat(64),
        user: 'app',
        dockerSocketMounted: false,
        secretsProvided: false,
        networkMode: 'host',
        limits: { cpu: 2, memoryMb: 2048, pids: 128, diskMb: 4096 },
      }),
    ).toThrow(/network/i);
  });

  it('refuses an image that is not pinned by digest', () => {
    expect(() =>
      RunnerProfileSchema.parse({
        schemaVersion: '1',
        runnerProfile: 'node-linux',
        imageDigest: 'node:26-latest',
        user: 'app',
        dockerSocketMounted: false,
        secretsProvided: false,
        networkMode: 'private',
        limits: { cpu: 2, memoryMb: 2048, pids: 128, diskMb: 4096 },
      }),
    ).toThrow(/digest/i);
  });
});

describe('guest run plan keeps the oracle outside the candidate workspace', () => {
  const profile = buildRunnerProfile({
    runnerProfile: 'node-linux',
    imageDigest: 'sha256:' + 'a'.repeat(64),
    cpuLimit: 2,
    memoryLimitMb: 2048,
    pidsLimit: 128,
    diskLimitMb: 4096,
    networkMode: 'private',
  });

  it('mounts the oracle read-only and outside the candidate workspace', () => {
    const plan = planGuestRun({
      profile,
      candidateRoot: '/run/candidate',
      oracleRoot: '/run/oracle',
      checks: ['check-1'],
      timeoutMs: 60_000,
    });

    const oracleMount = plan.mounts.find((mount) => mount.source === '/run/oracle');
    expect(oracleMount?.readOnly).toBe(true);
    expect(oracleMount?.target.startsWith('/run/candidate')).toBe(false);
  });

  it('mounts the candidate workspace read-write, because the check has to run', () => {
    const plan = planGuestRun({
      profile,
      candidateRoot: '/run/candidate',
      oracleRoot: '/run/oracle',
      checks: ['check-1'],
      timeoutMs: 60_000,
    });

    const candidateMount = plan.mounts.find((mount) => mount.source === '/run/candidate');
    expect(candidateMount?.readOnly).toBe(false);
  });

  it('plans a cleanup step for every run, including a cancelled one', () => {
    const plan = planGuestRun({
      profile,
      candidateRoot: '/run/candidate',
      oracleRoot: '/run/oracle',
      checks: ['check-1'],
      timeoutMs: 60_000,
    });

    expect(plan.cleanupRequired).toBe(true);
    expect(plan.cleanup.targets.length).toBeGreaterThan(0);
  });

  it('refuses a run whose oracle is inside the candidate workspace', () => {
    expect(() =>
      planGuestRun({
        profile,
        candidateRoot: '/run/candidate',
        oracleRoot: '/run/candidate/oracle',
        checks: ['check-1'],
        timeoutMs: 60_000,
      }),
    ).toThrow(/oracle/i);
  });
});

describe('cleanup receipt and quarantine', () => {
  it('accepts a receipt that accounts for every cleanup target', () => {
    const receipt = CleanupReceiptSchema.parse({
      schemaVersion: '1',
      runId: 'run-1',
      completedAt: '2026-10-26T10:00:00.000Z',
      targets: [
        { kind: 'container', id: 'container-1', removed: true },
        { kind: 'volume', id: 'volume-1', removed: true },
        { kind: 'network', id: 'network-1', removed: true },
        { kind: 'credential', id: 'cred-1', removed: true },
      ],
      environmentReusable: true,
    });

    expect(receipt.targets.every((target) => target.removed)).toBe(true);
    expect(receipt.environmentReusable).toBe(true);
  });

  it('refuses a receipt that claims reuse while a target survived', () => {
    expect(() =>
      CleanupReceiptSchema.parse({
        schemaVersion: '1',
        runId: 'run-1',
        completedAt: '2026-10-26T10:00:00.000Z',
        targets: [{ kind: 'container', id: 'container-1', removed: false }],
        environmentReusable: true,
      }),
    ).toThrow(/cleanup|reuse/i);
  });

  it('quarantines the environment when cleanup fails', () => {
    const runner = new GuestRunner();

    let caught: unknown;
    try {
      runner.recordCleanup({
        schemaVersion: '1',
        runId: 'run-1',
        completedAt: '2026-10-26T10:00:00.000Z',
        targets: [{ kind: 'container', id: 'container-1', removed: false }],
        environmentReusable: false,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(QuarantineError);
    expect(runner.isQuarantined('run-1')).toBe(true);
  });

  it('does not quarantine a run whose cleanup succeeded', () => {
    const runner = new GuestRunner();

    runner.recordCleanup({
      schemaVersion: '1',
      runId: 'run-2',
      completedAt: '2026-10-26T10:00:00.000Z',
      targets: [{ kind: 'container', id: 'container-1', removed: true }],
      environmentReusable: true,
    });

    expect(runner.isQuarantined('run-2')).toBe(false);
  });

  it('refuses to reuse a quarantined environment', () => {
    const runner = new GuestRunner();

    // A failed cleanup raises and quarantines in one step; the environment is
    // then refused for reuse.
    expect(() => {
      runner.recordCleanup({
        schemaVersion: '1',
        runId: 'run-3',
        completedAt: '2026-10-26T10:00:00.000Z',
        targets: [{ kind: 'volume', id: 'volume-1', removed: false }],
        environmentReusable: false,
      });
    }).toThrow(QuarantineError);

    expect(() => {
      runner.assertReusable('run-3');
    }).toThrow(/quarantin/i);
  });
});
