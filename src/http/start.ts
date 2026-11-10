import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

import { Pool } from 'pg';

import {
  composeAdapterCapabilities,
  composeCollaboration,
  composeDistribution,
  composeEmailIdentity,
  composeFileEvidence,
  composeGitHub,
  composeGitHubAuth,
  composeGitHubInstall,
  composeInstallationConnect,
  composeIdentityStore,
  composeJobs,
  composeLifecycle,
  composeMapSecrets,
  composeNotifications,
  composePublicSite,
  composeQueries,
  composeSmtpDelivery,
  composeSupport,
  composeUsage,
} from '../orchestrator/index.js';
import { createHttpServer, type HttpHandle } from './server.js';
import type { AuthDeps } from './routes-auth.js';
import type { EnterpriseDeps } from './routes-enterprise.js';
import type { NotificationsDeps } from './routes-notifications.js';
import type { RunsDeps } from './routes-runs.js';
import type { TeamworkDeps } from './routes-teamwork.js';

/**
 * Runnable HTTP entry (T-42…T-44): `node dist/http/start.js`.
 *
 * Environment: PORT (default 4179), HOST (default 127.0.0.1; set
 * 0.0.0.0 only to expose the server from a container), CP_MANIFEST (default
 * config/publicsite/manifest.json), CP_DIST (default
 * apps/dashboard/dist). Account + run services wire up only when
 * DATABASE_URL is set, and then CP_SMTP_HOST, CP_SMTP_PORT,
 * CP_SMTP_SENDER, CP_CHALLENGE_SECRET (≥32 chars), and
 * CP_EVIDENCE_DIR are all required — no silent fallbacks, no
 * defaults for infrastructure. GitHub sign-in (FR3-29) enables only
 * when CP_GITHUB_CLIENT_ID, CP_GITHUB_CLIENT_SECRET, and
 * CP_GITHUB_REDIRECT_URL are all set; a partial set refuses startup.
 * Repository authority (FR3-30) wires only when CP_GITHUB_INSTALLATION_TOKEN
 * is set; without it providers report `githubApp: false`. Alternatively the
 * GitHub App id plus its private key file (CP_GITHUB_APP_ID and
 * CP_GITHUB_APP_KEY_FILE, both or neither) enable mint-on-demand
 * installation tokens for the connect endpoint. CP_GITHUB_APP_SLUG
 * (the public github.com/apps/<slug> name) enables the one-click
 * install entry; without it only manual installation ids connect.
 */

export interface StartEnv {
  readonly PORT?: string | undefined;
  readonly HOST?: string | undefined;
  readonly CP_MANIFEST?: string | undefined;
  readonly CP_DIST?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly CP_SMTP_HOST?: string | undefined;
  readonly CP_SMTP_PORT?: string | undefined;
  readonly CP_SMTP_SENDER?: string | undefined;
  readonly CP_CHALLENGE_SECRET?: string | undefined;
  readonly CP_EVIDENCE_DIR?: string | undefined;
  readonly CP_GITHUB_CLIENT_ID?: string | undefined;
  readonly CP_GITHUB_CLIENT_SECRET?: string | undefined;
  readonly CP_GITHUB_REDIRECT_URL?: string | undefined;
  readonly CP_GITHUB_INSTALLATION_TOKEN?: string | undefined;
  readonly CP_GITHUB_APP_ID?: string | undefined;
  readonly CP_GITHUB_APP_KEY_FILE?: string | undefined;
  readonly CP_GITHUB_APP_SLUG?: string | undefined;
}

function requiredEnv(
  env: StartEnv,
  name: 'CP_SMTP_HOST' | 'CP_SMTP_PORT' | 'CP_SMTP_SENDER' | 'CP_CHALLENGE_SECRET' | 'CP_EVIDENCE_DIR',
): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required when DATABASE_URL is set; refusing to start half-wired.`);
  }
  return value;
}

function wireAuth(
  env: StartEnv,
): { auth: AuthDeps; runs: RunsDeps; notifications: NotificationsDeps; teamwork: TeamworkDeps; enterprise: EnterpriseDeps; close: () => Promise<void> } | undefined {
  if (env.DATABASE_URL === undefined || env.DATABASE_URL === '') return undefined;
  const secret = requiredEnv(env, 'CP_CHALLENGE_SECRET');
  if (secret.length < 32) {
    throw new Error('CP_CHALLENGE_SECRET must be at least 32 characters; refusing a weak HMAC secret.');
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const smtpPort = Number(requiredEnv(env, 'CP_SMTP_PORT'));
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error('CP_SMTP_PORT is not a TCP port; refusing to start half-wired.');
  }
  const githubClientId = env.CP_GITHUB_CLIENT_ID ?? '';
  const githubClientSecret = env.CP_GITHUB_CLIENT_SECRET ?? '';
  const githubRedirectUrl = env.CP_GITHUB_REDIRECT_URL ?? '';
  const githubAny = githubClientId !== '' || githubClientSecret !== '' || githubRedirectUrl !== '';
  const githubAll = githubClientId !== '' && githubClientSecret !== '' && githubRedirectUrl !== '';
  if (githubAny && !githubAll) {
    throw new Error(
      'CP_GITHUB_CLIENT_ID, CP_GITHUB_CLIENT_SECRET, and CP_GITHUB_REDIRECT_URL must all be set together; refusing to start half-wired.',
    );
  }
  const identity = composeIdentityStore(pool);
  const usage = composeUsage(pool);
  const jobs = composeJobs(pool);
  const evidence = composeFileEvidence(requiredEnv(env, 'CP_EVIDENCE_DIR'));
  const lifecycle = composeLifecycle(pool, {
    identity: identity.store,
    usage: usage.store,
    jobs: jobs.store,
    evidence: evidence.store,
  });
  const queries = composeQueries(pool, { identity: identity.store, lifecycle: lifecycle.store });
  const composedNotifications = composeNotifications(pool, identity.store);
  // BYOK values arrive out-of-band (CLI secrets file, vault/KMS in
  // production); the runtime map starts empty and provision fails closed
  // until a broker the process can read holds the ref.
  const distribution = composeDistribution({ db: pool, maintenanceDb: pool, secrets: composeMapSecrets(new Map()) });
  // One process broker map: the HMAC challenge secret plus, when the
  // operator configured an OAuth App, the GitHub client secret. Values are
  // read from the environment once here and never leave the broker.
  const githubAppId = env.CP_GITHUB_APP_ID ?? '';
  const githubAppKeyFile = env.CP_GITHUB_APP_KEY_FILE ?? '';
  if ((githubAppId === '') !== (githubAppKeyFile === '')) {
    throw new Error(
      'CP_GITHUB_APP_ID and CP_GITHUB_APP_KEY_FILE must both be set together; refusing to start half-wired.',
    );
  }
  let githubAppKey = '';
  if (githubAppKeyFile !== '') {
    try {
      githubAppKey = readFileSync(githubAppKeyFile, 'utf8');
    } catch {
      throw new Error(`CP_GITHUB_APP_KEY_FILE points at an unreadable file ("${githubAppKeyFile}"); refusing to start.`);
    }
    if (!githubAppKey.includes('PRIVATE KEY')) {
      throw new Error('CP_GITHUB_APP_KEY_FILE does not look like a PEM private key; refusing to start.');
    }
  }
  const githubAppSlug = env.CP_GITHUB_APP_SLUG ?? '';
  const installationToken = env.CP_GITHUB_INSTALLATION_TOKEN ?? '';
  const secrets = composeMapSecrets(
    new Map([
      ['email-challenge-secret', secret],
      ...(githubAll ? [['github-client-secret', githubClientSecret] as const] : []),
      ...(installationToken !== '' ? [['github-installation-token', installationToken] as const] : []),
      ...(githubAppKey !== '' ? [['github-app-key', githubAppKey] as const] : []),
    ]),
  );
  return {
    auth: {
      identity,
      usage: { store: usage.store },
      email: composeEmailIdentity(pool, {
        delivery: composeSmtpDelivery({
          host: requiredEnv(env, 'CP_SMTP_HOST'),
          port: smtpPort,
          sender: requiredEnv(env, 'CP_SMTP_SENDER'),
          timeoutMs: 10_000,
        }),
        secrets,
        challengeSecretRef: 'email-challenge-secret',
      }),
      // Repository authority is available with a static installation token
      // or with App credentials (tokens are then minted on demand by the
      // connect endpoint); the static-token client below stays dormant
      // when only the App key is configured.
      ...((installationToken !== '' || githubAppKey !== '') ? { githubApp: composeGitHub(secrets) } : {}),
      ...(githubAll
        ? {
            github: composeGitHubAuth({
              db: pool,
              secrets,
              clientId: githubClientId,
              redirectUri: githubRedirectUrl,
              clientSecretRef: 'github-client-secret',
              // State HMAC reuses the challenge secret under a distinct
              // purpose label (`github_oauth`); domain separation by purpose.
              stateSecretRef: 'email-challenge-secret',
            }),
          }
        : {}),
    },
    runs: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      lifecycle,
      queries,
      ...(githubAppKey !== ''
        ? { githubConnect: composeInstallationConnect({ secrets, keyRef: 'github-app-key', appId: githubAppId }) }
        : {}),
      ...(githubAppSlug !== ''
        ? {
            githubInstall: composeGitHubInstall({
              secrets,
              stateSecretRef: 'email-challenge-secret',
              appSlug: githubAppSlug,
            }),
          }
        : {}),
    },
    notifications: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      notifications: composedNotifications,
    },
    teamwork: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      support: composeSupport(pool, { identity: identity.store, jobs: jobs.store }),
      collaboration: composeCollaboration(pool, {
        identity: identity.store,
        notifications: composedNotifications.store,
      }),
      capabilities: composeAdapterCapabilities().registry,
    },
    enterprise: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      usage: { store: usage.store },
      byok: { store: distribution.byok, secrets: distribution.secrets },
      saml: { store: identity.saml },
      scim: { store: identity.scim },
    },
    close: () => pool.end().then(() => undefined),
  };
}

export async function startFromEnv(env: StartEnv, rootDir: string): Promise<{ handle: HttpHandle; port: number }> {
  const port = Number(env.PORT ?? '4179');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT "${env.PORT ?? ''}" is not a TCP port; refusing to listen.`);
  }
  const host = env.HOST ?? '127.0.0.1';
  if (isIP(host) === 0) {
    throw new Error(`HOST "${host}" is not an IP literal; refusing to listen.`);
  }
  const wired = wireAuth(env);
  const handle = createHttpServer({
    publicSite: composePublicSite(),
    manifestPath: env.CP_MANIFEST ?? `${rootDir}/config/publicsite/manifest.json`,
    distDir: env.CP_DIST ?? `${rootDir}/apps/dashboard/dist`,
    ...(wired === undefined
      ? {}
      : { auth: wired.auth, runs: wired.runs, notifications: wired.notifications, teamwork: wired.teamwork, enterprise: wired.enterprise }),
  });
  await new Promise<void>((resolve, reject) => {
    handle.server.once('error', reject);
    handle.server.listen(port, host, () => {
      handle.server.off('error', reject);
      resolve();
    });
  });
  const address = handle.server.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;
  process.stderr.write(`changeproof http listening on http://${host}:${bound}/\n`);
  const shutdown = (): void => {
    void handle
      .close()
      .catch(() => undefined)
      .then(() => wired?.close().catch(() => undefined))
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return { handle, port: bound };
}

/**
 * Explicit process-env allowlist for the server. Every StartEnv field must
 * appear here, or the value silently never reaches the server (this exact
 * gap once dropped the GitHub App credentials); the test below pins the
 * full key set so the next addition cannot forget.
 */
export function buildStartEnv(source: NodeJS.ProcessEnv): StartEnv {
  return {
    PORT: source['PORT'],
    HOST: source['HOST'],
    CP_MANIFEST: source['CP_MANIFEST'],
    CP_DIST: source['CP_DIST'],
    DATABASE_URL: source['DATABASE_URL'],
    CP_SMTP_HOST: source['CP_SMTP_HOST'],
    CP_SMTP_PORT: source['CP_SMTP_PORT'],
    CP_SMTP_SENDER: source['CP_SMTP_SENDER'],
    CP_CHALLENGE_SECRET: source['CP_CHALLENGE_SECRET'],
    CP_EVIDENCE_DIR: source['CP_EVIDENCE_DIR'],
    CP_GITHUB_CLIENT_ID: source['CP_GITHUB_CLIENT_ID'],
    CP_GITHUB_CLIENT_SECRET: source['CP_GITHUB_CLIENT_SECRET'],
    CP_GITHUB_REDIRECT_URL: source['CP_GITHUB_REDIRECT_URL'],
    CP_GITHUB_INSTALLATION_TOKEN: source['CP_GITHUB_INSTALLATION_TOKEN'],
    CP_GITHUB_APP_ID: source['CP_GITHUB_APP_ID'],
    CP_GITHUB_APP_KEY_FILE: source['CP_GITHUB_APP_KEY_FILE'],
    CP_GITHUB_APP_SLUG: source['CP_GITHUB_APP_SLUG'],
  };
}

const invokedDirectly = process.argv[1] !== undefined && /[/\\]start\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  const rootDir = process.cwd();
  startFromEnv(buildStartEnv(process.env), rootDir).catch((error: unknown) => {
    process.stderr.write(`changeproof http failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
