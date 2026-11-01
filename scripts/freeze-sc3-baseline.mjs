// Freeze ceremony tool for the SC3-01 baseline slice (owner-run).
//
// Hashes the approved intent file and every scope file, then writes a
// FrozenOracle-shaped record. The person running this command with their own
// identity IS the freeze; an agent must never run it as the acceptance author.
// A `--author probe-*` run is a mechanics check only, never an oracle.
//
// Usage: node scripts/freeze-sc3-baseline.mjs --author <owner-id>
//   --intent <path> --scope <path> [--scope <path>...] --out <path>
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function args(name) {
  const out = [];
  for (let at = 0; at < process.argv.length; at += 1) {
    if (process.argv[at] === `--${name}` && at + 1 < process.argv.length) {
      out.push(process.argv[at + 1]);
    }
  }
  return out;
}

const author = args('author')[0] ?? '';
const intent = args('intent')[0] ?? '';
const scopes = args('scope');
const out = args('out')[0] ?? '';
if (author.length === 0 || intent.length === 0 || scopes.length === 0 || out.length === 0) {
  console.error('usage: freeze-sc3-baseline.mjs --author <id> --intent <f> --scope <f>... --out <f>');
  process.exit(2);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const scopeLines = scopes.map((path) => `${path}:${sha256File(path)}`).sort();
const scopeDigest = createHash('sha256').update(scopeLines.join('\n'), 'utf8').digest('hex');
const oracleDigest = sha256File(intent);
const record = {
  schemaVersion: '1',
  oracleDigest,
  frozenOracleDigest: oracleDigest,
  authorId: author,
  frozenAt: new Date().toISOString(),
  scopeDigest,
  scopeFiles: scopeLines,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
if (author.startsWith('probe-')) {
  console.warn('WARNING: probe author — mechanics check only, NOT a frozen oracle.');
}
console.log(JSON.stringify({ frozenOracleDigest: record.frozenOracleDigest, scopeDigest, out }));
