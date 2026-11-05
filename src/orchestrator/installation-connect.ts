import { MissingConfigurationError, type SecretBrokerPort } from '../core/index.js';
import {
  exchangeInstallationToken,
  mintAppJwt,
  octokitTransport,
  type AccessibleRepository,
} from '../modules/github/index.js';

/**
 * Installation connect wiring (WP3-22).
 *
 * The composition root injects the broker-held App key, the public App id,
 * and the network seam; it adds no GitHub behavior of its own. Each connect
 * mints a fresh JWT, exchanges one short-lived installation token (never
 * stored), and lists what that installation can actually see — the
 * resulting repository list is verified provider data, not operator claims.
 */

export interface InstallationConnectOptions {
  readonly secrets: SecretBrokerPort;
  readonly keyRef: string;
  readonly appId: string;
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface InstallationConnectResult {
  readonly installationId: string;
  readonly repositories: readonly AccessibleRepository[];
}

export interface InstallationConnectComposition {
  connect(installationId: string, nowMs: number): Promise<InstallationConnectResult>;
}

function missingKey(keyRef: string): MissingConfigurationError {
  return new MissingConfigurationError(
    'CP_GITHUB_APP_KEY_FILE',
    `secret broker ref "${keyRef}"`,
    'Provision the GitHub App private key out-of-band; installation connect cannot mint tokens without it.',
  );
}

export function composeInstallationConnect(options: InstallationConnectOptions): InstallationConnectComposition {
  return {
    connect: async (installationId: string, nowMs: number): Promise<InstallationConnectResult> => {
      let key: string;
      try {
        key = await options.secrets.readCredential(options.keyRef);
      } catch {
        throw missingKey(options.keyRef);
      }
      if (key.length === 0) {
        throw missingKey(options.keyRef);
      }
      const jwt = mintAppJwt({ appId: options.appId, privateKeyPem: key, nowMs });
      const { token } = await exchangeInstallationToken({
        installationId,
        jwt,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      });
      const repositories = await octokitTransport(token, options.fetchImpl).listAccessibleRepositories();
      return { installationId, repositories };
    },
  };
}
