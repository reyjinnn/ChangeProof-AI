import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PYTHON_ADAPTER, PYTHON_ADAPTER_RECORD } from '../../src/modules/adapters/python/index.js';
import { runNative } from '../../src/modules/adapters/native/process.js';
import { createFixture, PYTHON_SERVICE } from './fixtures.js';

// Native parser conformance on the observed interpreter, NOT qualification of
// the separate Python 3.10.0 acceptance pin or the python-linux runner profile.
const fixtures: { cleanup: () => void }[] = [];
let observedVersion: string;

beforeAll(async () => {
  const probe = await runNative('python', ['-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))'], {
    cwd: process.cwd(),
    timeoutMs: 10_000,
    maxOutputBytes: 1024,
  });
  expect(probe.exitCode, probe.stderr).toBe(0);
  observedVersion = probe.stdout.trim();
  expect(observedVersion).toMatch(/^\d+\.\d+\.\d+$/);
});

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe('Python L1 observed-interpreter conformance (T-07)', () => {
  it('retains native route and model provenance with the observed interpreter identity', async () => {
    const fixture = createFixture(PYTHON_SERVICE);
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.extract({
      root: fixture.root,
      files: ['app/main.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
    });

    expect(result.status).toBe('ok');
    expect(result.toolchainIdentity).toBe(`python@${observedVersion}`);
    for (const [kind, method] of [
      ['calls', 'python-ast-decorator-call'],
      ['serializes', 'python-ast-class-base'],
    ]) {
      expect(result.graph.edges).toContainEqual(expect.objectContaining({
        kind,
        resolution: 'proven',
        evidence: {
          locator: expect.stringMatching(/^app\/main\.py:\d+$/),
          snapshot: result.graph.snapshot,
          method,
        },
        runtimeObserved: false,
      }));
    }
    expect(result.graph.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'dto')).toBe(true);
  });

  it('fails closed when the requested interpreter pin differs from the observed version', async () => {
    const fixture = createFixture(PYTHON_SERVICE);
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.extract({
      root: fixture.root,
      files: ['app/main.py'],
      version: '0.0.0',
      capability: PYTHON_ADAPTER_RECORD,
    });

    expect(result.status).toBe('failed');
    expect(result.toolchainIdentity).toBe(`python@${observedVersion}`);
    expect(result.graph.edges).toEqual([]);
    expect(result.unknowns).toContain(
      `Python toolchain mismatch: requested 0.0.0, observed ${observedVersion}; select the pinned interpreter before retrying.`,
    );
  });

  it.each([
    { binding: 'import_module', declaration: 'from importlib import import_module' },
    { binding: 'load_module', declaration: 'from importlib import import_module as load_module' },
  ])('retains a dynamic $binding call as unresolved with reason and source provenance (NEG3-02)', async ({ binding, declaration }) => {
    const fixture = createFixture({
      'app/main.py': `${declaration}\n\ndef load(name):\n    return ${binding}(name)\n`,
    });
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.extract({
      root: fixture.root,
      files: ['app/main.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
    });

    expect(result.status).toBe('ok');
    expect(result.toolchainIdentity).toBe(`python@${observedVersion}`);
    const dynamic = result.graph.edges.find((edge) => edge.kind === 'calls');
    expect(dynamic).toMatchObject({
      from: 'component:app/main.py',
      to: 'symbol:dynamic:import_module',
      resolution: 'unresolved',
      unresolvedReason: 'runtime module import at app/main.py:4 cannot be resolved statically',
      runtimeObserved: false,
    });
    expect(dynamic?.evidence).toBeUndefined();
    expect(result.graph.nodes.find((node) => node.id === dynamic?.to)).toMatchObject({
      locator: 'app/main.py:4',
      snapshot: result.graph.snapshot,
    });
    expect(result.unknowns).toContain('Dynamic binding (runtime module import) at app/main.py:4 is unresolved');
  });
});
