import { createHmac, timingSafeEqual } from 'node:crypto';

import { ChangeProofError } from '../../core/index.js';

/**
 * Purpose-bound, expiring, single-use challenges (WP3-28, FR3-38).
 *
 * Preparation scope: the token core for email verification, password reset,
 * and account linking. A challenge binds purpose + subject + expiry + nonce
 * under a broker-held HMAC secret; acceptance checks purpose, signature,
 * expiry, and nonce freshness. The used-nonce set lives with the caller (the
 * hosted store with the full WP). Actual delivery needs authorized email
 * infrastructure and stays `blocked`. Time is injected — never read — so the
 * logic is deterministic and replay-testable.
 */

export type ChallengePurpose = 'verify_email' | 'reset_password' | 'link_account';

export interface MintChallengeInput {
  readonly purpose: ChallengePurpose;
  readonly subjectId: string;
  readonly issuedAtMs: number;
  readonly ttlMs: number;
  readonly nonce: string;
  readonly secret: string;
}

export interface VerifyChallengeInput {
  readonly token: string;
  readonly expectedPurpose: ChallengePurpose;
  readonly nowMs: number;
  readonly secret: string;
}

export interface VerifiedChallenge {
  readonly subjectId: string;
  readonly nonce: string;
}

const TOKEN_VERSION = 'v1';
const PURPOSES: ReadonlySet<string> = new Set(['verify_email', 'reset_password', 'link_account']);

interface ChallengePayload {
  readonly v: string;
  readonly purpose: string;
  readonly subject: string;
  readonly iat: number;
  readonly exp: number;
  readonly nonce: string;
}

function encodePayload(payload: ChallengePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function signPayload(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(`${TOKEN_VERSION}.${encoded}`).digest('hex');
}

/** Mint a challenge token. All inputs validated; nothing is defaulted. */
export function mintChallenge(input: MintChallengeInput): string {
  if (!PURPOSES.has(input.purpose)) {
    throw new ChangeProofError('Challenge purpose is unknown; refusing to mint.');
  }
  if (input.subjectId.length === 0) {
    throw new ChangeProofError('Challenge needs a subject; refusing to mint.');
  }
  if (!Number.isInteger(input.issuedAtMs) || input.issuedAtMs < 0) {
    throw new ChangeProofError('Challenge issue time is unreadable; refusing to mint.');
  }
  if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0) {
    throw new ChangeProofError('Challenge lifetime must be a positive duration; refusing to mint.');
  }
  if (input.nonce.length === 0) {
    throw new ChangeProofError('Challenge needs a fresh nonce; refusing to mint.');
  }
  if (input.secret.length === 0) {
    throw new ChangeProofError('Challenge secret is missing; refusing to mint.');
  }
  const encoded = encodePayload({
    v: TOKEN_VERSION,
    purpose: input.purpose,
    subject: input.subjectId,
    iat: input.issuedAtMs,
    exp: input.issuedAtMs + input.ttlMs,
    nonce: input.nonce,
  });
  return `${TOKEN_VERSION}.${encoded}.${signPayload(encoded, input.secret)}`;
}

/** Verify a challenge token for one purpose at one moment. Any failure throws. */
export function verifyChallenge(input: VerifyChallengeInput): VerifiedChallenge {
  if (input.secret.length === 0) {
    throw new ChangeProofError('Challenge secret is missing; nothing is verified.');
  }
  const parts = input.token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    throw new ChangeProofError('Challenge token is malformed.');
  }
  const encoded = parts[1];
  const presentedHex = parts[2];
  if (encoded === undefined || presentedHex === undefined) {
    throw new ChangeProofError('Challenge token is malformed.');
  }
  if (!/^[0-9a-f]{64}$/.test(presentedHex)) {
    throw new ChangeProofError('Challenge token is malformed.');
  }
  const expected = Buffer.from(signPayload(encoded, input.secret), 'hex');
  const presented = Buffer.from(presentedHex, 'hex');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new ChangeProofError('Challenge signature mismatch; the token is not authority.');
  }
  let payload: ChallengePayload;
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      (decoded as { v?: unknown }).v !== TOKEN_VERSION
    ) {
      throw new ChangeProofError('Challenge payload is malformed.');
    }
    payload = decoded as ChallengePayload;
  } catch (error) {
    if (error instanceof ChangeProofError) {
      throw error;
    }
    throw new ChangeProofError('Challenge payload is malformed.');
  }
  if (payload.purpose !== input.expectedPurpose) {
    throw new ChangeProofError(
      'Challenge purpose mismatch; a token minted for one purpose never satisfies another.',
    );
  }
  if (!Number.isInteger(input.nowMs) || input.nowMs < 0) {
    throw new ChangeProofError('Verification time is unreadable; the token is not applied.');
  }
  if (input.nowMs > payload.exp) {
    throw new ChangeProofError('Challenge has expired; mint a fresh one.');
  }
  if (input.nowMs < payload.iat) {
    throw new ChangeProofError('Challenge is issued in the future; the token is not applied.');
  }
  if (payload.subject.length === 0 || payload.nonce.length === 0) {
    throw new ChangeProofError('Challenge payload is malformed.');
  }
  return { subjectId: payload.subject, nonce: payload.nonce };
}

/** Single-use: a nonce the caller already recorded is a replay, never a second use. */
export function assertNonceUnused(usedNonces: ReadonlySet<string>, nonce: string): void {
  if (nonce.length === 0) {
    throw new ChangeProofError('Challenge nonce is missing; the token is not applied.');
  }
  if (usedNonces.has(nonce)) {
    throw new ChangeProofError(
      'Challenge was already used; replay is rejected (single-use).',
    );
  }
}

/** Login return targets must be in-app paths; anything else is an open redirect. */
export function assertSafeReturnTarget(target: string): void {
  if (
    target.length === 0 ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.includes('\\') ||
    target.includes(':') ||
    /[\s<>]/.test(target)
  ) {
    throw new ChangeProofError('Return target is not a safe in-app path; the login flow stays put.');
  }
}
