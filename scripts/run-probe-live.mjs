// Run T-08 Modal probe live with .env credentials loaded. Spends Modal credits.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = readFileSync('.env', 'utf8').split(/\r?\n/);
for (const line of env) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) {
  console.error('BLOCKED: MODAL_TOKEN_ID / MODAL_TOKEN_SECRET missing after .env load');
  process.exit(2);
}
console.error('credentials loaded: MODAL_TOKEN_ID len=' + process.env.MODAL_TOKEN_ID.length);
const r = spawnSync('.venv/Scripts/python.exe', ['scripts/modal_sandbox_probe.py'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
  env: process.env,
});
if (r.stdout) process.stdout.write(r.stdout);
process.exit(r.status ?? 1);
