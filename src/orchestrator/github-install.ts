import type { SecretBrokerPort } from '../core/index.js';
import {
  assertAppSlug,
  assertInstallationId,
  assertSetupAction,
  buildInstallUrl,
  mintInstallState,
  verifyInstallState,
  type InstallSetupAction,
  type VerifiedInstallState,
} from '../modules/github/index.js';

/**
 * GitHub App installation wiring (Vercel-style entry, FR3-30).
 *
 * The composition root injects the secret broker, the state secret ref,
 * and the public App slug; it adds no install, verification, or storage
 * behavior of its own. Live installation proof needs an authorized GitHub
 * App (slug + setup URL + broker-held key) and stays `blocked` until the
 * operator provides it — without that wiring the HTTP layer answers
 * `github_not_configured` and fails closed.
 */

export interface GitHubInstallOptions {
  readonly secrets: SecretBrokerPort;
  readonly stateSecretRef: string;
  readonly appSlug: string;
}

export interface GitHubInstallFlowStart {
  readonly state: string;
  readonly installUrl: string;
}

export interface GitHubInstallComposition {
  readonly appSlug: string;
  startFlow(input: { userId: string; nonce: string; nowMs: number }): Promise<GitHubInstallFlowStart>;
  verifyFlow(input: { state: string; nowMs: number }): Promise<VerifiedInstallState>;
  assertCallback(input: { installationId: string; setupAction: string }): InstallSetupAction;
}

export function composeGitHubInstall(options: GitHubInstallOptions): GitHubInstallComposition {
  // Fail fast at startup: a half-wired install entry never serves traffic.
  assertAppSlug(options.appSlug);
  return {
    appSlug: options.appSlug,
    startFlow: async (input): Promise<GitHubInstallFlowStart> => {
      const secret = await options.secrets.readCredential(options.stateSecretRef);
      const state = mintInstallState({
        userId: input.userId,
        nonce: input.nonce,
        nowMs: input.nowMs,
        secret,
      });
      return { state, installUrl: buildInstallUrl({ appSlug: options.appSlug, state }) };
    },
    verifyFlow: async (input): Promise<VerifiedInstallState> => {
      const secret = await options.secrets.readCredential(options.stateSecretRef);
      return verifyInstallState({ state: input.state, nowMs: input.nowMs, secret });
    },
    assertCallback: (input): InstallSetupAction => {
      assertInstallationId(input.installationId);
      return assertSetupAction(input.setupAction);
    },
  };
}
