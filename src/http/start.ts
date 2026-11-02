import { Pool } from 'pg';

import {
  composeEmailIdentity,
  composeFileEvidence,
  composeIdentityStore,
  composeJobs,
  composeLifecycle,
  composeMapSecrets,
  composeNotifications,
  composePublicSite,
  composeQueries,
  composeSmtpDelivery,
  composeUsage,
} from '../orchestrator/index.js';
import { createHttpServer, type HttpHandle } from './server.js';
import type { AuthDeps } from './routes-auth.js';
import type { NotificationsDeps } from './routes-notifications.js';
import type { RunsDeps } from './routes-runs.js';

/**
 * Runnable HTTP entry (T-42…T-44): `node dist/http/start.js`.
 *
 * Environment: PORT (default 4179), CP_MANIFEST (default
 * config/publicsite/manifest.json), CP_DIST (default
 * apps/dashboard/dist). Account + run services wire up only when
 * DATABASE_URL is set, and then CP_SMTP_HOST, CP_SMTP_PORT,
 * CP_SMTP_SENDER, CP_CHALLENGE_SECRET (≥32 chars), and
 * CP_EVIDENCE_DIR are all required — no silent fallbacks, no
 * defaults for infrastructure.
 */

export interface StartEnv {
  readonly PORT?: string | undefined;
  readonly CP_MANIFEST?: string | undefined;
  readonly CP_DIST?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
  readonly CP_SMTP_HOST?: string | undefined;
  readonly CP_SMTP_PORT?: string | undefined;
  readonly CP_SMTP_SENDER?: string | undefined;
  readonly CP_CHALLENGE_SECRET?: string | undefined;
  readonly CP_EVIDENCE_DIR?: string | undefined;
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
): { auth: AuthDeps; runs: RunsDeps; notifications: NotificationsDeps; close: () => Promise<void> } | undefined {
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
  return {
    auth: {
      identity,
      email: composeEmailIdentity(pool, {
        delivery: composeSmtpDelivery({
          host: requiredEnv(env, 'CP_SMTP_HOST'),
          port: smtpPort,
          sender: requiredEnv(env, 'CP_SMTP_SENDER'),
          timeoutMs: 10_000,
        }),
        secrets: composeMapSecrets(new Map([['email-challenge-secret', secret]])),
        challengeSecretRef: 'email-challenge-secret',
      }),
    },
    runs: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      lifecycle,
      queries,
    },
    notifications: {
      session: { deriveContext: (input) => identity.store.deriveContext(input) },
      notifications: composedNotifications,
    },
    close: () => pool.end().then(() => undefined),
  };
}

export async function startFromEnv(env: StartEnv, rootDir: string): Promise<{ handle: HttpHandle; port: number }> {
  const port = Number(env.PORT ?? '4179');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT "${env.PORT ?? ''}" is not a TCP port; refusing to listen.`);
  }
  const wired = wireAuth(env);
  const handle = createHttpServer({
    publicSite: composePublicSite(),
    manifestPath: env.CP_MANIFEST ?? `${rootDir}/config/publicsite/manifest.json`,
    distDir: env.CP_DIST ?? `${rootDir}/apps/dashboard/dist`,
    ...(wired === undefined
      ? {}
      : { auth: wired.auth, runs: wired.runs, notifications: wired.notifications }),
  });
  await new Promise<void>((resolve, reject) => {
    handle.server.once('error', reject);
    handle.server.listen(port, '127.0.0.1', () => {
      handle.server.off('error', reject);
      resolve();
    });
  });
  const address = handle.server.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;
  process.stderr.write(`changeproof http listening on http://127.0.0.1:${bound}/\n`);
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

const invokedDirectly = process.argv[1] !== undefined && /[/\\]start\.js$/.test(process.argv[1]);
if (invokedDirectly) {
  const rootDir = process.cwd();
  const env: StartEnv = {
    PORT: process.env['PORT'],
    CP_MANIFEST: process.env['CP_MANIFEST'],
    CP_DIST: process.env['CP_DIST'],
    DATABASE_URL: process.env['DATABASE_URL'],
    CP_SMTP_HOST: process.env['CP_SMTP_HOST'],
    CP_SMTP_PORT: process.env['CP_SMTP_PORT'],
    CP_SMTP_SENDER: process.env['CP_SMTP_SENDER'],
    CP_CHALLENGE_SECRET: process.env['CP_CHALLENGE_SECRET'],
    CP_EVIDENCE_DIR: process.env['CP_EVIDENCE_DIR'],
  };
  startFromEnv(env, rootDir).catch((error: unknown) => {
    process.stderr.write(`changeproof http failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
