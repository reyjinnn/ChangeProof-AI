import { describe, expect, it } from 'vitest';

import type { JobLease, RepositoryConnection } from '../../src/core/index.js';
import { SubjectRefSchema, TargetAssessmentSchema, subjectKey } from '../../src/core/index.js';
import type { SubjectRef, TargetAssessment } from '../../src/core/index.js';
import { assembleBundleManifest, createMemoryEvidenceStore } from '../../src/modules/evidence/index.js';
import type { EvidenceStore } from '../../src/modules/evidence/index.js';
import type { GitHubClient, InstallationGrantCheck, PullRequestRef } from '../../src/modules/github/index.js';
import type { WriteAuthority } from '../../src/modules/jobs/index.js';
import { coordinateBundle } from '../../src/orchestrator/bundle.js';
import type { CoordinatedBundle } from '../../src/orchestrator/bundle.js';
import type { PublishBundleInput } from '../../src/orchestrator/publication.js';
import { publishBundleEvidence } from '../../src/orchestrator/publication.js';

const POLICY_VERSION = '1';
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'd'.repeat(40);

function subject(kind: 'producer' | 'worker', id: string, repository: string): SubjectRef {
  return SubjectRefSchema.parse({ kind, id, repository });
}

const api = subject('producer', 'checkout-api', 'shop-api');
const worker = subject('worker', 'order-worker', 'shop-worker');

function assessment(target: SubjectRef): TargetAssessment {
  return TargetAssessmentSchema.parse({
    schemaVersion: '1',
    subject: target,
    outcome: 'fixed',
    proofScope: { targets: [target], edges: [], invariants: ['contract-holds'], unsupportedSurfaces: [] },
    policyVersion: POLICY_VERSION,
    reasons: [],
    evidenceRefs: [`ev-${target.id}`],
  });
}

function hex(tag: string): string {
  return tag.repeat(64).slice(0, 64);
}

function verifiedBundle(): CoordinatedBundle {
  return coordinateBundle({
    candidateBundleDigest: hex('b'),
    requiredTargets: [api, worker],
    targetOutcomes: [assessment(api), assessment(worker)],
    targetDigests: {
      [subjectKey(api)]: { candidate: hex('a'), verified: hex('a') },
      [subjectKey(worker)]: { candidate: hex('e'), verified: hex('e') },
    },
    edges: [{ from: api, to: worker, status: 'proven', checkRef: 'chk-edge' }],
    invariants: [{ ref: 'inv-effect-once', holds: true, checkRef: 'chk-effect-once' }],
    mixedVersion: { requiredPairs: ['api-v2+worker-v1'], coveredPairs: ['api-v2+worker-v1'], allCampaignsComplete: true },
    intentFulfilled: true,
    guardAllowed: true,
    policyVersion: POLICY_VERSION,
  });
}

function blockedBundle(): CoordinatedBundle {
  const bundle = verifiedBundle();
  return coordinateBundle({
    candidateBundleDigest: hex('b'),
    requiredTargets: [api, worker],
    targetOutcomes: [...bundle.facts.targetOutcomes],
    targetDigests: {
      [subjectKey(api)]: { candidate: hex('a'), verified: hex('a') },
      [subjectKey(worker)]: { candidate: hex('e'), verified: hex('e') },
    },
    edges: [{ from: api, to: worker, status: 'unresolved', checkRef: 'chk-edge' }],
    invariants: [{ ref: 'inv-effect-once', holds: true, checkRef: 'chk-effect-once' }],
    mixedVersion: { requiredPairs: ['api-v2+worker-v1'], coveredPairs: ['api-v2+worker-v1'], allCampaignsComplete: true },
    intentFulfilled: true,
    guardAllowed: true,
    policyVersion: POLICY_VERSION,
  });
}

function storedManifest(store: EvidenceStore): { digest: string } {
  const manifest = assembleBundleManifest({
    policyVersion: POLICY_VERSION,
    candidateBundleDigest: hex('b'),
    state: 'verified',
    targetOutcomes: [assessment(api), assessment(worker)],
    bindings: [
      { subject: api, candidate: hex('a'), verified: hex('a') },
      { subject: worker, candidate: hex('e'), verified: hex('e') },
    ],
    edges: [{ from: api, to: worker, status: 'proven', checkRef: 'chk-edge' }],
    invariants: [{ ref: 'inv-effect-once', holds: true, checkRef: 'chk-effect-once' }],
    mixedVersion: { requiredPairs: ['api-v2+worker-v1'], coveredPairs: ['api-v2+worker-v1'], allCampaignsComplete: true },
    intentFulfilled: true,
    runRef: 'run-t25',
  });
  store.put(manifest.bytes);
  return { digest: manifest.digest };
}

function lease(overrides: Partial<JobLease> = {}): JobLease {
  return {
    schemaVersion: '1',
    tenantId: 'tenant-a',
    runId: 'run-t25',
    jobId: 'job-publish',
    imageDigest: hex('f'),
    candidateDigest: hex('b'),
    planDigest: hex('c'),
    epoch: 4,
    ownerId: 'worker-1',
    heartbeatAt: '2026-11-01T04:00:00.000Z',
    expiresAt: '2026-11-01T06:00:00.000Z',
    state: 'active',
    retryCount: 0,
    cancelRequested: false,
    version: 9,
    grantVersion: 3,
    ...overrides,
  };
}

function authority(overrides: Partial<WriteAuthority> = {}): WriteAuthority {
  return { epoch: 4, version: 9, nowIso: '2026-11-01T05:00:00.000Z', currentGrantVersion: 3, ...overrides };
}

function connection(overrides: Partial<RepositoryConnection> = {}): RepositoryConnection {
  return {
    schemaVersion: '1',
    connectionId: 'conn-1',
    tenantId: 'tenant-a',
    installationId: 'install-1',
    provider: 'github',
    repositoryAllowlist: ['repo-1'],
    permissionMatrix: { contents: true, pull_requests: true },
    status: 'active',
    revocationVersion: 3,
    credentialRef: 'cred-github-install-1',
    ...overrides,
  };
}

const grantCheck: InstallationGrantCheck = { revocationVersion: 3, repositoryIds: ['repo-1'] };

function fakeGithub(behavior: {
  head?: string;
  pr?: PullRequestRef | null;
  openError?: Error;
  findError?: Error;
  calls?: string[];
}): GitHubClient {
  const pr: PullRequestRef = behavior.pr ?? {
    number: 7,
    url: 'https://github.com/acme/orders/pull/7',
    headSha: SHA,
    state: 'open',
  };
  return {
    fetchCommit: () => Promise.resolve({ sha: SHA, message: 'x', committedAt: '2026-10-31T00:00:00.000Z' }),
    listInstallationRepositories: () => Promise.resolve([]),
    fetchBranchHead: (input) => {
      behavior.calls?.push(`head:${input.branch}`);
      return Promise.resolve({ sha: behavior.head ?? SHA });
    },
    openPullRequest: (input) => {
      behavior.calls?.push(`open:${input.head}`);
      if (behavior.openError !== undefined) return Promise.reject(behavior.openError);
      return Promise.resolve(pr);
    },
    findPullRequestByHead: (input) => {
      behavior.calls?.push(`find:${input.head}`);
      if (behavior.findError !== undefined) return Promise.reject(behavior.findError);
      return Promise.resolve(behavior.pr ?? null);
    },
  };
}

function publishInput(overrides: Partial<PublishBundleInput> = {}): PublishBundleInput {
  const evidence = createMemoryEvidenceStore();
  const { digest } = storedManifest(evidence);
  return {
    bundle: verifiedBundle(),
    manifestDigest: digest,
    evidence,
    runRef: 'run-t25',
    lease: lease(),
    authority: authority(),
    seenEffectIds: new Set<string>(),
    connection: connection(),
    grantCheck,
    repository: { id: 'repo-1', owner: 'acme', repo: 'orders' },
    target: { base: 'main', expectedHeadSha: SHA },
    github: fakeGithub({}),
    ...overrides,
  };
}

describe('publishBundleEvidence (WP3-12)', () => {
  it('publishes a verified bundle with a stable idempotency key', async () => {
    const calls: string[] = [];
    const seenEffectIds = new Set<string>();
    const first = await publishBundleEvidence(
      publishInput({ seenEffectIds, github: fakeGithub({ calls }) }),
    );
    expect(first.status).toBe('published');
    if (first.status !== 'published') throw new Error('unreachable');
    expect(first.pr.number).toBe(7);
    expect(first.reconciled).toBe(false);
    expect(first.branch).toMatch(/^changeproof\/ev-[0-9a-f]{12}$/);
    expect(first.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(seenEffectIds.size).toBe(1);

    const second = await publishBundleEvidence(
      publishInput({ github: fakeGithub({}), seenEffectIds: new Set<string>() }),
    );
    if (second.status !== 'published') throw new Error('unreachable');
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.branch).toBe(first.branch);
  });

  it('withholds publication for a non-verified bundle', async () => {
    await expect(publishBundleEvidence(publishInput({ bundle: blockedBundle() }))).rejects.toThrow(
      /blocked/,
    );
  });

  it('NEG3-14: holds publication when evidence is inaccessible and names the digest', async () => {
    await expect(
      publishBundleEvidence(publishInput({ manifestDigest: hex('0') })),
    ).rejects.toThrow(new RegExp(hex('0')));
  });

  it('withholds when the manifest binds a different run or bundle', async () => {
    await expect(publishBundleEvidence(publishInput({ runRef: 'run-other' }))).rejects.toThrow(
      /run/i,
    );
    const evidence = createMemoryEvidenceStore();
    const foreign = assembleBundleManifest({
      policyVersion: POLICY_VERSION,
      candidateBundleDigest: hex('9'),
      state: 'verified',
      targetOutcomes: [assessment(api), assessment(worker)],
      bindings: [{ subject: api, candidate: hex('a'), verified: hex('a') }],
      edges: [],
      invariants: [],
      mixedVersion: { requiredPairs: [], coveredPairs: [], allCampaignsComplete: true },
      intentFulfilled: true,
      runRef: 'run-t25',
    });
    evidence.put(foreign.bytes);
    await expect(
      publishBundleEvidence(publishInput({ evidence, manifestDigest: foreign.digest })),
    ).rejects.toThrow(/bind|match|digest/i);
  });

  it('NEG3-23: denies a fenced worker with a stale or expired lease', async () => {
    const calls: string[] = [];
    await expect(
      publishBundleEvidence(
        publishInput({ authority: authority({ epoch: 2 }), github: fakeGithub({ calls }) }),
      ),
    ).rejects.toThrow(/stale|epoch/i);
    await expect(
      publishBundleEvidence(publishInput({ lease: lease({ expiresAt: '2026-11-01T01:00:00.000Z' }) })),
    ).rejects.toThrow(/expired/i);
    expect(calls).toEqual([]);
  });

  it('NEG3-23: a duplicate delivery returns the existing PR without opening a second', async () => {
    const calls: string[] = [];
    const seenEffectIds = new Set<string>();
    const input = publishInput({ seenEffectIds, github: fakeGithub({ calls }) });
    const first = await publishBundleEvidence(input);
    if (first.status !== 'published') throw new Error('unreachable');
    const key = first.idempotencyKey;

    const retryCalls: string[] = [];
    const existing: PullRequestRef = { number: 7, url: first.pr.url, headSha: SHA, state: 'open' };
    const retry = await publishBundleEvidence(
      publishInput({ seenEffectIds, github: fakeGithub({ calls: retryCalls, pr: existing }) }),
    );
    expect(retry.status).toBe('already_published');
    if (retry.status !== 'already_published') throw new Error('unreachable');
    expect(retry.pr.number).toBe(7);
    expect(retry.idempotencyKey).toBe(key);
    expect(retryCalls.filter((c) => c.startsWith('open:'))).toEqual([]);
    expect(calls.filter((c) => c.startsWith('open:'))).toHaveLength(1);
  });

  it('NEG3-23: reconciles a lost open response instead of double-publishing', async () => {
    const existing: PullRequestRef = {
      number: 7,
      url: 'https://github.com/acme/orders/pull/7',
      headSha: SHA,
      state: 'open',
    };
    const result = await publishBundleEvidence(
      publishInput({
        github: fakeGithub({ openError: new Error('socket hung up'), pr: existing }),
      }),
    );
    expect(result.status).toBe('published');
    if (result.status !== 'published') throw new Error('unreachable');
    expect(result.reconciled).toBe(true);
    expect(result.pr.number).toBe(7);
  });

  it('rethrows the open failure when reconciliation finds nothing', async () => {
    await expect(
      publishBundleEvidence(
        publishInput({ github: fakeGithub({ openError: new Error('socket hung up'), pr: null }) }),
      ),
    ).rejects.toThrow(/socket hung up/);
  });

  it('reports a reconciliation failure explicitly when the lookup also fails', async () => {
    await expect(
      publishBundleEvidence(
        publishInput({
          github: fakeGithub({ openError: new Error('socket hung up'), findError: new Error('dns down') }),
        }),
      ),
    ).rejects.toThrow(/reconcil/i);
  });

  it('NEG3-39: refuses a wrong head without rebasing or opening', async () => {
    const calls: string[] = [];
    await expect(
      publishBundleEvidence(publishInput({ github: fakeGithub({ calls, head: OTHER_SHA }) })),
    ).rejects.toThrow(/head/i);
    expect(calls.filter((c) => c.startsWith('open:'))).toEqual([]);
  });

  it('denies revoked installations and wrong providers before any effect', async () => {
    const calls: string[] = [];
    await expect(
      publishBundleEvidence(
        publishInput({ connection: connection({ status: 'revoked' }), github: fakeGithub({ calls }) }),
      ),
    ).rejects.toThrow(/revoked|inactive/i);
    await expect(
      publishBundleEvidence(
        publishInput({
          connection: connection({ provider: 'gitlab' }),
          github: fakeGithub({ calls }),
        }),
      ),
    ).rejects.toThrow(/provider/i);
    expect(calls).toEqual([]);
  });
});
