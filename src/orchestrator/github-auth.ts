import type { SecretBrokerPort } from '../core/index.js';
import {
  assertOAuthConfig,
  buildAuthorizeUrl,
  completeOAuth,
  fetchOAuthTransport,
  mintOAuthState,
  verifyOAuthState,
  type GitHubOAuthConfig,
  type GitHubOAuthMode,
  type GitHubOAuthProfile,
  type GitHubOAuthTransport,
  type VerifiedOAuthState,
} from '../modules/github/index.js';
import {
  createGitHubIdentityStore,
  type GitHubIdentityDb,
  type GitHubIdentityStore,
} from '../modules/identity/index.js';

/**
 * GitHub sign-in wiring (WP3-22/WP3-28).
 *
 * The composition root injects the database handle, the secret broker, the
 * public OAuth client config, and the provider transport; it adds no OAuth,
 * linking, or session behavior of its own. Live sign-in proof needs an
 * authorized OAuth App (client id + redirect + broker-held secret) and
 * stays `blocked` until the operator provides it — without that wiring
 * the HTTP layer answers `github: false` and fails closed.
 */

export interface GitHubAuthOptions {
  readonly db: GitHubIdentityDb;
  readonly secrets: SecretBrokerPort;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly clientSecretRef: string;
  readonly stateSecretRef: string;
  /** Production uses the live fetch transport; tests inject fakes behind the seam. */
  readonly transport?: GitHubOAuthTransport | undefined;
}

export interface GitHubFlowStart {
  readonly state: string;
  readonly authorizeUrl: string;
}

export interface GitHubAuthComposition {
  readonly config: GitHubOAuthConfig;
  readonly store: GitHubIdentityStore;
  startFlow(input: {
    mode: GitHubOAuthMode;
    nonce: string;
    userId?: string | undefined;
    tenantId?: string | undefined;
    returnTarget?: string | undefined;
    rememberMe?: boolean | undefined;
    origin: 'login' | 'register';
    nowMs: number;
  }): Promise<GitHubFlowStart>;
  verifyFlow(input: { state: string; nowMs: number }): Promise<VerifiedOAuthState>;
  fetchProfile(code: string): Promise<GitHubOAuthProfile>;
}

export function composeGitHubAuth(options: GitHubAuthOptions): GitHubAuthComposition {
  const config: GitHubOAuthConfig = {
    clientId: options.clientId,
    redirectUri: options.redirectUri,
    clientSecretRef: options.clientSecretRef,
    stateSecretRef: options.stateSecretRef,
  };
  // Fail fast at startup: a half-wired OAuth client never serves traffic.
  assertOAuthConfig(config);
  const store = createGitHubIdentityStore(options.db);
  const transport = options.transport ?? fetchOAuthTransport();
  return {
    config,
    store,
    startFlow: async (input): Promise<GitHubFlowStart> => {
      const secret = await options.secrets.readCredential(config.stateSecretRef);
      const state = mintOAuthState({
        mode: input.mode,
        nonce: input.nonce,
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
        ...(input.returnTarget === undefined ? {} : { returnTarget: input.returnTarget }),
        ...(input.rememberMe === undefined ? {} : { rememberMe: input.rememberMe }),
        origin: input.origin,
        nowMs: input.nowMs,
        secret,
      });
      return { state, authorizeUrl: buildAuthorizeUrl(config, state) };
    },
    verifyFlow: async (input): Promise<VerifiedOAuthState> => {
      const secret = await options.secrets.readCredential(config.stateSecretRef);
      return verifyOAuthState({ state: input.state, nowMs: input.nowMs, secret });
    },
    fetchProfile: (code: string): Promise<GitHubOAuthProfile> =>
      completeOAuth({ code, config, secrets: options.secrets, transport }),
  };
}
