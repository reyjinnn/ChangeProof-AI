import { createHmac, timingSafeEqual } from 'node:crypto';

import { ChangeProofError, type RepositoryConnection } from '../../core/index.js';

/**
 * GitHub App webhook verification and installation grants (WP3-22, FR3-30).
 *
 * Preparation scope: the pure verification core. Webhook signatures are
 * checked over the raw body with a broker-held secret (never logged, never
 * stored here), delivery IDs deduplicate at-least-once traffic, and a revoked
 * or superseded installation stops new effects. Live installation, snapshot,
 * and CI-attestation acceptance needs an authorized GitHub App and stays
 * `blocked`; no `octokit` call is faked here.
 */

export interface WebhookVerificationInput {
  readonly rawBody: string;
  readonly signatureHeader: string;
  readonly secret: string;
}

/**
 * Verify the `sha256=` HMAC signature over the exact raw body.
 * Comparison is timing-safe; anything missing, malformed, or mismatched throws.
 */
export function verifyWebhookSignature(input: WebhookVerificationInput): void {
  if (input.secret.length === 0) {
    throw new ChangeProofError('Webhook secret is missing; nothing is verified against an empty secret.');
  }
  const prefix = 'sha256=';
  if (!input.signatureHeader.startsWith(prefix)) {
    throw new ChangeProofError(
      'Webhook signature header is missing or malformed; the event is not authority.',
    );
  }
  const presentedHex = input.signatureHeader.slice(prefix.length);
  if (!/^[0-9a-f]{64}$/.test(presentedHex)) {
    throw new ChangeProofError(
      'Webhook signature header is malformed; the event is not authority.',
    );
  }
  const expected = createHmac('sha256', input.secret).update(input.rawBody).digest();
  let presented: Buffer;
  try {
    presented = Buffer.from(presentedHex, 'hex');
  } catch {
    throw new ChangeProofError(
      'Webhook signature header is malformed; the event is not authority.',
    );
  }
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new ChangeProofError(
      'Webhook signature mismatch; the event is not authority and is dropped.',
    );
  }
}

/** True when the delivery ID was already seen (duplicate → one logical effect). */
export function checkDuplicateDelivery(seenDeliveryIds: ReadonlySet<string>, deliveryId: string): boolean {
  if (deliveryId.length === 0) {
    throw new ChangeProofError('Delivery ID must not be empty; undated events cannot be deduplicated.');
  }
  return seenDeliveryIds.has(deliveryId);
}

export interface InstallationGrantCheck {
  readonly repositoryIds: readonly string[];
  readonly revocationVersion: number;
}

/**
 * Authorize an effect against the current installation: active status, a
 * revocation version that has not moved on, and an allowlist covering every
 * required repository. Failures are generic (NEG3-21: no disclosure).
 */
export function assertInstallationGrant(
  connection: RepositoryConnection,
  check: InstallationGrantCheck,
): void {
  if (connection.status !== 'active') {
    throw new ChangeProofError(
      'Installation is revoked or inactive; revocation withholds new effects and stops queued work.',
    );
  }
  if (connection.revocationVersion < check.revocationVersion) {
    throw new ChangeProofError(
      'Installation revocation version moved on (suspension, uninstall, or reinstall); revalidation is required.',
    );
  }
  for (const repositoryId of check.repositoryIds) {
    if (!connection.repositoryAllowlist.includes(repositoryId)) {
      throw new ChangeProofError('Request is not authorized for every required repository.');
    }
  }
}

export interface DeliveryFreshness {
  readonly deliveredAtMs: number;
  readonly receivedAtMs: number;
  readonly maxSkewMs: number;
}

/** Reject deliveries older than the skew window instead of applying them out of order. */
export function assertDeliveryFresh(freshness: DeliveryFreshness): void {
  for (const value of [freshness.deliveredAtMs, freshness.receivedAtMs, freshness.maxSkewMs]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new ChangeProofError('Delivery timestamps are unreadable; the event is not applied.');
    }
  }
  if (freshness.receivedAtMs - freshness.deliveredAtMs > freshness.maxSkewMs) {
    throw new ChangeProofError(
      'Stale delivery: older than the skew window, held for reconciliation instead of applied.',
    );
  }
}
