import { describe, expect, it } from 'vitest';

import { MissingConfigurationError } from '../../src/core/index.js';
import { createMapSecretBroker } from '../../src/modules/github/index.js';
import {
  MODAL_PROBE_IMAGE_REF,
  type ModalProbeReceipt,
  type ModalSpawner,
} from '../../src/modules/verifier/index.js';
import { composeLiveModelClient, composeModalRunner } from '../../src/orchestrator/index.js';

/**
 * Live-proof composition wiring (P3/P4).
 *
 * The composition root binds transports, brokers, and budgets without
 * adding behavior. No network happens here — fakes stand behind every
 * seam, and the live runs are recorded separately under runs/.
 */

const PASS_RECEIPT: ModalProbeReceipt = {
  schemaVersion: 't08-probe/1',
  mode: 'modal-sandbox',
  runId: 'run-orch-1',
  boundaryClass: 'microvm',
  provider: 'modal-sandbox',
  app: 'changeproof-t08-probes',
  imageRef: MODAL_PROBE_IMAGE_REF,
  imageDigestPinned: true,
  sandboxId: 'sb-orch1',
  limits: { cpu: 0.25, memoryMb: 256, timeoutS: 600 },
  network: 'blocked',
  probes: [{ id: 'no-docker-socket', outcome: 'pass' }],
  cleanup: { sandboxId: 'sb-orch1', terminated: true, confirmed: true },
  verdict: 'pass',
  notes: ['helper note one', 'helper note two'],
};

function spawnerFor(receipt: ModalProbeReceipt): { spawner: ModalSpawner; calls: number } {
  const state = { calls: 0 };
  const spawner: ModalSpawner = () => {
    state.calls += 1;
    return Promise.resolve({ exitCode: 0, stdout: JSON.stringify(receipt), stderrTail: '', timedOut: false });
  };
  return {
    spawner,
    get calls() {
      return state.calls;
    },
  };
}

describe('composeLiveModelClient', () => {
  it('binds the live transport without calling it', () => {
    const client = composeLiveModelClient({
      baseUrl: 'https://api.meta.ai/v1',
      secrets: createMapSecretBroker(new Map([['model-key', 'live-secret']])),
      secretRef: 'model-key',
      provider: 'meta-muse-spark',
      model: 'muse-spark-1.3',
      configId: 'config-live-cli-1',
      tokenCeiling: 4096,
    });
    expect(client.provider).toBe('meta-muse-spark');
    expect(client.contractVersion).toBe('1');
  });

  it('refuses an empty base URL at composition time', () => {
    expect(() =>
      composeLiveModelClient({
        baseUrl: '',
        secrets: createMapSecretBroker(new Map()),
        secretRef: 'model-key',
        provider: 'meta-muse-spark',
        model: 'muse-spark-1.3',
        configId: 'config-live-cli-1',
        tokenCeiling: 4096,
      }),
    ).toThrow(/empty/i);
  });
});

describe('composeModalRunner', () => {
  const options = {
    pythonBin: '/nonexistent/python',
    scriptPath: '/nonexistent/modal_sandbox_probe.py',
    expectedApp: 'changeproof-t08-probes',
    timeoutMs: 60_000,
    tokenIdRef: 'modal-id',
    tokenSecretRef: 'modal-secret',
  };

  it('records a clean run without quarantine', async () => {
    const { spawner } = spawnerFor(PASS_RECEIPT);
    const runner = composeModalRunner({
      ...options,
      secrets: createMapSecretBroker(new Map([['modal-id', 'id'], ['modal-secret', 'secret']])),
      spawner,
    });
    const run = await runner.runProbes('2026-11-04T02:30:00.000Z');
    expect(run.quarantined).toBe(false);
    expect(run.summary.verdict).toBe('pass');
    expect(run.cleanup.environmentReusable).toBe(true);
  });

  it('quarantines an unconfirmed cleanup instead of passing', async () => {
    const { spawner } = spawnerFor({
      ...PASS_RECEIPT,
      cleanup: { sandboxId: 'sb-orch1', terminated: true, confirmed: false },
    });
    const runner = composeModalRunner({
      ...options,
      secrets: createMapSecretBroker(new Map([['modal-id', 'id'], ['modal-secret', 'secret']])),
      spawner,
    });
    const run = await runner.runProbes('2026-11-04T02:30:00.000Z');
    expect(run.quarantined).toBe(true);
    expect(run.quarantineReason ?? '').toMatch(/quarantined/i);
    expect(run.cleanup.environmentReusable).toBe(false);
  });

  it('fails closed before spawning when credentials are missing', async () => {
    const { spawner, calls } = spawnerFor(PASS_RECEIPT);
    const runner = composeModalRunner({
      ...options,
      secrets: createMapSecretBroker(new Map()),
      spawner,
    });
    await expect(runner.runProbes('2026-11-04T02:30:00.000Z')).rejects.toThrow(MissingConfigurationError);
    expect(calls).toBe(0);
  });
});
