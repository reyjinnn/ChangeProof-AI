import {
  ChangeProofError,
  type JobLease,
} from '../../core/index.js';

/**
 * Lease fencing and effect identity (WP3-23, FR3-32/33).
 *
 * Preparation scope: the pure decision core over the proven `JobLease`
 * contract. A stale epoch, a version mismatch, a cancelled/revoked lease, or
 * a revoked grant rejects the write before any external effect. Duplicate
 * effect identities collapse to one logical effect. Retries are bounded by
 * count; durable state, heartbeats, and the dispatcher arrive with the full WP.
 */

export interface WriteAuthority {
  readonly epoch: number;
  readonly version: number;
  readonly nowIso: string;
  readonly currentGrantVersion: number;
}

/** True once `expiresAt` has passed. Unreadable timestamps throw (fail closed). */
export function isLeaseExpired(lease: JobLease, nowIso: string): boolean {
  const now = Date.parse(nowIso);
  const expires = Date.parse(lease.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expires)) {
    throw new ChangeProofError('Lease timestamp is unreadable; refusing to authorize.');
  }
  return expires <= now;
}

/**
 * Authorize one fenced write. Every condition is current authority: active
 * state, live lease, matching fencing epoch, matching CAS version, no pending
 * cancellation, and a grant version that has not moved on.
 */
export function assertLeaseWritable(lease: JobLease, authority: WriteAuthority): void {
  if (lease.state !== 'active') {
    throw new ChangeProofError(
      `Lease is ${lease.state}; only an active lease is write authority.`,
    );
  }
  if (isLeaseExpired(lease, authority.nowIso)) {
    throw new ChangeProofError('Lease has expired; renew before writing.');
  }
  if (authority.epoch !== lease.epoch) {
    throw new ChangeProofError(
      'Stale epoch: the lease moved on and a fenced worker must not write.',
    );
  }
  if (authority.version !== lease.version) {
    throw new ChangeProofError(
      'Version mismatch: the lease changed under this write; retry against current state.',
    );
  }
  if (lease.cancelRequested) {
    throw new ChangeProofError('Cancellation was requested; draining workers accept no new writes.');
  }
  if (lease.grantVersion < authority.currentGrantVersion) {
    throw new ChangeProofError(
      'Grant was revoked or superseded mid-run; new effects are rejected.',
    );
  }
}

/** A repeated effect identity is a duplicate delivery, never a second effect. */
export function assertEffectIdUnique(seenEffectIds: ReadonlySet<string>, effectId: string): void {
  if (effectId.length === 0) {
    throw new ChangeProofError('Effect identity must not be empty; effects need stable identity.');
  }
  if (seenEffectIds.has(effectId)) {
    throw new ChangeProofError(
      'Duplicate effect identity: at-least-once delivery reconciles to one logical effect.',
    );
  }
}

/** Bounded retries: the next count, or an exhausted budget that stops the branch. */
export function nextRetryCount(retryCount: number, maxRetries: number): number {
  if (!Number.isInteger(retryCount) || retryCount < 0) {
    throw new ChangeProofError('Retry count is unreadable; refusing to schedule.');
  }
  if (retryCount >= maxRetries) {
    throw new ChangeProofError('Retry budget exhausted; the branch stops here.');
  }
  return retryCount + 1;
}
