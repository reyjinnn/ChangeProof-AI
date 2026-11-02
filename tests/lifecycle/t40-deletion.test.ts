import { describe, expect, it } from 'vitest';

import { assertNotFenced, applyTombstonesOnRestore, assertPurgeDue } from '../../src/modules/lifecycle/deletion.js';

/**
 * WP3-26 / T-40 — deletion fence and tombstone tests (NEG3-27).
 *
 * Written before the durable wiring. A fenced scope accepts no new effects;
 * restore replays tombstones before serving traffic so deleted subjects stay
 * deleted without touching other tenants; purge waits for the retention
 * deadline.
 */

describe('fences refuse new effects in the deleted scope', () => {
  it('blocks fenced tenants and scopes only', () => {
    const fences = [{ tenantId: 'leaving', scope: 'runs' }];
    expect(() => {
      assertNotFenced(fences, 'leaving', 'runs');
    }).toThrow(/fenced/i);
    expect(() => {
      assertNotFenced(fences, 'leaving', 'artifacts');
    }).not.toThrow();
    expect(() => {
      assertNotFenced(fences, 'staying', 'runs');
    }).not.toThrow();
  });
});

describe('restore replays tombstones before serving traffic', () => {
  it('keeps deleted subjects deleted and no one else', () => {
    const backup = [
      { tenantId: 'a', subjectKind: 'artifact', subjectId: 'keep-1' },
      { tenantId: 'a', subjectKind: 'artifact', subjectId: 'gone-1' },
      { tenantId: 'b', subjectKind: 'artifact', subjectId: 'gone-1' },
    ];
    const survivors = applyTombstonesOnRestore(backup, [
      { tenantId: 'a', subjectKind: 'artifact', subjectId: 'gone-1' },
    ]);
    expect(survivors).toEqual([
      { tenantId: 'a', subjectKind: 'artifact', subjectId: 'keep-1' },
      { tenantId: 'b', subjectKind: 'artifact', subjectId: 'gone-1' },
    ]);
  });

  it('purges only after the retention deadline', () => {
    expect(() => {
      assertPurgeDue('2026-12-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z');
    }).toThrow(/retention|deadline/i);
    expect(() => {
      assertPurgeDue('2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z');
    }).not.toThrow();
    expect(() => {
      assertPurgeDue('not-a-time', '2026-11-02T00:00:00.000Z');
    }).toThrow(/unreadable/i);
  });
});
