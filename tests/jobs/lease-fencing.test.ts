import { describe, expect, it } from 'vitest';

import { JobLeaseSchema, type JobLease } from '../../src/core/index.js';
import {
  assertEffectIdUnique,
  assertLeaseWritable,
  isLeaseExpired,
  nextRetryCount,
} from '../../src/modules/jobs/index.js';

/**
 * WP3-23 / T2-7 — lease/fencing/idempotency failure-path tests
 * (NEG3-22, NEG3-23, NEG3-26).
 *
 * Written before the implementation. At-least-once delivery with fencing: a
 * job that loses its lease must not write checkpoints, results, or
 * publications. Stale epochs, version drift, cancellation, and revocation all
 * reject the write; duplicate effect IDs collapse to one logical effect.
 * Durable state and the dispatcher arrive with the full WP — this is the pure
 * decision core with proven `JobLease` inputs.
 */

const NOW = '2026-10-29T02:00:00.000Z';

function lease(overrides: Partial<JobLease> = {}): JobLease {
  return JobLeaseSchema.parse({
    schemaVersion: '1',
    tenantId: 'tenant-a',
    runId: 'run-1',
    jobId: 'job-1',
    imageDigest:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    candidateDigest:
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    planDigest:
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    epoch: 3,
    ownerId: 'worker-1',
    heartbeatAt: '2026-10-29T01:59:00.000Z',
    expiresAt: '2026-10-29T03:00:00.000Z',
    state: 'active',
    retryCount: 0,
    cancelRequested: false,
    version: 7,
    grantVersion: 2,
    ...overrides,
  });
}

describe('fencing epoch and compare-and-swap (NEG3-23)', () => {
  it('rejects a write from a stale epoch after the lease moved on', () => {
    expect(() => { assertLeaseWritable(lease(), { epoch: 2, version: 7, nowIso: NOW, currentGrantVersion: 2 }); },
    ).toThrow(/stale epoch/i);
  });

  it('rejects a write that names a different version than the lease holds', () => {
    expect(() => { assertLeaseWritable(lease(), { epoch: 3, version: 6, nowIso: NOW, currentGrantVersion: 2 }); },
    ).toThrow(/version/i);
  });

  it('accepts a write that carries current authority', () => {
    expect(() => { assertLeaseWritable(lease(), { epoch: 3, version: 7, nowIso: NOW, currentGrantVersion: 2 }); },
    ).not.toThrow();
  });

  it('detects an expired lease instead of treating it as writable', () => {
    expect(isLeaseExpired(lease(), NOW)).toBe(false);
    expect(isLeaseExpired(lease({ expiresAt: '2026-10-29T01:00:00.000Z' }), NOW)).toBe(true);
  });

  it('fails closed on an unreadable timestamp instead of defaulting to fresh', () => {
    expect(() => isLeaseExpired(lease(), 'not-a-time')).toThrow();
  });
});

describe('cancel, revocation and bounded retries (NEG3-26, NEG3-22)', () => {
  it('rejects writes once cancellation was requested (cancel-drain race)', () => {
    expect(() => { assertLeaseWritable(lease({ cancelRequested: true }), {
        epoch: 3,
        version: 7,
        nowIso: NOW,
        currentGrantVersion: 2,
      }); },
    ).toThrow(/cancel/i);
  });

  it('rejects writes from non-active lease states', () => {
    for (const state of ['expired', 'revoked', 'completed'] as const) {
      expect(() => { assertLeaseWritable(lease({ state }), {
          epoch: 3,
          version: 7,
          nowIso: NOW,
          currentGrantVersion: 2,
        }); },
      ).toThrow();
    }
  });

  it('rejects a write whose grant was revoked mid-run', () => {
    expect(() => { assertLeaseWritable(lease(), { epoch: 3, version: 7, nowIso: NOW, currentGrantVersion: 3 }); },
    ).toThrow(/stale|revoked/);
  });

  it('bounds retries instead of looping forever', () => {
    expect(nextRetryCount(0, 3)).toBe(1);
    expect(() => nextRetryCount(3, 3)).toThrow(/retry budget exhausted/i);
  });
});

describe('effect identity deduplication (NEG3-23)', () => {
  const effect = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

  it('accepts the first write of an effect identity', () => {
    expect(() => { assertEffectIdUnique(new Set(), effect); }).not.toThrow();
  });

  it('collapses a duplicate delivery to one logical effect, never a double write', () => {
    expect(() => { assertEffectIdUnique(new Set([effect]), effect); }).toThrow(/duplicate/i);
  });
});
