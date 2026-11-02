import { subjectKey } from '../core/index.js';
import type { JobLease, RepositoryConnection } from '../core/index.js';
import { renderCanonical, sha256Hex, verifyBundleManifest } from '../modules/evidence/index.js';
import type { EvidenceStore } from '../modules/evidence/index.js';
import {
  assertInstallationGrant,
  assemblePullRequestPayload,
  planEvidenceBranch,
} from '../modules/github/index.js';
import type {
  GitHubClient,
  InstallationGrantCheck,
  PullRequestRef,
  RepositoryRef,
} from '../modules/github/index.js';
import { assertEffectIdUnique, assertLeaseWritable } from '../modules/jobs/index.js';
import type { WriteAuthority } from '../modules/jobs/index.js';

import type { CoordinatedBundle } from './bundle.js';
import { PublicationReconciliationError, PublicationWithheldError } from './errors.js';

/**
 * Evidence publication broker (WP3-12): from a coordinated bundle to at most
 * one pull request.
 *
 * The broker withholds unless the bundle is verified, its manifest is present
 * and bound (digest, run, bundle), the lease is writable, the installation
 * grant is current, and the base head is exactly as expected. The idempotency
 * key binds provider, repository, base, head, manifest, and policy version, so
 * a retried key reconciles to the same logical PR instead of opening a second.
 *
 * `seenEffectIds` is caller-owned bookkeeping; the durable outbox that makes
 * it crash-safe arrives with the hosted dispatcher (WP3-14). No credential
 * ever passes through here: the client reads its token from the broker.
 */

export interface PublishBundleTarget {
  base: string;
  expectedHeadSha: string;
}

export interface PublishBundleInput {
  bundle: CoordinatedBundle;
  manifestDigest: string;
  evidence: EvidenceStore;
  runRef: string;
  lease: JobLease;
  authority: WriteAuthority;
  seenEffectIds: Set<string>;
  connection: RepositoryConnection;
  grantCheck: InstallationGrantCheck;
  repository: RepositoryRef;
  target: PublishBundleTarget;
  github: GitHubClient;
}

export type PublishBundleResult =
  | {
      status: 'published';
      pr: PullRequestRef;
      idempotencyKey: string;
      branch: string;
      reconciled: boolean;
    }
  | { status: 'already_published'; pr: PullRequestRef; idempotencyKey: string; branch: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function publicationIdempotencyKey(input: {
  owner: string;
  repo: string;
  base: string;
  expectedHeadSha: string;
  manifestDigest: string;
  policyVersion: string;
}): string {
  return sha256Hex(
    renderCanonical({
      provider: 'github',
      owner: input.owner,
      repo: input.repo,
      base: input.base,
      expectedHeadSha: input.expectedHeadSha,
      manifestDigest: input.manifestDigest,
      policyVersion: input.policyVersion,
    }),
  );
}

function publicationBody(input: {
  manifestDigest: string;
  policyVersion: string;
  targets: string[];
  runRef: string;
}): string {
  return [
    `Evidence manifest: ${input.manifestDigest}`,
    `Policy version: ${input.policyVersion}`,
    `Targets: ${input.targets.join(', ')}`,
    `Run: ${input.runRef}`,
    'Evidence is private to the tenant; reviewers need a grant to fetch it.',
  ].join('\n');
}

export async function publishBundleEvidence(input: PublishBundleInput): Promise<PublishBundleResult> {
  assertInstallationGrant(input.connection, input.grantCheck);
  if (input.connection.provider !== 'github') {
    throw new PublicationWithheldError(
      `provider "${input.connection.provider}" is not served by the GitHub publication path.`,
    );
  }
  assertLeaseWritable(input.lease, input.authority);

  const state = input.bundle.assessment.state;
  if (state !== 'verified') {
    const blockers = input.bundle.assessment.blockingReasons.join('; ');
    throw new PublicationWithheldError(
      `bundle state is "${state}", not verified${blockers.length > 0 ? `: ${blockers}` : '.'}`,
    );
  }

  const verified = verifyBundleManifest(input.evidence, input.manifestDigest);
  if (verified.manifest.runRef !== input.runRef) {
    throw new PublicationWithheldError(
      `manifest binds run "${verified.manifest.runRef}", not "${input.runRef}".`,
    );
  }
  if (verified.manifest.candidateBundleDigest !== input.bundle.facts.candidateBundleDigest) {
    throw new PublicationWithheldError('manifest bundle digest does not match the coordinated bundle.');
  }
  if (verified.manifest.state !== input.bundle.assessment.state) {
    throw new PublicationWithheldError(
      `manifest state "${verified.manifest.state}" does not match assessment "${input.bundle.assessment.state}".`,
    );
  }

  const idempotencyKey = publicationIdempotencyKey({
    owner: input.repository.owner,
    repo: input.repository.repo,
    base: input.target.base,
    expectedHeadSha: input.target.expectedHeadSha,
    manifestDigest: verified.digest,
    policyVersion: input.bundle.facts.policyVersion,
  });
  const plan = planEvidenceBranch({
    idempotencyKey,
    base: input.target.base,
    headSha: input.target.expectedHeadSha,
  });
  const effectId = `github-pr:${idempotencyKey}`;

  if (input.seenEffectIds.has(effectId)) {
    const existing = await input.github.findPullRequestByHead({
      connection: input.connection,
      repository: input.repository,
      head: plan.branch,
    });
    if (existing !== null) {
      return { status: 'already_published', pr: existing, idempotencyKey, branch: plan.branch };
    }
    throw new PublicationWithheldError(
      `effect ${effectId} is recorded but no pull request was found for ${plan.branch}; reconcile explicitly before republishing.`,
    );
  }
  assertEffectIdUnique(input.seenEffectIds, effectId);

  const head = await input.github.fetchBranchHead({
    connection: input.connection,
    repository: input.repository,
    branch: input.target.base,
  });
  if (head.sha !== input.target.expectedHeadSha) {
    throw new PublicationWithheldError(
      `base "${input.target.base}" head is ${head.sha}, expected ${input.target.expectedHeadSha}; refusing to publish onto a moved head.`,
    );
  }

  const payload = assemblePullRequestPayload({
    owner: input.repository.owner,
    repo: input.repository.repo,
    base: input.target.base,
    head: plan.branch,
    title: `ChangeProof verified bundle ${input.bundle.facts.candidateBundleDigest.slice(0, 12)}`,
    body: publicationBody({
      manifestDigest: verified.digest,
      policyVersion: input.bundle.facts.policyVersion,
      targets: input.bundle.bindings.map((binding) => subjectKey(binding.subject)),
      runRef: input.runRef,
    }),
    manifestDigest: verified.digest,
  });

  try {
    const pr = await input.github.openPullRequest({
      connection: input.connection,
      repository: input.repository,
      base: payload.base,
      head: payload.head,
      title: payload.title,
      body: payload.body,
    });
    input.seenEffectIds.add(effectId);
    return { status: 'published', pr, idempotencyKey, branch: plan.branch, reconciled: false };
  } catch (openError) {
    let existing: PullRequestRef | null;
    try {
      existing = await input.github.findPullRequestByHead({
        connection: input.connection,
        repository: input.repository,
        head: plan.branch,
      });
    } catch (lookupError) {
      throw new PublicationReconciliationError(failureMessage(openError), failureMessage(lookupError));
    }
    if (existing === null) throw openError;
    input.seenEffectIds.add(effectId);
    return { status: 'published', pr: existing, idempotencyKey, branch: plan.branch, reconciled: true };
  }
}
