import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MissingConfigurationError } from '../../src/core/index.js';
import {
  MODAL_PROBE_IMAGE_DIGEST,
  MODAL_PROBE_IMAGE_REF,
  MODAL_PROBE_RECEIPT_VERSION,
  runModalProbe,
  type ModalProbeReceipt,
  type ModalSpawner,
} from '../../src/modules/verifier/modal-runner.js';
import type { SecretBrokerPort } from '../../src/core/index.js';

/**
 * Modal Sandbox guest runner (P4, WP3-04).
 *
 * The leaf owns spawning the trusted probe helper, validating its receipt,
 * and refusing anything unpinned or non-modal. Quarantine on unconfirmed
 * cleanup is the orchestrator's decision; these tests pin the leaf contract:
 * credentials fail closed before any spawn, receipts are schema-pinned, and
 * probe failures resolve as evidence instead of throwing.
 */

const PASS_RECEIPT: ModalProbeReceipt = {
  schemaVersion: 't08-probe/1',
  mode: 'modal-sandbox',
  runId: 'run-probe-1',
  boundaryClass: 'microvm',
  provider: 'modal-sandbox',
  app: 'changeproof-t08-probes',
  imageRef: MODAL_PROBE_IMAGE_REF,
  imageDigestPinned: true,
  sandboxId: 'sb-probe1',
  limits: { cpu: 0.25, memoryMb: 256, timeoutS: 600 },
  network: 'blocked',
  probes: [
    { id: 'no-docker-socket', outcome: 'pass' },
    { id: 'non-root-uid', outcome: 'pass' },
    { id: 'no-device-creation', outcome: 'pass' },
    { id: 'metadata-unreachable', outcome: 'pass' },
    { id: 'no-guest-secrets', outcome: 'pass' },
  ],
  cleanup: { sandboxId: 'sb-probe1', terminated: true, confirmed: true },
  verdict: 'pass',
  notes: ['helper note one', 'helper note two'],
};

function broker(values: ReadonlyMap<string, string>): SecretBrokerPort {
  return {
    readCredential: (ref: string) => {
      const value = values.get(ref);
      return value === undefined
        ? Promise.reject(new Error(`Credential ref "${ref}" is not provisioned.`))
        : Promise.resolve(value);
    },
  };
}

function spawnerReturning(stdout: string, exitCode: number | null = 0): { spawner: ModalSpawner; calls: number[] } {
  const calls: number[] = [];
  const spawner: ModalSpawner = (input) => {
    calls.push(input.timeoutMs);
    if (input.tokenId.length === 0 || input.tokenSecret.length === 0) {
      return Promise.reject(new Error('Spawner received an empty credential.'));
    }
    return Promise.resolve({ exitCode, stdout, stderrTail: '', timedOut: false });
  };
  return { spawner, calls };
}

const CONFIG = {
  pythonBin: '/nonexistent/python',
  scriptPath: '/nonexistent/modal_sandbox_probe.py',
  expectedApp: 'changeproof-t08-probes',
  timeoutMs: 60_000,
};

describe('runModalProbe', () => {
  it('accepts a pinned modal-sandbox receipt and summarizes it', async () => {
    const { spawner, calls } = spawnerReturning(JSON.stringify(PASS_RECEIPT));
    const run = await runModalProbe({
      config: CONFIG,
      secrets: broker(new Map([['modal-id', 'id-value'], ['modal-secret', 'secret-value']])),
      tokenIdRef: 'modal-id',
      tokenSecretRef: 'modal-secret',
      spawner,
    });
    expect(calls).toHaveLength(1);
    expect(run.summary.verdict).toBe('pass');
    expect(run.summary.boundaryClass).toBe('microvm');
    expect(run.summary.sandboxId).toBe('sb-probe1');
    expect(run.summary.network).toBe('blocked');
    expect(run.summary.probes).toHaveLength(5);
    expect(run.summary.cleanup).toEqual({ terminated: true, confirmed: true });
    expect(run.receipt.runId).toBe('run-probe-1');
  });

  it('accepts the exact live helper receipt shape (run5 fields)', async () => {
    const live = {
      ...PASS_RECEIPT,
      runId: 'run-1793718958-735285',
      sandboxId: 'sb-01M6GZPJA3TACMHPR6KZJHN57C',
      probes: [
        { id: 'no-docker-socket', purpose: 'Guest must not see a Docker socket (NEG3-24).', exitCode: 0, stdoutTail: '', stderrTail: '', outcome: 'pass' },
        { id: 'non-root-uid', purpose: 'Guest must not run as root.', exitCode: 0, stdoutTail: '', stderrTail: '', outcome: 'pass' },
        { id: 'no-device-creation', purpose: 'Guest must not create device nodes (no privileged ops).', exitCode: 0, stdoutTail: '', stderrTail: '', outcome: 'pass' },
        { id: 'metadata-unreachable', purpose: 'Cloud metadata endpoint must be unreachable from the guest.', exitCode: 0, stdoutTail: '', stderrTail: '', outcome: 'pass' },
        { id: 'no-guest-secrets', purpose: 'Guest env must carry no secret-bearing names.', outcome: 'pass', guestEnvNames: ['HOME', 'PATH', 'USER'], leakedNames: [] },
      ],
      cleanup: { sandboxId: 'sb-01M6GZPJA3TACMHPR6KZJHN57C', terminated: true, confirmed: true },
    };
    const { spawner } = spawnerReturning(JSON.stringify(live));
    const run = await runModalProbe({
      config: CONFIG,
      secrets: broker(new Map([['modal-id', 'id-value'], ['modal-secret', 'secret-value']])),
      tokenIdRef: 'modal-id',
      tokenSecretRef: 'modal-secret',
      spawner,
    });
    expect(run.summary.verdict).toBe('pass');
    expect(run.summary.sandboxId).toBe('sb-01M6GZPJA3TACMHPR6KZJHN57C');
  });

  it('resolves a failing verdict as evidence instead of throwing', async () => {
    const { spawner } = spawnerReturning(
      JSON.stringify({ ...PASS_RECEIPT, verdict: 'fail' }),
    );
    const run = await runModalProbe({
      config: CONFIG,
      secrets: broker(new Map([['modal-id', 'id-value'], ['modal-secret', 'secret-value']])),
      tokenIdRef: 'modal-id',
      tokenSecretRef: 'modal-secret',
      spawner,
    });
    expect(run.summary.verdict).toBe('fail');
  });

  it('refuses a dry-run receipt: wiring output is never qualification evidence', async () => {
    const { spawner } = spawnerReturning(JSON.stringify({ ...PASS_RECEIPT, mode: 'dry-run' }));
    await expect(
      runModalProbe({
        config: CONFIG,
        secrets: broker(new Map([['modal-id', 'id-value'], ['modal-secret', 'secret-value']])),
        tokenIdRef: 'modal-id',
        tokenSecretRef: 'modal-secret',
        spawner,
      }),
    ).rejects.toThrow(/dry-run|not.*evidence/i);
  });

  it('refuses an unpinned or substituted image', async () => {
    const { spawner } = spawnerReturning(
      JSON.stringify({ ...PASS_RECEIPT, imageRef: 'docker.io/library/debian:12-slim' }),
    );
    await expect(
      runModalProbe({
        config: CONFIG,
        secrets: broker(new Map([['modal-id', 'id-value'], ['modal-secret', 'secret-value']])),
        tokenIdRef: 'modal-id',
        tokenSecretRef: 'modal-secret',
        spawner,
      }),
    ).rejects.toThrow(/pinned/i);
  });

  it('refuses unparseable helper output without guessing', async () => {
    const { spawner } = spawnerReturning('not json\n');
    await expect(
      runModalProbe({
        config: CONFIG,
        secrets: broker(new Map([['modal-id', 'id-value'], ['modal-secret', 'secret-value']])),
        tokenIdRef: 'modal-id',
        tokenSecretRef: 'modal-secret',
        spawner,
      }),
    ).rejects.toThrow(/receipt|parse/i);
  });

  it('refuses a schema-violating receipt (unknown verdict)', async () => {
    const { spawner } = spawnerReturning(JSON.stringify({ ...PASS_RECEIPT, verdict: 'maybe' }));
    await expect(
      runModalProbe({
        config: CONFIG,
        secrets: broker(new Map([['modal-id', 'id-value'], ['modal-secret', 'secret-value']])),
        tokenIdRef: 'modal-id',
        tokenSecretRef: 'modal-secret',
        spawner,
      }),
    ).rejects.toThrow(/receipt/i);
  });

  it('fails closed before spawning when the token id is missing', async () => {
    const { spawner, calls } = spawnerReturning(JSON.stringify(PASS_RECEIPT));
    await expect(
      runModalProbe({
        config: CONFIG,
        secrets: broker(new Map([['modal-secret', 'secret-value']])),
        tokenIdRef: 'modal-id',
        tokenSecretRef: 'modal-secret',
        spawner,
      }),
    ).rejects.toThrow(MissingConfigurationError);
    expect(calls).toHaveLength(0);
  });

  it('fails closed before spawning when the token secret is missing', async () => {
    const { spawner, calls } = spawnerReturning(JSON.stringify(PASS_RECEIPT));
    await expect(
      runModalProbe({
        config: CONFIG,
        secrets: broker(new Map([['modal-id', 'id-value']])),
        tokenIdRef: 'modal-id',
        tokenSecretRef: 'modal-secret',
        spawner,
      }),
    ).rejects.toThrow(MissingConfigurationError);
    expect(calls).toHaveLength(0);
  });

  it('reports a helper crash with the bounded stderr tail, never the secrets', async () => {
    const spawner: ModalSpawner = () =>
      Promise.resolve({ exitCode: 2, stdout: '', stderrTail: 'BLOCKED: no credentials', timedOut: false });
    const failure = await runModalProbe({
      config: CONFIG,
      secrets: broker(new Map([['modal-id', 'id-value'], ['modal-secret', 'secret-value']])),
      tokenIdRef: 'modal-id',
      tokenSecretRef: 'modal-secret',
      spawner,
    }).then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toContain('BLOCKED: no credentials');
    expect(failure).not.toContain('id-value');
    expect(failure).not.toContain('secret-value');
  });

  it('reports unconfirmed cleanup honestly in the summary', async () => {
    const { spawner } = spawnerReturning(
      JSON.stringify({
        ...PASS_RECEIPT,
        cleanup: { sandboxId: 'sb-probe1', terminated: true, confirmed: false },
      }),
    );
    const run = await runModalProbe({
      config: CONFIG,
      secrets: broker(new Map([['modal-id', 'id-value'], ['modal-secret', 'secret-value']])),
      tokenIdRef: 'modal-id',
      tokenSecretRef: 'modal-secret',
      spawner,
    });
    expect(run.summary.cleanup).toEqual({ terminated: true, confirmed: false });
  });
});

describe('probe helper pin sync', () => {
  it('matches the trusted python helper pins exactly', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const helper = readFileSync(join(here, '..', '..', 'scripts', 'modal_sandbox_probe.py'), 'utf8');
    expect(MODAL_PROBE_RECEIPT_VERSION).toBe('t08-probe/1');
    expect(helper).toContain(`RECEIPT_SCHEMA = "${MODAL_PROBE_RECEIPT_VERSION}"`);
    expect(helper).toContain(MODAL_PROBE_IMAGE_DIGEST);
    expect(helper).toContain('docker.io/library/debian:12-slim');
    expect(MODAL_PROBE_IMAGE_REF).toContain(MODAL_PROBE_IMAGE_DIGEST);
  });
});
