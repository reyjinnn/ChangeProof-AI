// Clean full-campaign reproduction runner (phase-7 slice T-54, not product code).
//
// Re-executes an ENTIRE frozen campaign from a manifest in a CLEAN directory:
// fresh services/data, no original workspace, no candidate build cache.
// Immutable inputs (fixture files, toolchain packages) are hash-verified and
// reusable; observations from the original run are never read.
//
// Usage:
//   node scripts/reproduce-campaign.mjs --manifest <path> --work-dir <path>
//     [--database-url postgresql://...] [--redis-url redis://...]
//
// Manifest shape (schemaVersion "t54-repro/1"):
//   { case, frozen:boolean, plan:{n,warmupTrials,version,orders,budgetMs,
//     trialTimeoutMs}, inputs:{fixtureDir,files:{name:sha256}},
//     candidateBundleDigest, environmentIdentity,
//     database:{probeDb,redisDb}, expect:{verdict,counts} }
//
// Exit 0 iff the re-executed counts match manifest.expect exactly; exit 1 on
// any mismatch; exit 2 on usage/validation failure (fail closed). A manifest
// with frozen:false is a mechanics check only, never reproduction evidence.
// Fault-bearing manifests are refused: this runner has no fault injector.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { createClient } from 'redis';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function fail(message) {
  console.error(`reproduce-campaign: ${message}`);
  process.exit(2);
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runChild(command, args, { timeoutMs, cwd }) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code ?? -1, timedOut, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

function waitForLine(proc, needle, timeoutMs, label) {
  return new Promise((resolvePromise, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
    proc.stdout?.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const line = buffer.split('\n').find((entry) => entry.includes(needle));
      if (line !== undefined) {
        clearTimeout(timer);
        resolvePromise(line);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Process exited (${String(code)}) before ${label}.`));
    });
  });
}

async function stopChild(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolvePromise(undefined);
    }, 5000);
    proc.on('exit', () => {
      clearTimeout(timer);
      resolvePromise(undefined);
    });
  });
}

const manifestPath = arg('manifest');
const workDirArg = arg('work-dir');
if (manifestPath === undefined || workDirArg === undefined) {
  fail('usage: reproduce-campaign.mjs --manifest <path> --work-dir <path> [--database-url U] [--redis-url R]');
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
} catch {
  fail(`cannot read manifest ${manifestPath}.`);
}

if (manifest.schemaVersion !== 't54-repro/1') fail('manifest.schemaVersion must be "t54-repro/1".');
if (typeof manifest.frozen !== 'boolean') fail('manifest.frozen (boolean) is required.');
if (manifest.plan?.fault !== undefined) {
  fail('fault-bearing campaigns need supervisor topology control; unsupported by this runner.');
}
const plan = manifest.plan ?? {};
const n = plan.n;
const warmupTrials = plan.warmupTrials ?? 0;
if (!Number.isInteger(n) || n <= 0) fail('manifest.plan.n must be a positive integer.');
if (!Number.isInteger(warmupTrials) || warmupTrials < 0) fail('manifest.plan.warmupTrials must be >= 0.');
if (plan.version !== 'v1' && plan.version !== 'v2') fail('manifest.plan.version must be "v1" or "v2".');
for (const key of ['orders', 'budgetMs', 'trialTimeoutMs']) {
  if (!Number.isInteger(plan[key]) || plan[key] <= 0) fail(`manifest.plan.${key} must be a positive integer.`);
}
if (!/^[0-9a-f]{64}$/.test(manifest.candidateBundleDigest ?? '')) fail('manifest.candidateBundleDigest must be sha256 hex.');
if (typeof manifest.environmentIdentity !== 'string' || manifest.environmentIdentity.length === 0) {
  fail('manifest.environmentIdentity is required.');
}
const probeDb = manifest.database?.probeDb;
const redisDb = manifest.database?.redisDb;
if (typeof probeDb !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(probeDb)) fail('manifest.database.probeDb is not a safe identifier.');
if (!Number.isInteger(redisDb) || redisDb < 0 || redisDb > 15) fail('manifest.database.redisDb must be 0-15.');
const files = manifest.inputs?.files ?? {};
const fixtureDir = resolve(rootDir, manifest.inputs?.fixtureDir ?? '');
const wanted = ['service.mjs', 'consumer.mjs', 'trial.mjs', 'reset.mjs', 'schema.sql'];
for (const name of wanted) {
  if (!/^[0-9a-f]{64}$/.test(files[name] ?? '')) fail(`manifest.inputs.files["${name}"] must be sha256 hex.`);
}

const databaseUrl = arg('database-url') ?? process.env.DATABASE_URL;
const redisUrl = arg('redis-url') ?? process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) fail('missing --database-url / --redis-url (or DATABASE_URL / REDIS_URL).');

// ---- Clean-directory enforcement: no original workspace, no build cache.
const workDir = resolve(workDirArg);
for (const forbidden of [join(rootDir, 'fixtures'), join(rootDir, 'runs', 'sc3-baseline'), join(rootDir, 'runs', 'sc3-18')]) {
  if (workDir === forbidden || isInside(workDir, forbidden)) {
    fail(`work-dir ${workDir} is inside original workspace ${forbidden}; refusing.`);
  }
}
try {
  const entries = readdirSync(workDir);
  if (entries.length > 0) fail(`work-dir ${workDir} is not empty; refusing to reuse it.`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
mkdirSync(workDir, { recursive: true });
const inputsDir = join(workDir, 'inputs');
const receiptsDir = join(workDir, 'receipts');
mkdirSync(inputsDir, { recursive: true });
mkdirSync(receiptsDir, { recursive: true });

// ---- Immutable inputs: hash-verify, then copy. Nothing else is read.
for (const name of wanted) {
  const source = join(fixtureDir, name);
  const actual = sha256File(source);
  if (actual !== files[name]) fail(`input ${name} hash mismatch: manifest pins a different immutable input.`);
  copyFileSync(source, join(inputsDir, name));
}
if (manifest.frozen === false) {
  console.warn('WARNING: manifest.frozen is false — mechanics check only, NOT reproduction evidence.');
}

const fileDbUrl = new URL(databaseUrl);
fileDbUrl.pathname = `/${probeDb}`;
const fileRedisUrl = new URL(redisUrl);
fileRedisUrl.pathname = `/${String(redisDb)}`;

const children = [];
process.on('SIGTERM', () => {
  for (const child of children) child.kill('SIGTERM');
});
try {
  // ---- Fresh data: own database + own redis db, created empty here.
  const admin = new pg.Pool({ connectionString: databaseUrl });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${probeDb}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${probeDb}"`);
  } finally {
    await admin.end();
  }
  const adminDb = new pg.Pool({ connectionString: fileDbUrl.toString() });
  const redis = createClient({ url: fileRedisUrl.toString() });
  try {
    await redis.connect();
    await redis.flushDb();
    await adminDb.query(readFileSync(join(inputsDir, 'schema.sql'), 'utf8'));

    // ---- Fresh services from the clean copy (ephemeral port).
    const service = spawn(
      process.execPath,
      [join(inputsDir, 'service.mjs'), '--port', '0', '--version', plan.version,
        '--database-url', fileDbUrl.toString(), '--redis-url', fileRedisUrl.toString()],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    children.push(service);
    const listening = await waitForLine(service, '"event":"listening"', 15000, 'service listening');
    const port = JSON.parse(listening).port;
    const consumer = spawn(
      process.execPath,
      [join(inputsDir, 'consumer.mjs'), '--database-url', fileDbUrl.toString(), '--redis-url', fileRedisUrl.toString()],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    children.push(consumer);
    await waitForLine(consumer, '"event":"consumer-ready"', 15000, 'consumer ready');
    const serviceUrl = `http://127.0.0.1:${String(port)}`;

    const warmup = [];
    for (let w = 0; w < warmupTrials; w += 1) {
      const reset = await runChild(process.execPath,
        [join(inputsDir, 'reset.mjs'), '--database-url', fileDbUrl.toString(), '--redis-url', fileRedisUrl.toString()],
        { timeoutMs: 15000, cwd: workDir });
      const trial = await runChild(process.execPath,
        [join(inputsDir, 'trial.mjs'), '--service-url', serviceUrl, '--orders', String(plan.orders),
          '--budget-ms', String(plan.budgetMs)],
        { timeoutMs: plan.trialTimeoutMs, cwd: workDir });
      warmup.push({ index: w, resetExitCode: reset.exitCode, trialExitCode: trial.exitCode });
    }

    const receipts = [];
    for (let t = 0; t < n; t += 1) {
      const reset = await runChild(process.execPath,
        [join(inputsDir, 'reset.mjs'), '--database-url', fileDbUrl.toString(), '--redis-url', fileRedisUrl.toString()],
        { timeoutMs: 15000, cwd: workDir });
      let result = 'fail';
      let timedOut = false;
      if (reset.exitCode !== 0) {
        result = 'invalid';
      } else {
        const trial = await runChild(process.execPath,
          [join(inputsDir, 'trial.mjs'), '--service-url', serviceUrl, '--orders', String(plan.orders),
            '--budget-ms', String(plan.budgetMs)],
          { timeoutMs: plan.trialTimeoutMs, cwd: workDir });
        timedOut = trial.timedOut;
        result = trial.exitCode === 0 ? 'pass' : 'fail';
      }
      const receipt = {
        schemaVersion: 't54-repro/1',
        case: manifest.case,
        trial: t,
        candidateBundleDigest: manifest.candidateBundleDigest,
        environmentIdentity: manifest.environmentIdentity,
        resetExitCode: reset.exitCode,
        resetStderrTail: reset.stderr.slice(-2000),
        trialTimedOut: timedOut,
        result,
      };
      receipts.push(receipt);
      writeFileSync(join(receiptsDir, `trial-${String(t).padStart(3, '0')}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    }

    const counts = {
      planned: n,
      completed: receipts.filter((r) => r.result === 'pass').length,
      failed: receipts.filter((r) => r.result === 'fail').length,
      invalid: receipts.filter((r) => r.result === 'invalid').length,
      censored: 0,
      notRun: 0,
    };
    const verdict = counts.invalid > 0 ? 'experiment_invalid' : counts.failed > 0 ? 'failed' : 'campaign_complete';
    const summary = {
      schemaVersion: 't54-repro/1',
      case: manifest.case,
      frozen: manifest.frozen,
      workDir,
      inputsVerified: wanted,
      warmup,
      counts,
      verdict,
      expect: manifest.expect ?? null,
    };
    writeFileSync(join(workDir, 'reproduction-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

    const expect = manifest.expect;
    const match =
      expect !== undefined &&
      expect.verdict === verdict &&
      expect.counts !== undefined &&
      ['planned', 'completed', 'failed', 'invalid', 'censored', 'notRun'].every(
        (key) => expect.counts[key] === counts[key],
      );
    console.log(JSON.stringify({ verdict, counts, match }));
    if (!match) {
      console.error('reproduce-campaign: re-executed counts do not match manifest.expect.');
      process.exitCode = 1;
    }
  } finally {
    await redis.flushDb().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await adminDb.end().catch(() => undefined);
  }
  const cleanup = new pg.Pool({ connectionString: databaseUrl });
  try {
    await cleanup.query(`DROP DATABASE IF EXISTS "${probeDb}" WITH (FORCE)`);
  } finally {
    await cleanup.end();
  }
} finally {
  for (const child of children.splice(0)) {
    await stopChild(child);
  }
}
