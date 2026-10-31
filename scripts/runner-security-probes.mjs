#!/usr/bin/env node
/**
 * T-08 / WP3-04 -- native runner-security probes on a Modal Sandbox.
 *
 * Real mode spends Modal credits and needs MODAL_TOKEN_ID /
 * MODAL_TOKEN_SECRET in the environment. `--dry-run` spends nothing and
 * proves wiring only -- it is NOT qualification evidence.
 *
 * Exit codes: 0 = receipt with verdict "pass"; 1 = receipt with verdict
 * "fail"/"inconclusive" (evidence, still written); 2 = fail-closed config
 * error, no probe ran, nothing to claim.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const helper = resolve(here, 'modal_sandbox_probe.py');
const runsDir = resolve(root, 'runs');

function venvPython() {
  const win = resolve(root, '.venv', 'Scripts', 'python.exe');
  const nix = resolve(root, '.venv', 'bin', 'python');
  if (process.platform === 'win32') return win;
  return nix;
}

function out(line) {
  process.stdout.write(`${line}\n`);
}

function failClosed(message) {
  process.stderr.write(`runner-security-probes: BLOCKED -- ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const i = argv.indexOf('--out');
  return {
    dryRun: argv.includes('--dry-run'),
    out: i >= 0 ? argv[i + 1] : undefined,
  };
}

function main() {
  const { dryRun, out: outOpt } = parseArgs(process.argv.slice(2));
  if (!existsSync(helper)) failClosed(`helper missing: ${helper}`);
  const python = venvPython();
  if (!existsSync(python)) {
    failClosed(
      `project venv python missing: ${python}. Create it with "py -m venv .venv" and run ".venv/Scripts/python -m pip install modal".`,
    );
  }
  const args = [helper];
  if (dryRun) args.push('--dry-run');
  // List-form spawn only: no shell, no string interpolation into a command.
  const child = spawnSync(python, args, { encoding: 'utf8', timeout: 600000 });
  if (child.error) failClosed(`could not start probe helper: ${child.error.message}`);
  if (child.stderr) process.stderr.write(child.stderr);
  let doc;
  try {
    doc = JSON.parse(String(child.stdout).trim().split('\n').at(-1));
  } catch {
    failClosed(`helper did not emit a JSON document (exit ${child.status}).`);
  }
  if (dryRun || doc.mode === 'dry-run') {
    out('DRY RUN -- wiring only, NOT qualification evidence. No credit spent.');
    out(JSON.stringify(doc, null, 2));
    process.exit(0);
  }
  if (doc.ok === false) {
    // Fail-closed from the helper: no probe ran, nothing to claim.
    process.exit(2);
  }
  mkdirSync(runsDir, { recursive: true });
  const target = resolve(runsDir, `runner-security-probes.${doc.runId}.json`);
  if (outOpt !== undefined) {
    const custom = resolve(runsDir, outOpt);
    if (!custom.startsWith(runsDir + sep)) failClosed('--out must stay inside runs/.');
    writeFileSync(custom, `${JSON.stringify(doc, null, 2)}\n`);
    out(`receipt: ${custom}`);
  } else {
    writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`);
    out(`receipt: ${target}`);
  }
  out(`verdict: ${doc.verdict}`);
  process.exit(doc.verdict === 'pass' ? 0 : 1);
}

main();
