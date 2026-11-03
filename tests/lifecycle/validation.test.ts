import { describe, expect, it } from 'vitest';

import {
  DraftBodySchema,
  LifecycleSubmitSchema,
  RunEventSchema,
  submitDigestFor,
} from '../../src/core/index.js';

/**
 * WP3-25 / T-28 — lifecycle contract validation (fast, no database).
 *
 * Written before the implementation. Submits carry the draft ref, the
 * independent invariant refs, the expected grant version, and a sha256
 * idempotency key; the submit digest is deterministic over the normalized
 * submit so retries reference the same immutable bytes. Durable behavior is
 * proven natively in tests/native/lifecycle.test.ts.
 */

function submit(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1',
    requestId: 'req-1',
    tenantId: 'tenant-a',
    actorId: 'user-a',
    projectId: 'project-a',
    repositoryIds: ['repo-a'],
    sourceRefs: ['git:abc1234'],
    intentRef: 'intent-1',
    executionMode: 'real_runtime',
    invariantRefs: ['invariant-1'],
    verificationPlanRef: 'plan-1',
    budgetProfileId: 'budget-1',
    publicationConsent: false,
    idempotencyKey: 'a'.repeat(64),
    expectedGrantVersion: 0,
    draftId: 'draft-1',
    draftRevision: 1,
    requestedBudget: 50,
    ...overrides,
  };
}

describe('lifecycle submit contract', () => {
  it('accepts a complete submit', () => {
    const parsed = LifecycleSubmitSchema.parse(submit());

    expect(parsed.draftRevision).toBe(1);
    expect(parsed.invariantRefs).toEqual(['invariant-1']);
  });

  it('rejects submits without invariant refs or repos', () => {
    expect(() => LifecycleSubmitSchema.parse(submit({ invariantRefs: [] }))).toThrow();
    expect(() => LifecycleSubmitSchema.parse(submit({ repositoryIds: [] }))).toThrow();
  });

  it('rejects a non-sha256 idempotency key', () => {
    expect(() => LifecycleSubmitSchema.parse(submit({ idempotencyKey: 'not-a-digest' }))).toThrow();
  });

  it('computes a deterministic submit digest', () => {
    const first = submitDigestFor(LifecycleSubmitSchema.parse(submit()));
    const second = submitDigestFor(LifecycleSubmitSchema.parse(submit()));

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
    const changed = submitDigestFor(LifecycleSubmitSchema.parse(submit({ requestedBudget: 60 })));
    expect(changed).not.toBe(first);
  });
});

describe('draft body and run events', () => {
  it('requires an intent and allows engine refs', () => {
    const body = DraftBodySchema.parse({
      intent: 'Fix the total.',
      environmentRevision: 'envrev-9',
      readinessRef: 'readiness-9',
      profileRef: 'profile-9',
      budgetCap: 50,
    });

    expect(body.intent).toBe('Fix the total.');
    expect(() => DraftBodySchema.parse({})).toThrow();
  });

  it('accepts known event kinds and refuses unknown ones', () => {
    const event = RunEventSchema.parse({
      schemaVersion: '1',
      runId: 'run-1',
      seq: 1,
      kind: 'artifact',
      payload: { digest: 'b'.repeat(64) },
      createdAt: '2026-11-02T00:00:00.000Z',
    });

    expect(event.kind).toBe('artifact');
    expect(() =>
      RunEventSchema.parse({
        schemaVersion: '1',
        runId: 'run-1',
        seq: 2,
        kind: 'teleport',
        payload: {},
        createdAt: '2026-11-02T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
