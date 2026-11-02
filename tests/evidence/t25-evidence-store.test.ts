import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { SubjectRef, TargetAssessment } from '../../src/core/index.js';
import { SubjectRefSchema, TargetAssessmentSchema } from '../../src/core/index.js';
import {
  assembleBundleManifest,
  createFileEvidenceStore,
  createMemoryEvidenceStore,
  redactSecrets,
  renderCanonical,
  sha256Hex,
  verifyBundleManifest,
} from '../../src/modules/evidence/index.js';

function subject(kind: 'producer' | 'worker', id: string, repository: string): SubjectRef {
  return SubjectRefSchema.parse({ kind, id, repository });
}

const api = subject('producer', 'checkout-api', 'shop-api');
const worker = subject('worker', 'order-worker', 'shop-worker');

function assessment(target: SubjectRef, outcome: TargetAssessment['outcome']): TargetAssessment {
  return TargetAssessmentSchema.parse({
    schemaVersion: '1',
    subject: target,
    outcome,
    proofScope: { targets: [target], edges: [], invariants: ['contract-holds'], unsupportedSurfaces: [] },
    policyVersion: '1',
    reasons: [],
    evidenceRefs: [`ev-${target.id}`],
  });
}

function digestOf(tag: string): string {
  return tag.repeat(64).slice(0, 64);
}

function manifestInput() {
  return {
    policyVersion: '1',
    candidateBundleDigest: digestOf('b'),
    state: 'verified' as const,
    targetOutcomes: [assessment(api, 'fixed'), assessment(worker, 'fixed')],
    bindings: [
      { subject: api, candidate: digestOf('a'), verified: digestOf('a') },
      { subject: worker, candidate: digestOf('e'), verified: digestOf('e') },
    ],
    edges: [{ from: api, to: worker, status: 'proven' as const, checkRef: 'chk-edge' }],
    invariants: [{ ref: 'inv-effect-once', holds: true, checkRef: 'chk-effect-once' }],
    mixedVersion: {
      requiredPairs: ['api-v2+worker-v1'],
      coveredPairs: ['api-v2+worker-v1'],
      allCampaignsComplete: true,
    },
    intentFulfilled: true,
    runRef: 'run-t25',
  };
}

describe('renderCanonical + sha256Hex (WP3-12)', () => {
  it('renders key order deterministically with pinned golden bytes', () => {
    const a = renderCanonical({ b: 2, a: [3, { z: 1, y: 2 }] });
    const b = renderCanonical({ a: [3, { y: 2, z: 1 }], b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":[3,{"y":2,"z":1}],"b":2}');
    expect(sha256Hex(a)).toBe('c28bb65d84d1fc45a546cd6bff0d51cf480141ee174d521b9904e94e016d6d62');
  });

  it('refuses non-JSON evidence values instead of silently mangling them', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => renderCanonical(circular)).toThrow();
    expect(() => renderCanonical({ fn: () => 1 })).toThrow();
    expect(() => renderCanonical({ big: 10n })).toThrow();
  });
});

describe('redactSecrets (WP3-12, secret-serialization)', () => {
  it('redacts credential-bearing keys at any depth and keeps the rest', () => {
    const input = {
      github_token: 'ghp-live',
      nested: { apiKey: 'x', attempts: 3 },
      list: [{ password: 'pw', ok: true }],
      author: 'rina',
    };
    const out = redactSecrets(input) as Record<string, unknown>;
    expect(out['github_token']).toBe('[redacted]');
    expect((out['nested'] as Record<string, unknown>)['apiKey']).toBe('[redacted]');
    expect(((out['list'] as unknown[])[0] as Record<string, unknown>)['password']).toBe('[redacted]');
    expect((out['nested'] as Record<string, unknown>)['attempts']).toBe(3);
    expect(out['author']).toBe('rina');
  });

  it('matches credential names case-insensitively', () => {
    const out = redactSecrets({ AUTHORIZATION: 'bearer x', Connection_String: 'y' }) as Record<string, unknown>;
    expect(out['AUTHORIZATION']).toBe('[redacted]');
    expect(out['Connection_String']).toBe('[redacted]');
  });
});

describe.each([
  ['memory', () => createMemoryEvidenceStore()],
  ['file', () => createFileEvidenceStore(mkdtempSync(join(tmpdir(), 'cp-ev-')))],
])('%s evidence store (WP3-12)', (_name, make) => {
  it('round-trips bytes under a stable content digest', () => {
    const store = make();
    const first = store.put('hello evidence');
    const second = store.put('hello evidence');
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(store.get(first.digest)).toString('utf8')).toBe('hello evidence');
    expect(store.has(first.digest)).toBe(true);
    expect(store.has(digestOf('0'))).toBe(false);
  });

  it('fails closed on missing or malformed digests', () => {
    const store = make();
    expect(() => store.get(digestOf('0'))).toThrow(/not found|missing|unknown/i);
    expect(() => store.get('not-a-digest')).toThrow();
    expect(() => store.get('../escape')).toThrow();
  });

  it('exposes no enumeration surface', () => {
    expect((make() as unknown as Record<string, unknown>)['list']).toBeUndefined();
  });
});

describe('file evidence store integrity (WP3-12)', () => {
  it('detects tampered bytes on read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-ev-tamper-'));
    try {
      const store = createFileEvidenceStore(dir);
      const { digest } = store.put('original bytes');
      writeFileSync(join(dir, digest), 'tampered bytes');
      expect(() => store.get(digest)).toThrow(/integrity|tamper|mismatch/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives a store reopen from the same directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-ev-reopen-'));
    try {
      const first = createFileEvidenceStore(dir);
      const { digest } = first.put('durable bytes');
      const second = createFileEvidenceStore(dir);
      expect(Buffer.from(second.get(digest)).toString('utf8')).toBe('durable bytes');
      expect(readFileSync(join(dir, digest), 'utf8')).toBe('durable bytes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bundle manifest (WP3-12)', () => {
  it('assembles a stable digest and verifies after a store round-trip', () => {
    const store = createMemoryEvidenceStore();
    const first = assembleBundleManifest(manifestInput());
    const second = assembleBundleManifest(manifestInput());
    expect(first.digest).toBe(second.digest);
    store.put(first.bytes);
    const verified = verifyBundleManifest(store, first.digest);
    expect(verified.digest).toBe(first.digest);
    expect(verified.manifest.candidateBundleDigest).toBe(digestOf('b'));
    expect(verified.manifest.state).toBe('verified');
    expect(verified.manifest.targetOutcomes).toHaveLength(2);
  });

  it('covers non-verified terminal states as diagnosis evidence', () => {
    const manifest = assembleBundleManifest({ ...manifestInput(), state: 'blocked' });
    const store = createMemoryEvidenceStore();
    store.put(manifest.bytes);
    expect(verifyBundleManifest(store, manifest.digest).manifest.state).toBe('blocked');
  });

  it('rejects a manifest whose bytes do not match its digest (NEG3-14 shape)', () => {
    const store = createMemoryEvidenceStore();
    const manifest = assembleBundleManifest(manifestInput());
    const tampered = Buffer.from(manifest.bytes).toString('utf8').replace('verified', 'failedxx');
    const { digest } = store.put(tampered);
    expect(digest).not.toBe(manifest.digest);
    expect(() => verifyBundleManifest(store, manifest.digest)).toThrow();
  });

  it('redacts credential-bearing annotations before bytes are fixed', () => {
    const manifest = assembleBundleManifest({
      ...manifestInput(),
      annotations: { runbook: 'https://wiki/run', deploy_token: 'live-value' },
    });
    const text = Buffer.from(manifest.bytes).toString('utf8');
    expect(text).not.toContain('live-value');
    expect(text).toContain('[redacted]');
    expect(text).toContain('https://wiki/run');
  });

  it('fails closed on malformed manifest input', () => {
    expect(() => assembleBundleManifest({ ...manifestInput(), candidateBundleDigest: 'nope' })).toThrow();
    expect(() => assembleBundleManifest({ ...manifestInput(), runRef: '' })).toThrow();
  });
});
