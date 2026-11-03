import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertLegacyRepairAllowed,
  diagnoseLegacy,
  freezeLegacyCorpus,
  freezeLegacyIntent,
  recordLegacyBaseline,
} from '../../src/modules/fixtures/index.js';

/**
 * WP3-20 / T-36 — legacy characterization over a real fixture tree (native).
 *
 * A read-only probe inventories entrypoints, jobs, configs, and dynamic SQL
 * markers under `fixtures/sc3-baseline` and proves it wrote nothing by
 * hashing every file before and after. Without owner approval the only exit
 * is diagnosis-only (`behavior_contract_unknown`, no mutation); with a
 * fixture owner approval plus an independent validator the repair gate opens.
 * The fixture approval exercises mechanics only — a real domain-owner
 * approval stays a phase-7 prerequisite (NEG3-19).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TREE = join(HERE, '..', '..', 'fixtures', 'sc3-baseline');
const NOW = '2026-11-02T00:00:00.000Z';

function hashTree(): string {
  const names = readdirSync(TREE).sort();
  const hash = createHash('sha256');
  for (const name of names) {
    const path = join(TREE, name);
    if (!statSync(path).isFile()) {
      continue;
    }
    hash.update(name);
    hash.update(readFileSync(path));
  }
  return hash.digest('hex');
}

interface ProbeHit {
  kind: 'entrypoint' | 'job' | 'config' | 'dynamic_sql';
  ref: string;
}

function probe(): ProbeHit[] {
  const found: ProbeHit[] = [];
  for (const name of readdirSync(TREE).sort()) {
    const path = join(TREE, name);
    if (!statSync(path).isFile()) {
      continue;
    }
    if (name.endsWith('.mjs')) {
      found.push({ kind: 'entrypoint', ref: name });
    }
    if (name.endsWith('.sql')) {
      found.push({ kind: 'config', ref: name });
    }
    const text = readFileSync(path, 'utf8');
    if (/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(text)) {
      found.push({ kind: 'dynamic_sql', ref: name });
    }
  }
  return found;
}

describe('legacy characterization denies side effects and stays diagnosis-only', () => {
  it('probes read-only and exits diagnosis-only without owner approval', () => {
    const before = hashTree();
    const inventory = probe();
    expect(inventory.length).toBeGreaterThan(0);
    expect(hashTree()).toBe(before);

    const corpus = freezeLegacyCorpus({
      corpusId: 'sc3-baseline-legacy',
      contentDigest: before,
      sanitization: 'native probe reads only; no customer data in this fixture',
      inventory,
      pinnedAt: NOW,
      pinnedBy: 'trusted-author-native',
    });
    const diagnosis = diagnoseLegacy({
      diagnosisId: 'diag-native-1',
      corpus,
      knownFacts: [`${String(inventory.length)} inventory items observed read-only`],
      competingHypotheses: ['fixture behavior is intentional', 'fixture behavior hides a defect'],
      uncertainty: 'no owner statement pins the intended behavior',
      blockedCapabilities: ['legacy-repair'],
      nextEvidence: 'domain-owner rounding/posting invariant',
      decisionOwner: 'domain-owner-fixture',
      nextSafeProbe: 'read-only replay on a sanitized clone',
      diagnosedAt: NOW,
    });
    expect(diagnosis.reason).toBe('behavior_contract_unknown');
    expect(diagnosis.mutations).toBe('none');
  });

  it('opens the repair gate behind fixture owner approval plus independent validator', () => {
    const contentDigest = hashTree();
    const corpus = freezeLegacyCorpus({
      corpusId: 'sc3-baseline-legacy',
      contentDigest,
      sanitization: 'native probe reads only; no customer data in this fixture',
      inventory: probe(),
      pinnedAt: NOW,
      pinnedBy: 'trusted-author-native',
    });
    const intent = freezeLegacyIntent({
      intentId: 'intent-native-1',
      corpus,
      invariants: ['fixture trial conserves the posted amount'],
      characterizedBy: 'native-probe',
      ownerApproval: {
        ownerId: 'fixture-owner',
        approvedAt: NOW,
        statement: 'fixture approval for mechanics only, not a real domain decision',
      },
      frozenAt: NOW,
    });
    const baseline = recordLegacyBaseline({
      baselineId: 'base-native-1',
      intent,
      observationsDigest: contentDigest,
      validatorId: 'independent-validator-native',
      validatedAt: NOW,
    });
    expect(() => {
      assertLegacyRepairAllowed(intent, baseline);
    }).not.toThrow();
  });
});
