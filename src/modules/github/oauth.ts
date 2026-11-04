import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { ChangeProofError, IdSchema, type SecretBrokerPort } from '../../core/index.js';

/**
 * GitHub OAuth sign-in (WP3-22, FR3-29/FR3-30).
 *
 * Pure helpers plus a narrow transport seam: the authorize URL, the
 * HMAC-bound state token, the code exchange, and verified-email profile
 * resolution. Secrets are read from the broker at call time and never
 * stored, logged, or embedded in errors. Provider URLs are hardcoded —
 * no caller input ever becomes a request target (SSRF layer).
 *
 * Sign-in is NOT repository authority: a session from this flow proves
 * identity only. Repository reads/writes still need a GitHub App
 * installation grant (FR3-30), and a provider outage fails closed.
 */

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';
export const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

/** Least privilege for sign-in: identity + verified emails, nothing else. */
export const OAUTH_SCOPES = 'read:user user:email';

/** [DERIVED] State lifetime: 10 minutes, enough for one human round-trip. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;

const OAUTH_HTTP_TIMEOUT_MS = 10_000;

export interface GitHubOAuthConfig {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly clientSecretRef: string;
  readonly stateSecretRef: string;
}

/**
 * Redirect targets stay in-app: absolute paths that cannot be an open
 * redirect. Mirrors `assertSafeReturnTarget` in the identity module —
 * a leaf cannot import its sibling, so the rule is restated here and
 * covered by the same negative cases.
 */
export function assertSafeInAppTarget(target: string): void {
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

/** OAuth client config: absolute redirect, https outside localhost, no defaults. */
export function assertOAuthConfig(config: GitHubOAuthConfig): void {
  if (config.clientId.trim().length === 0) {
    throw new ChangeProofError('GitHub OAuth client id is missing; refusing to start the flow.');
  }
  if (config.clientSecretRef.length === 0 || config.stateSecretRef.length === 0) {
    throw new ChangeProofError('GitHub OAuth secret refs are missing; refusing a default credential.');
  }
  let redirect: URL;
  try {
    redirect = new URL(config.redirectUri);
  } catch {
    throw new ChangeProofError('GitHub OAuth redirect URI is unreadable; refusing to start the flow.');
  }
  if (redirect.username !== '' || redirect.password !== '') {
    throw new ChangeProofError('GitHub OAuth redirect URI must not carry credentials; refusing.');
  }
  const host = redirect.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (redirect.protocol === 'http:' && !loopback) {
    throw new ChangeProofError('GitHub OAuth redirect URI must be https outside localhost; refusing.');
  }
  if (redirect.protocol !== 'http:' && redirect.protocol !== 'https:') {
    throw new ChangeProofError('GitHub OAuth redirect URI must be http(s); refusing.');
  }
}

export type GitHubOAuthMode = 'login' | 'link';

export interface MintOAuthStateInput {
  readonly mode: GitHubOAuthMode;
  /** Random nonce mirrored in the Lax cookie; binds the browser to the flow. */
  readonly nonce: string;
  /** Link mode only: the session user that started the flow. */
  readonly userId?: string | undefined;
  /** Login mode only: multi-organization hint, validated again at login. */
  readonly tenantId?: string | undefined;
  readonly returnTarget?: string | undefined;
  readonly rememberMe?: boolean | undefined;
  /** Which dialog started the flow, so failures return to the same one. */
  readonly origin?: 'login' | 'register' | undefined;
  readonly nowMs: number;
  readonly ttlMs?: number | undefined;
  readonly secret: string;
}

export interface VerifiedOAuthState {
  readonly mode: GitHubOAuthMode;
  readonly nonce: string;
  readonly userId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly returnTarget: string;
  readonly rememberMe: boolean;
  readonly origin: 'login' | 'register';
}

const STATE_VERSION = 'v1';
const STATE_PURPOSE = 'github_oauth';
// Runtime validation sets: the wire can carry anything, so membership is
// checked instead of trusting the static union (see challenges.ts).
const OAUTH_MODES: ReadonlySet<string> = new Set(['login', 'link']);
const OAUTH_ORIGINS: ReadonlySet<string> = new Set(['login', 'register']);

interface OAuthStatePayload {
  readonly v: string;
  readonly purpose: string;
  readonly mode: GitHubOAuthMode;
  readonly nonce: string;
  readonly userId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly returnTarget: string;
  readonly rememberMe: boolean;
  readonly origin: 'login' | 'register';
  readonly iat: number;
  readonly exp: number;
}

function signState(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(`${STATE_VERSION}.${encoded}`).digest('hex');
}

/** Mint a purpose-bound state token. Every field is validated; nothing defaults silently. */
export function mintOAuthState(input: MintOAuthStateInput): string {
  if (!OAUTH_MODES.has(input.mode)) {
    throw new ChangeProofError('OAuth state mode is unknown; refusing to mint.');
  }
  if (input.nonce.length === 0 || input.nonce.length > 200) {
    throw new ChangeProofError('OAuth state needs a fresh nonce; refusing to mint.');
  }
  if (input.mode === 'link' && (input.userId === undefined || input.userId === '')) {
    throw new ChangeProofError('Link mode needs the starting session user; refusing to mint.');
  }
  if (input.mode === 'login' && input.userId !== undefined) {
    throw new ChangeProofError('Login mode carries no user; refusing to mint.');
  }
  const userId = input.userId === undefined ? undefined : IdSchema.parse(input.userId);
  const tenantId = input.tenantId === undefined ? undefined : IdSchema.parse(input.tenantId);
  const returnTarget = input.returnTarget ?? '/';
  assertSafeInAppTarget(returnTarget);
  const origin = input.origin ?? 'login';
  if (!OAUTH_ORIGINS.has(origin)) {
    throw new ChangeProofError('OAuth origin is unknown; refusing to mint.');
  }
  if (!Number.isInteger(input.nowMs) || input.nowMs < 0) {
    throw new ChangeProofError('OAuth state issue time is unreadable; refusing to mint.');
  }
  const ttlMs = input.ttlMs ?? OAUTH_STATE_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new ChangeProofError('OAuth state lifetime must be a positive duration; refusing to mint.');
  }
  if (input.secret.length === 0) {
    throw new ChangeProofError('OAuth state secret is missing; refusing to mint.');
  }
  const payload: OAuthStatePayload = {
    v: STATE_VERSION,
    purpose: STATE_PURPOSE,
    mode: input.mode,
    nonce: input.nonce,
    ...(userId === undefined ? {} : { userId }),
    ...(tenantId === undefined ? {} : { tenantId }),
    returnTarget,
    rememberMe: input.rememberMe ?? false,
    origin,
    iat: input.nowMs,
    exp: input.nowMs + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${STATE_VERSION}.${encoded}.${signState(encoded, input.secret)}`;
}

/** Verify a state token for this flow at this moment. Any failure throws. */
export function verifyOAuthState(input: { state: string; nowMs: number; secret: string }): VerifiedOAuthState {
  if (input.secret.length === 0) {
    throw new ChangeProofError('OAuth state secret is missing; nothing is verified.');
  }
  const parts = input.state.split('.');
  if (parts.length !== 3 || parts[0] !== STATE_VERSION) {
    throw new ChangeProofError('OAuth state is malformed; the callback is not applied.');
  }
  const encoded = parts[1] ?? '';
  const presentedHex = parts[2] ?? '';
  if (encoded === '' || !/^[0-9a-f]{64}$/.test(presentedHex)) {
    throw new ChangeProofError('OAuth state is malformed; the callback is not applied.');
  }
  const expected = Buffer.from(signState(encoded, input.secret), 'hex');
  const presented = Buffer.from(presentedHex, 'hex');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new ChangeProofError('OAuth state signature mismatch; the callback is not applied.');
  }
  let payload: OAuthStatePayload;
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null) {
      throw new ChangeProofError('OAuth state payload is malformed.');
    }
    payload = decoded as OAuthStatePayload;
  } catch (error) {
    if (error instanceof ChangeProofError) throw error;
    throw new ChangeProofError('OAuth state payload is malformed.');
  }
  if (payload.v !== STATE_VERSION || payload.purpose !== STATE_PURPOSE) {
    throw new ChangeProofError('OAuth state is not for this flow; the callback is not applied.');
  }
  if (!OAUTH_MODES.has(payload.mode)) {
    throw new ChangeProofError('OAuth state mode is unknown; the callback is not applied.');
  }
  if (!Number.isInteger(input.nowMs) || input.nowMs < 0) {
    throw new ChangeProofError('Verification time is unreadable; the callback is not applied.');
  }
  if (input.nowMs > payload.exp) {
    throw new ChangeProofError('OAuth state has expired; start the GitHub flow again.');
  }
  if (input.nowMs < payload.iat) {
    throw new ChangeProofError('OAuth state is issued in the future; the callback is not applied.');
  }
  if (payload.nonce.length === 0) {
    throw new ChangeProofError('OAuth state payload is malformed.');
  }
  if (payload.mode === 'link' && (payload.userId === undefined || payload.userId === '')) {
    throw new ChangeProofError('Link state carries no user; the callback is not applied.');
  }
  if (!OAUTH_ORIGINS.has(payload.origin)) {
    throw new ChangeProofError('OAuth state origin is unknown; the callback is not applied.');
  }
  return {
    mode: payload.mode,
    nonce: payload.nonce,
    ...(payload.userId === undefined ? {} : { userId: payload.userId }),
    ...(payload.tenantId === undefined ? {} : { tenantId: payload.tenantId }),
    returnTarget: payload.returnTarget,
    rememberMe: payload.rememberMe,
    origin: payload.origin,
  };
}

/** Authorize URL for the browser redirect. State is opaque to the caller. */
export function buildAuthorizeUrl(config: GitHubOAuthConfig, state: string): string {
  assertOAuthConfig(config);
  if (state.length === 0) {
    throw new ChangeProofError('OAuth state is missing; refusing to redirect.');
  }
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', OAUTH_SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
}

/** Authorization codes are bounded opaque tokens; anything else is refused. */
export function assertAuthorizationCode(code: string): void {
  if (code.length === 0 || code.length > 500 || /\s/.test(code)) {
    throw new ChangeProofError('Authorization code is malformed; refusing to exchange it.');
  }
}

export interface GitHubOAuthProfile {
  readonly githubId: string;
  readonly login: string;
  readonly email: string;
}

/** Narrow transport seam: production uses fetch, tests use fakes. */
export interface GitHubOAuthTransport {
  exchangeCode(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<string>;
  fetchProfile(input: { accessToken: string }): Promise<GitHubOAuthProfile>;
}

const GitHubUserSchema = z.object({ id: z.number().int().positive(), login: z.string().min(1).max(100) });
const GitHubEmailSchema = z.object({
  email: z.string().min(3).max(254),
  verified: z.boolean(),
  primary: z.boolean(),
});

/**
 * Resolve the sign-in profile: identity plus one verified email. Primary
 * verified wins; otherwise the first verified address. No verified email
 * fails closed — an unverified address never becomes an account.
 */
export function selectVerifiedEmail(emails: readonly unknown[]): string {
  const parsed = z.array(GitHubEmailSchema).safeParse(emails);
  if (!parsed.success) {
    throw new ChangeProofError('GitHub returned an unreadable email list; refusing to continue.');
  }
  const verified = parsed.data.filter((entry) => entry.verified);
  const primary = verified.find((entry) => entry.primary);
  const chosen = primary ?? verified[0];
  if (chosen === undefined) {
    throw new ChangeProofError('GitHub account exposes no verified email; add and verify one, then retry.');
  }
  return chosen.email.trim().toLowerCase();
}

function refuse(operation: string, status: number | undefined): never {
  if (status === 400 || status === 401 || status === 403) {
    throw new ChangeProofError(
      `${operation}: GitHub refused the request (expired, reused, or forged code); start the flow again.`,
    );
  }
  if (status === 404) {
    throw new ChangeProofError(`${operation}: GitHub has no such resource for this token; refusing.`);
  }
  if (status !== undefined) {
    throw new ChangeProofError(`${operation}: GitHub answered ${String(status)}; retry later.`);
  }
  throw new ChangeProofError(`${operation}: GitHub is unreachable; retry later. Provider outage fails closed.`);
}

/** Production transport: fetch against the hardcoded provider URLs. */
export function fetchOAuthTransport(): GitHubOAuthTransport {
  return {
    exchangeCode: async (input): Promise<string> => {
      let response: Response;
      try {
        response = await fetch(GITHUB_TOKEN_URL, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: input.clientId,
            client_secret: input.clientSecret,
            code: input.code,
            redirect_uri: input.redirectUri,
          }),
          signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
        });
      } catch {
        refuse('Code exchange', undefined);
      }
      if (!response.ok) refuse('Code exchange', response.status);
      const body: unknown = await response.json().catch(() => undefined);
      const token =
        typeof body === 'object' && body !== null && 'access_token' in body ? body.access_token : undefined;
      if (typeof token !== 'string' || token.length === 0) {
        throw new ChangeProofError('Code exchange returned no token; start the GitHub flow again.');
      }
      return token;
    },
    fetchProfile: async (input): Promise<GitHubOAuthProfile> => {
      if (input.accessToken.length === 0) {
        throw new ChangeProofError('GitHub profile fetch needs the exchanged token; refusing anonymous calls.');
      }
      const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${input.accessToken}` };
      let userResponse: Response;
      let emailsResponse: Response;
      try {
        [userResponse, emailsResponse] = await Promise.all([
          fetch(GITHUB_USER_URL, { headers, signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS) }),
          fetch(GITHUB_EMAILS_URL, { headers, signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS) }),
        ]);
      } catch {
        refuse('Profile fetch', undefined);
      }
      if (!userResponse.ok) refuse('Profile fetch', userResponse.status);
      if (!emailsResponse.ok) refuse('Email fetch', emailsResponse.status);
      const user = GitHubUserSchema.safeParse(await userResponse.json().catch(() => undefined));
      if (!user.success) {
        throw new ChangeProofError('GitHub returned an unreadable profile; refusing to continue.');
      }
      const emails: unknown = await emailsResponse.json().catch(() => undefined);
      return {
        githubId: String(user.data.id),
        login: user.data.login,
        email: selectVerifiedEmail(emails as readonly unknown[]),
      };
    },
  };
}

export interface CompleteOAuthInput {
  readonly code: string;
  readonly config: GitHubOAuthConfig;
  readonly secrets: SecretBrokerPort;
  readonly transport: GitHubOAuthTransport;
}

/**
 * Exchange one authorization code for the verified sign-in profile. The
 * client secret is read at call time and handed to the transport; it is
 * never stored, logged, or embedded in errors.
 */
export async function completeOAuth(input: CompleteOAuthInput): Promise<GitHubOAuthProfile> {
  assertOAuthConfig(input.config);
  assertAuthorizationCode(input.code);
  const clientSecret = await input.secrets.readCredential(input.config.clientSecretRef);
  const accessToken = await input.transport.exchangeCode({
    code: input.code,
    clientId: input.config.clientId,
    clientSecret,
    redirectUri: input.config.redirectUri,
  });
  return input.transport.fetchProfile({ accessToken });
}
