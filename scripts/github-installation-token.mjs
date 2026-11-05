#!/usr/bin/env node
// Mint a short-lived GitHub App installation token (P2 live-proof operator tooling).
//
// Usage:
//   node scripts/github-installation-token.mjs --app-id=<n> --key-file=<pem> --installation-id=<n>
//
// Stdout carries the token only — append it to .env as CP_GITHUB_INSTALLATION_TOKEN
// and run github-probe promptly: the token expires after 1 hour. Diagnostics go
// to stderr. The private key is read locally and never transmitted (only the
// JWT signature leaves this machine). Exit 2 on any refusal.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const USAGE =
  'node scripts/github-installation-token.mjs --app-id=<n> --key-file=<pem> --installation-id=<n>';

function fail(message) {
  console.error(`github-installation-token: BLOCKED — ${message}`);
  process.exit(2);
}

const flags = {};
for (const arg of process.argv.slice(2)) {
  const match = /^--([a-zA-Z][a-zA-Z-]*)=([\s\S]*)$/.exec(arg);
  if (!match || !match[1] || !match[2]) fail(`malformed flag "${arg}". ${USAGE}`);
  flags[match[1]] = match[2];
}
for (const key of ['app-id', 'key-file', 'installation-id']) {
  if (!flags[key]) fail(`missing --${key}=<value>. ${USAGE}`);
}
for (const key of ['app-id', 'installation-id']) {
  if (!/^[1-9][0-9]*$/.test(flags[key])) fail(`--${key} must be a positive integer.`);
}

let keyPem;
try {
  keyPem = readFileSync(flags['key-file'], 'utf8');
} catch {
  fail(`cannot read key file "${flags['key-file']}".`);
}
if (!keyPem.includes('PRIVATE KEY')) fail('key file does not look like a PEM private key.');

const now = Math.floor(Date.now() / 1000);
const base64url = (value) => Buffer.from(value).toString('base64url');
const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const payload = base64url(
  JSON.stringify({ iat: now - 60, exp: now + 540, iss: flags['app-id'] }),
);
let jwt;
try {
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  jwt = `${header}.${payload}.${signer.sign(keyPem, 'base64url')}`;
} catch {
  fail('could not sign the App JWT with this key.');
}

let response;
try {
  response = await fetch(
    `https://api.github.com/app/installations/${flags['installation-id']}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'changeproof-probe',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
} catch {
  fail('api.github.com is unreachable; retry later.');
}
if (response.status !== 200 && response.status !== 201) {
  fail(`GitHub answered HTTP ${response.status}; check the App id, key, and installation.`);
}
const body = await response.json().catch(() => undefined);
const token = body && typeof body === 'object' ? body.token : undefined;
if (typeof token !== 'string' || token.length === 0) {
  fail('GitHub returned no token; check the installation.');
}
process.stdout.write(`${token}\n`);
