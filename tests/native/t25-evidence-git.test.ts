import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { SubjectRefSchema, TargetAssessmentSchema } from '../../src/core/index.js';
import {
  assembleBundleManifest,
  createFileEvidenceStore,
  verifyBundleManifest,
} from '../../src/modules/evidence/index.js';
import { planEvidenceBranch } from '../../src/modules/github/index.js';
import { publicationIdempotencyKey } from '../../src/orchestrator/publication.js';

const git = promisify(execFile);

async function sh(cmd: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await git(cmd, args, { cwd, timeout: 20_000 });
  return stdout.trim();
}

/**
 * T-25 native: evidence durability on a real filesystem and evidence-branch
 * mechanics against real git (local bare remote).
 *
 * This proves the branch a broker would publish from can actually be created,
 * committed, and pushed, and that a moved head is observable. Opening a real
 * pull request needs an authorized GitHub App and stays blocked.
 */
describe('T-25 native evidence + git branch (WP3-12)', () => {
  it('persists a manifest across store reopens and verifies it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-ev-native-'));
    try {
      const target = SubjectRefSchema.parse({ kind: 'worker', id: 'order-worker', repository: 'shop-worker' });
      const outcome = TargetAssessmentSchema.parse({
        schemaVersion: '1',
        subject: target,
        outcome: 'fixed',
        proofScope: { targets: [target], edges: [], invariants: ['contract-holds'], unsupportedSurfaces: [] },
        policyVersion: '1',
        reasons: [],
        evidenceRefs: ['ev-order-worker'],
      });
      const manifest = assembleBundleManifest({
        policyVersion: '1',
        candidateBundleDigest: 'b'.repeat(64),
        state: 'verified',
        targetOutcomes: [outcome],
        bindings: [{ subject: target, candidate: 'e'.repeat(64), verified: 'e'.repeat(64) }],
        edges: [],
        invariants: [{ ref: 'inv-effect-once', holds: true, checkRef: 'chk-effect-once' }],
        mixedVersion: { requiredPairs: [], coveredPairs: [], allCampaignsComplete: true },
        intentFulfilled: true,
        runRef: 'run-native',
      });
      createFileEvidenceStore(dir).put(manifest.bytes);
      const reopened = createFileEvidenceStore(dir);
      const verified = verifyBundleManifest(reopened, manifest.digest);
      expect(verified.digest).toBe(manifest.digest);
      expect(verified.manifest.runRef).toBe('run-native');
      expect(verified.manifest.targetOutcomes).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates, pushes, and observes the planned evidence branch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-git-native-'));
    try {
      const remote = join(root, 'remote.git');
      const work = join(root, 'work');
      await sh('git', ['init', '--bare', '-q', remote], root);
      await sh('git', ['init', '-b', 'main', '-q', work], root);
      await sh('git', ['-C', work, 'config', 'user.email', 'probe@changeproof.local'], root);
      await sh('git', ['-C', work, 'config', 'user.name', 'changeproof-probe'], root);
      await sh('git', ['-C', work, 'config', 'commit.gpgsign', 'false'], root);
      writeFileSync(join(work, 'orders.txt'), 'base\n');
      await sh('git', ['-C', work, 'add', 'orders.txt'], root);
      await sh('git', ['-C', work, 'commit', '-q', '-m', 'base'], root);
      await sh('git', ['-C', work, 'remote', 'add', 'origin', remote], root);
      await sh('git', ['-C', work, 'push', '-q', '-u', 'origin', 'main'], root);
      const baseHead = await sh('git', ['-C', work, 'rev-parse', 'HEAD'], root);
      expect(baseHead).toMatch(/^[0-9a-f]{40}$/);

      const manifestDigest = 'c'.repeat(64);
      const key = publicationIdempotencyKey({
        owner: 'acme',
        repo: 'orders',
        base: 'main',
        expectedHeadSha: baseHead,
        manifestDigest,
        policyVersion: '1',
      });
      const plan = planEvidenceBranch({ idempotencyKey: key, base: 'main', headSha: baseHead });
      expect(plan.branch).toMatch(/^[A-Za-z0-9/_.-]+$/);

      await sh('git', ['-C', work, 'checkout', '-q', '-b', plan.branch], root);
      writeFileSync(join(work, 'EVIDENCE.md'), `manifest: ${manifestDigest}\n`);
      await sh('git', ['-C', work, 'add', 'EVIDENCE.md'], root);
      await sh('git', ['-C', work, 'commit', '-q', '-m', 'evidence manifest'], root);
      await sh('git', ['-C', work, 'push', '-q', '-u', 'origin', plan.branch], root);
      const localHead = await sh('git', ['-C', work, 'rev-parse', 'HEAD'], root);
      const remoteHead = (await sh('git', ['-C', work, 'ls-remote', 'origin', plan.branch], root)).split(
        /\s/,
      )[0];
      expect(remoteHead).toBe(localHead);

      // A moved base head is observable: the broker compares this live head
      // against the expected sha and withholds instead of rebasing.
      await sh('git', ['-C', work, 'checkout', '-q', 'main'], root);
      writeFileSync(join(work, 'orders.txt'), 'base\nmore\n');
      await sh('git', ['-C', work, 'commit', '-q', '-am', 'drift'], root);
      await sh('git', ['-C', work, 'push', '-q', 'origin', 'main'], root);
      const movedHead = await sh('git', ['-C', work, 'rev-parse', 'HEAD'], root);
      expect(movedHead).not.toBe(plan.headSha);
    } finally {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          rmSync(root, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    }
  }, 60_000);
});
