// E2E runner: `pnpm test:e2e [spec …]`. Builds must already exist
// (`pnpm build` + `pnpm build:ui`); the runner starts the real server
// (plus disposable Postgres + Mailpit when a spec needs them), drives
// every spec in tests/e2e/specs, then tears everything down.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { launchBrowser, waitForHealth } from './helpers.mjs';
import { dockerAvailable, startInfra, stopInfra } from './infra.mjs';

const require = createRequire(fileURLToPath(new URL('../../package.json', import.meta.url)));
const pg = require('pg');

const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.env.CP_PORT ?? '4179');
const base = `http://127.0.0.1:${port}`;
const only = new Set(process.argv.slice(2));

const files = readdirSync(new URL('./specs', import.meta.url)).filter(
  (f) => f.endsWith('.mjs') && (only.size === 0 || only.has(f.replace(/\.mjs$/, ''))),
);
if (files.length === 0) throw new Error('No E2E specs matched; refusing an empty pass.');

const loaded = [];
for (const file of files) {
  const module = await import(`./specs/${file}`);
  loaded.push({ name: file.replace(/\.mjs$/, ''), ...module });
}
const needsDb = loaded.filter((spec) => spec.needsDb === true);
let infra;
if (needsDb.length > 0) {
  if (!dockerAvailable()) {
    throw new Error(
      `Specs need disposable Postgres+Mailpit but docker is unavailable: ${needsDb.map((s) => s.name).join(',')}. ` +
        'This is a missing check, never a pass.',
    );
  }
  const migrations = [...new Set(needsDb.flatMap((spec) => spec.migrations ?? []))];
  if (migrations.length === 0) throw new Error('DB specs name no migrations; refusing to guess the schema.');
  infra = await startInfra(rootDir, migrations, pg);
}

const serverEnv = { ...process.env, PORT: String(port) };
if (infra !== undefined) {
  serverEnv.DATABASE_URL = infra.appDatabaseUrl;
  serverEnv.CP_SMTP_HOST = '127.0.0.1';
  serverEnv.CP_SMTP_PORT = infra.mailSmtpPort;
  serverEnv.CP_SMTP_SENDER = 'e2e@changeproof.test';
  serverEnv.CP_CHALLENGE_SECRET = randomBytes(48).toString('base64url');
  serverEnv.CP_EVIDENCE_DIR = infra.evidenceDir;
}
// Optional GitHub sign-in on the disposable stack: forwarded only when the
// id and secret are both set in the invoking environment (a partial set
// stays disabled rather than half-wired). The redirect defaults to this
// run's own callback; override it only with a URL registered on the App.
const githubId = process.env.CP_GITHUB_CLIENT_ID ?? '';
const githubSecret = process.env.CP_GITHUB_CLIENT_SECRET ?? '';
const githubRedirect =
  process.env.CP_GITHUB_REDIRECT_URL ?? `http://127.0.0.1:${port}/api/auth/github/callback`;
if (githubId !== '' && githubSecret !== '') {
  serverEnv.CP_GITHUB_CLIENT_ID = githubId;
  serverEnv.CP_GITHUB_CLIENT_SECRET = githubSecret;
  serverEnv.CP_GITHUB_REDIRECT_URL = githubRedirect;
}
const server = spawn(process.execPath, ['dist/http/start.js'], {
  cwd: rootDir,
  env: {
    ...serverEnv,
    CP_MANIFEST: `${rootDir}/config/publicsite/manifest.json`,
    CP_DIST: `${rootDir}/apps/dashboard/dist`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => (serverOutput += chunk));
server.stderr.on('data', (chunk) => (serverOutput += chunk));

let failures = 0;
try {
  await waitForHealth(base);
  const browser = await launchBrowser();
  try {
    for (const spec of loaded) {
      const context = await browser.newContext();
      try {
        await spec.spec({
          base,
          context,
          rootDir,
          browser,
          mailApi: infra?.mailApi,
          databaseUrl: infra?.databaseUrl,
          evidenceDir: infra?.evidenceDir,
        });
        console.log(`e2e ok: ${spec.name}`);
      } catch (error) {
        failures += 1;
        console.error(`e2e FAIL: ${spec.name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (server.exitCode === null) server.kill('SIGKILL');
  if (infra !== undefined) stopInfra(infra.evidenceDir);
}
if (failures > 0) {
  console.error(`e2e: ${failures} spec(s) failed.\n--- server output ---\n${serverOutput}`);
  process.exitCode = 1;
} else {
  console.log('e2e: all specs passed.');
}
