import { describe, expect, it } from 'vitest';

import type { ModelClientPort, ModelCompleteResult } from '../../src/core/index.js';
import type { GitHubClient } from '../../src/orchestrator/index.js';
import type { ModalRunnerComposition } from '../../src/orchestrator/index.js';
import {
  isLiveProbeCommand,
  parseLiveProbeArgs,
  runLiveProbe,
  type LiveProbeDeps,
} from '../../src/cli/live-probes.js';

/**
 * Live-proof probe commands (P2/P3/P4).
 *
 * Narrow operator entries that exercise the real broker seams (model,
 * Modal guest, GitHub installation) exactly once and print a receipt.
 * Everything here runs against fakes: no network, no spend, no App.
 * Live runs are recorded separately under runs/ with their receipts.
 */

const NOW = '2026-11-04T02:30:00.000Z';

function modelResult(): ModelCompleteResult {
  return {
    model: 'muse-spark-1.3',
    outputText: 'Independent verification binds fixes to evidence.',
    toolCalls: [],
    usage: { inputTokens: 120, outputTokens: 12 },
    providerRequestId: 'chatcmpl-probe-1',
    promptId: 'prompt-live-1',
    configId: 'config-live-cli-1',
    usedFallback: false,
    droppedContextMessages: 0,
    cumulativeTokens: 132,
  };
}

function modelClient(complete?: ModelClientPort['complete']): ModelClientPort {
  return {
    provider: 'meta-muse-spark',
    contractVersion: '1',
    complete: complete ?? (() => Promise.resolve(modelResult())),
  };
}

function modalRunner(): ModalRunnerComposition {
  return {
    runProbes: () =>
      Promise.resolve({
        summary: {
          runId: 'run-probe-1',
          sandboxId: 'sb-probe1',
          boundaryClass: 'microvm' as const,
          network: 'blocked',
          verdict: 'pass' as const,
          imageRef: 'docker.io/library/debian:12-slim@sha256:probe',
          imageDigestPinned: true as const,
          probes: [{ id: 'no-docker-socket', outcome: 'pass' as const }],
          cleanup: { terminated: true, confirmed: true },
        },
        cleanup: {
          schemaVersion: '1' as const,
          runId: 'run-probe-1',
          completedAt: NOW,
          targets: [{ kind: 'container' as const, id: 'sb-probe1', removed: true }],
          environmentReusable: true,
        },
        quarantined: false,
      }),
  };
}

function githubClient(): GitHubClient {
  return {
    fetchCommit: (input) =>
      Promise.resolve({
        sha: input.sha,
        message: 'probe commit',
        committedAt: '2026-11-04T00:00:00.000Z',
      }),
    listInstallationRepositories: () =>
      Promise.resolve([{ id: 'repo-1', fullName: 'acme/pilot', isPrivate: true }]),
    fetchBranchHead: () => Promise.resolve({ sha: 'a'.repeat(40) }),
    openPullRequest: () => Promise.reject(new Error('not part of this probe')),
    findPullRequestByHead: () => Promise.resolve(null),
  };
}

describe('isLiveProbeCommand', () => {
  it('routes only the three probe commands', () => {
    expect(isLiveProbeCommand('model-live')).toBe(true);
    expect(isLiveProbeCommand('modal-probe')).toBe(true);
    expect(isLiveProbeCommand('github-probe')).toBe(true);
    expect(isLiveProbeCommand('frobnicate')).toBe(false);
    expect(isLiveProbeCommand('status')).toBe(false);
  });
});

describe('parseLiveProbeArgs', () => {
  it('parses model-live with defaults', () => {
    const parsed = parseLiveProbeArgs(['model-live', '--prompt=Why verify?']);
    expect(parsed.command).toBe('model-live');
    expect(parsed.prompt).toBe('Why verify?');
    expect(parsed.maxTokens).toBe(256);
  });

  it('refuses model-live without a prompt', () => {
    expect(() => parseLiveProbeArgs(['model-live'])).toThrow(/--prompt/);
  });

  it('refuses an oversized prompt (bounded consumption)', () => {
    expect(() => parseLiveProbeArgs(['model-live', `--prompt=${'x'.repeat(2001)}`])).toThrow(/2000/);
  });

  it('refuses out-of-range max-tokens', () => {
    expect(() => parseLiveProbeArgs(['model-live', '--prompt=hi', '--max-tokens=0'])).toThrow(/max-tokens/);
    expect(() => parseLiveProbeArgs(['model-live', '--prompt=hi', '--max-tokens=2001'])).toThrow(/max-tokens/);
    expect(() => parseLiveProbeArgs(['model-live', '--prompt=hi', '--max-tokens=lots'])).toThrow(/max-tokens/);
  });

  it('refuses a malformed flag without guessing', () => {
    expect(() => parseLiveProbeArgs(['model-live', '--prompt'])).toThrow(/malformed flag/);
  });

  it('parses modal-probe overrides', () => {
    const parsed = parseLiveProbeArgs(['modal-probe', '--python=/usr/bin/python3', '--timeout-ms=120000']);
    expect(parsed.command).toBe('modal-probe');
    expect(parsed.python).toBe('/usr/bin/python3');
    expect(parsed.timeoutMs).toBe(120_000);
  });

  it('refuses an out-of-range modal timeout', () => {
    expect(() => parseLiveProbeArgs(['modal-probe', '--timeout-ms=1000'])).toThrow(/timeout-ms/);
  });

  it('parses github-probe commit mode', () => {
    const sha = 'b'.repeat(40);
    const parsed = parseLiveProbeArgs([
      'github-probe',
      '--installation=install-1',
      '--repository-id=repo-1',
      '--owner=acme',
      '--repo=pilot',
      `--sha=${sha}`,
    ]);
    expect(parsed.command).toBe('github-probe');
    expect(parsed.sha).toBe(sha);
    expect(parsed.listRepos).toBe(false);
  });

  it('refuses github-probe without an installation', () => {
    expect(() => parseLiveProbeArgs(['github-probe', '--repository-id=repo-1', '--list-repos=1'])).toThrow(
      /--installation/,
    );
  });

  it('parses github-probe branch mode', () => {
    const parsed = parseLiveProbeArgs([
      'github-probe',
      '--installation=install-1',
      '--repository-id=repo-1',
      '--owner=acme',
      '--repo=pilot',
      '--branch=main',
    ]);
    expect(parsed.branch).toBe('main');
    expect(parsed.sha).toBeUndefined();
  });

  it('refuses github-probe commit mode without a sha or list mode', () => {
    expect(() =>
      parseLiveProbeArgs(['github-probe', '--installation=install-1', '--repository-id=repo-1']),
    ).toThrow(/--sha|--list-repos/);
  });

  it('refuses a malformed sha early', () => {
    expect(() =>
      parseLiveProbeArgs([
        'github-probe',
        '--installation=install-1',
        '--repository-id=repo-1',
        '--owner=acme',
        '--repo=pilot',
        '--sha=not-a-sha',
      ]),
    ).toThrow(/sha/i);
  });
});

describe('runLiveProbe model-live', () => {
  const deps: LiveProbeDeps = { nowIso: NOW, model: { client: modelClient() } };

  it('prints a live_model receipt for one bounded call', async () => {
    const result = await runLiveProbe(parseLiveProbeArgs(['model-live', '--prompt=Why verify?']), deps);
    expect(result.exitCode).toBe(0);
    const receipt = JSON.parse(result.output) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      proposalMode: 'live_model',
      origin: 'controlled_change',
      executionMode: 'real_runtime',
      provider: 'meta-muse-spark',
      model: 'muse-spark-1.3',
      providerRequestId: 'chatcmpl-probe-1',
    });
    expect(typeof receipt['outputText']).toBe('string');
  });

  it('fails closed without a wired model client (exit 2, no call)', async () => {
    let called = false;
    const result = await runLiveProbe(parseLiveProbeArgs(['model-live', '--prompt=Why verify?']), {
      nowIso: NOW,
      model: {
        client: modelClient(() => {
          called = true;
          return Promise.resolve(modelResult());
        }),
      },
    });
    expect(result.exitCode).toBe(0);
    expect(called).toBe(true);
    const blocked = await runLiveProbe(parseLiveProbeArgs(['model-live', '--prompt=Why verify?']), {
      nowIso: NOW,
    });
    expect(blocked.exitCode).toBe(2);
    expect(blocked.output).toMatch(/BLOCKED/i);
  });

  it('reports a broker failure without a receipt', async () => {
    const failing: LiveProbeDeps = {
      nowIso: NOW,
      model: {
        client: modelClient(() => Promise.reject(new Error('Model outage: the provider answered HTTP 503.'))),
      },
    };
    const result = await runLiveProbe(parseLiveProbeArgs(['model-live', '--prompt=Why verify?']), failing);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('HTTP 503');
  });
});

describe('runLiveProbe modal-probe', () => {
  it('prints the isolation verdict as evidence', async () => {
    const result = await runLiveProbe(parseLiveProbeArgs(['modal-probe']), {
      nowIso: NOW,
      modal: modalRunner(),
    });
    expect(result.exitCode).toBe(0);
    const receipt = JSON.parse(result.output) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      command: 'modal-probe',
      boundaryClass: 'microvm',
      verdict: 'pass',
      quarantined: false,
    });
  });

  it('fails closed without a wired runner (exit 2)', async () => {
    const result = await runLiveProbe(parseLiveProbeArgs(['modal-probe']), { nowIso: NOW });
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/BLOCKED/i);
  });
});

describe('runLiveProbe github-probe', () => {
  const sha = 'c'.repeat(40);
  const deps: LiveProbeDeps = { nowIso: NOW, github: { client: githubClient() } };

  it('prints the exact commit snapshot', async () => {
    const result = await runLiveProbe(
      parseLiveProbeArgs([
        'github-probe',
        '--installation=install-1',
        '--repository-id=repo-1',
        '--owner=acme',
        '--repo=pilot',
        `--sha=${sha}`,
      ]),
      deps,
    );
    expect(result.exitCode).toBe(0);
    const receipt = JSON.parse(result.output) as Record<string, unknown>;
    expect(receipt).toMatchObject({ command: 'github-probe', installationId: 'install-1' });
    expect((receipt['commit'] as { sha: string }).sha).toBe(sha);
  });

  it('reads the branch head in branch mode', async () => {
    const result = await runLiveProbe(
      parseLiveProbeArgs([
        'github-probe',
        '--installation=install-1',
        '--repository-id=repo-1',
        '--owner=acme',
        '--repo=pilot',
        '--branch=main',
      ]),
      deps,
    );
    expect(result.exitCode).toBe(0);
    const receipt = JSON.parse(result.output) as { branch: string; head: { sha: string } };
    expect(receipt.branch).toBe('main');
    expect(receipt.head.sha).toBe('a'.repeat(40));
  });

  it('lists installation repositories in list mode', async () => {
    const result = await runLiveProbe(
      parseLiveProbeArgs([
        'github-probe',
        '--installation=install-1',
        '--repository-id=repo-1',
        '--list-repos=1',
      ]),
      deps,
    );
    expect(result.exitCode).toBe(0);
    const receipt = JSON.parse(result.output) as { repositories: { fullName: string }[] };
    expect(receipt.repositories).toHaveLength(1);
    expect(receipt.repositories[0]?.fullName).toBe('acme/pilot');
  });

  it('fails closed without a wired installation (exit 2)', async () => {
    const result = await runLiveProbe(
      parseLiveProbeArgs([
        'github-probe',
        '--installation=install-1',
        '--repository-id=repo-1',
        '--list-repos=1',
      ]),
      { nowIso: NOW },
    );
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/BLOCKED/i);
  });
});
