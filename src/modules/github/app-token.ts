import { createSign } from 'node:crypto';

import { z } from 'zod';

import { ChangeProofError } from '../../core/index.js';

/**
 * GitHub App token minting (installation connect flow).
 *
 * The server holds the App private key behind the broker and mints
 * short-lived installation tokens on demand. Tokens are returned to the
 * caller only — never stored, never logged, never embedded in errors.
 * The API base is a fixed constant (no caller-controlled URL can reach the
 * fetch), and both ids are numeric-only before they touch a URL path.
 */

export const GITHUB_API_BASE = 'https://api.github.com';
const APP_JWT_SKEW_SEC = 60;
// 9 minutes, not 10: GitHub rejects exp more than 10 minutes past its own
// clock, and a locally-fast clock plus fleet variance eats the margin.
const APP_JWT_TTL_SEC = 540;
const EXCHANGE_TIMEOUT_MS = 15_000;
const POSITIVE_INT = /^[1-9][0-9]*$/;

export function mintAppJwt(input: { appId: string; privateKeyPem: string; nowMs: number }): string {
  if (!POSITIVE_INT.test(input.appId)) {
    throw new ChangeProofError('GitHub App id must be a positive integer; refusing to mint.');
  }
  if (!input.privateKeyPem.includes('PRIVATE KEY')) {
    throw new ChangeProofError('GitHub App key is not a PEM private key; refusing to mint.');
  }
  if (!Number.isFinite(input.nowMs) || input.nowMs <= 0) {
    throw new ChangeProofError('GitHub App JWT needs a finite timestamp; refusing to mint.');
  }
  const nowSec = Math.floor(input.nowMs / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: nowSec - APP_JWT_SKEW_SEC, exp: nowSec + APP_JWT_TTL_SEC, iss: input.appId }),
  ).toString('base64url');
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    signer.end();
    return `${header}.${payload}.${signer.sign(input.privateKeyPem, 'base64url')}`;
  } catch {
    throw new ChangeProofError('Could not sign the App JWT with this key; refusing to mint.');
  }
}

// Non-strict: GitHub ships extra fields (permissions, repository_selection,
// single_file, ...) that must not fail the parse.
const ExchangeResponseSchema = z.object({ token: z.string().min(1), expires_at: z.string().min(1) });

export async function exchangeInstallationToken(input: {
  installationId: string;
  jwt: string;
  fetchImpl?: typeof fetch;
}): Promise<{ token: string; expiresAt: string }> {
  if (!POSITIVE_INT.test(input.installationId)) {
    throw new ChangeProofError('GitHub installation id must be a positive integer; refusing.');
  }
  if (input.jwt.length === 0) {
    throw new ChangeProofError('GitHub App JWT is empty; refusing.');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${GITHUB_API_BASE}/app/installations/${input.installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${input.jwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'changeproof-server',
      },
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
  } catch {
    throw new ChangeProofError('GitHub API is unreachable; retry the connection later.');
  }
  if (response.status !== 200 && response.status !== 201) {
    // Provider error bodies carry a short public message (no secrets: this
    // request sends only the JWT header). Surfacing it saves the next debug.
    let detail = '';
    try {
      const body: unknown = await response.json();
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const message: unknown = body.message;
        if (typeof message === 'string') {
          detail = message.slice(0, 160);
        }
      }
    } catch {
      detail = '';
    }
    const suffix = detail === '' ? '' : ` (GitHub: ${detail})`;
    if (response.status === 404) {
      throw new ChangeProofError(`GitHub installation is unknown or not shared with this App; refusing.${suffix}`);
    }
    if (response.status === 401) {
      throw new ChangeProofError(
        `GitHub rejected the App credential; the operator must re-provision the App key.${suffix}`,
      );
    }
    throw new ChangeProofError(`GitHub answered HTTP ${String(response.status)}; retry the connection later.${suffix}`);
  }
  const parsed = ExchangeResponseSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ChangeProofError('GitHub returned no installation token; retry the connection later.');
  }
  return { token: parsed.data.token, expiresAt: parsed.data.expires_at };
}
