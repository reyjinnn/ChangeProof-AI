import { createHmac, timingSafeEqual } from 'node:crypto';

import { ChangeProofError, IdSchema } from '../../core/index.js';

/**
 * GitHub App installation connect (Vercel-style entry, FR3-30).
 *
 * Pure helpers plus the same HMAC state discipline as the OAuth flow:
 * the install URL, the user-bound state token, and strict callback
 * validation. The user installs the App on github.com, GitHub redirects
 * back with `installation_id` + `setup_action`, and the server verifies
 * the installation live before storing anything — no pasted tokens, no
 * operator-typed ids. Sign-in alone still grants nothing: only a verified
 * installation becomes repository authority, and a provider outage or a
 * forged callback fails closed.
 */

export const GITHUB_APP_INSTALL_BASE = 'https://github.com/apps';

/** [DERIVED] State lifetime: 10 minutes, enough for one human round-trip. */
export const INSTALL_STATE_TTL_MS = 10 * 60_000;

const INSTALL_STATE_VERSION = 'v1';
const INSTALL_STATE_PURPOSE = 'github_install';
// GitHub App slugs are lowercase alphanumerics and hyphens; bounded so a
// hostile value can never stretch the redirect target.
const APP_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const INSTALLATION_ID = /^[1-9][0-9]*$/;
// Fresh installs and repo-selection changes both re-sync the allowlist.
// Anything else (requests, cancellations, unknown values) is refused.

/** App slug: the public `github.com/apps/<slug>` name, never a secret. */
export function assertAppSlug(slug: string): void {
  if (!APP_SLUG.test(slug)) {
    throw new ChangeProofError('GitHub App slug is malformed; refusing to redirect.');
  }
}

/** Install URL for the browser redirect. State is opaque to the caller. */
export function buildInstallUrl(input: { appSlug: string; state: string }): string {
  assertAppSlug(input.appSlug);
  if (input.state.length === 0) {
    throw new ChangeProofError('Install state is missing; refusing to redirect.');
  }
  const url = new URL(`${GITHUB_APP_INSTALL_BASE}/${input.appSlug}/installations/new`);
  url.searchParams.set('state', input.state);
  return url.toString();
}

/** Callback installation ids are bounded positive integers, nothing else. */
export function assertInstallationId(installationId: string): void {
  if (!INSTALLATION_ID.test(installationId)) {
    throw new ChangeProofError('Installation id is malformed; the callback is not applied.');
  }
}

export type InstallSetupAction = 'install' | 'update';

/** Only completed installations (fresh or re-synced) connect repositories. */
export function assertSetupAction(action: string): InstallSetupAction {
  if (action !== 'install' && action !== 'update') {
    throw new ChangeProofError('Setup action did not complete an installation; nothing is connected.');
  }
  return action;
}

export interface MintInstallStateInput {
  /** Session user that started the flow; the callback must prove the same user. */
  readonly userId: string;
  /** Random nonce mirrored in the Lax cookie; binds the browser to the flow. */
  readonly nonce: string;
  readonly nowMs: number;
  readonly ttlMs?: number | undefined;
  readonly secret: string;
}

export interface VerifiedInstallState {
  readonly userId: string;
  readonly nonce: string;
}

interface InstallStatePayload {
  readonly v: string;
  readonly purpose: string;
  readonly userId: string;
  readonly nonce: string;
  readonly iat: number;
  readonly exp: number;
}

function signState(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(`${INSTALL_STATE_VERSION}.${encoded}`).digest('hex');
}

/** Mint a purpose-bound state token. Every field is validated; nothing defaults silently. */
export function mintInstallState(input: MintInstallStateInput): string {
  const userId = IdSchema.parse(input.userId);
  if (input.nonce.length === 0 || input.nonce.length > 200) {
    throw new ChangeProofError('Install state needs a fresh nonce; refusing to mint.');
  }
  if (!Number.isInteger(input.nowMs) || input.nowMs < 0) {
    throw new ChangeProofError('Install state issue time is unreadable; refusing to mint.');
  }
  const ttlMs = input.ttlMs ?? INSTALL_STATE_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new ChangeProofError('Install state lifetime must be a positive duration; refusing to mint.');
  }
  if (input.secret.length === 0) {
    throw new ChangeProofError('Install state secret is missing; refusing to mint.');
  }
  const payload: InstallStatePayload = {
    v: INSTALL_STATE_VERSION,
    purpose: INSTALL_STATE_PURPOSE,
    userId,
    nonce: input.nonce,
    iat: input.nowMs,
    exp: input.nowMs + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${INSTALL_STATE_VERSION}.${encoded}.${signState(encoded, input.secret)}`;
}

/** Verify a state token for this flow at this moment. Any failure throws. */
export function verifyInstallState(input: { state: string; nowMs: number; secret: string }): VerifiedInstallState {
  if (input.secret.length === 0) {
    throw new ChangeProofError('Install state secret is missing; nothing is verified.');
  }
  const parts = input.state.split('.');
  if (parts.length !== 3 || parts[0] !== INSTALL_STATE_VERSION) {
    throw new ChangeProofError('Install state is malformed; the callback is not applied.');
  }
  const encoded = parts[1] ?? '';
  const presentedHex = parts[2] ?? '';
  if (encoded === '' || !/^[0-9a-f]{64}$/.test(presentedHex)) {
    throw new ChangeProofError('Install state is malformed; the callback is not applied.');
  }
  const expected = Buffer.from(signState(encoded, input.secret), 'hex');
  const presented = Buffer.from(presentedHex, 'hex');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new ChangeProofError('Install state signature mismatch; the callback is not applied.');
  }
  let payload: InstallStatePayload;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof decoded !== 'object' || decoded === null) {
      throw new ChangeProofError('Install state payload is malformed.');
    }
    payload = decoded as InstallStatePayload;
  } catch (error) {
    if (error instanceof ChangeProofError) throw error;
    throw new ChangeProofError('Install state payload is malformed.');
  }
  if (payload.v !== INSTALL_STATE_VERSION || payload.purpose !== INSTALL_STATE_PURPOSE) {
    throw new ChangeProofError('Install state is not for this flow; the callback is not applied.');
  }
  if (!Number.isInteger(input.nowMs) || input.nowMs < 0) {
    throw new ChangeProofError('Verification time is unreadable; the callback is not applied.');
  }
  if (input.nowMs > payload.exp) {
    throw new ChangeProofError('Install state has expired; start the GitHub install again.');
  }
  if (input.nowMs < payload.iat) {
    throw new ChangeProofError('Install state is issued in the future; the callback is not applied.');
  }
  return { userId: IdSchema.parse(payload.userId), nonce: payload.nonce };
}
