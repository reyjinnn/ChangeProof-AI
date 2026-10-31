import { afterEach, describe, expect, it } from 'vitest';

import { AdapterRegistry } from '../../src/modules/adapters/index.js';
import { TYPESCRIPT_ADAPTER } from '../../src/modules/adapters/typescript/index.js';
import { PYTHON_ADAPTER } from '../../src/modules/adapters/python/index.js';
import { PHP_ADAPTER } from '../../src/modules/adapters/php/index.js';
import { createFixture, PHP_SERVICE, PYTHON_SERVICE, TYPESCRIPT_CONSUMER } from './fixtures.js';

/**
 * WP3-03 / T1-5 — L1 positive + negative extraction per ecosystem.
 *
 * These cases run the installed native language parsers/toolchains against
 * bounded fixtures. The output is a development/conformance receipt, not a
 * capability certification: no record's provenLevel is raised here. A real
 * acceptance run still needs frozen source/toolchain identities and retained
 * evidence artifacts under the relevant gate.
 */
const fixtures: { cleanup: () => void }[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

const registry = new AdapterRegistry([
  ...TYPESCRIPT_ADAPTER.records,
  ...PYTHON_ADAPTER.records,
  ...PHP_ADAPTER.records,
]);

describe('TypeScript L1 extraction (Node 26.12.1)', () => {
  it('extracts a positive API call with provenance', async () => {
    const fixture = createFixture(TYPESCRIPT_CONSUMER);
    fixtures.push(fixture);

    const result = await TYPESCRIPT_ADAPTER.extract({
      root: fixture.root,
      files: Object.keys(TYPESCRIPT_CONSUMER),
      version: '26.12.1',
      capability: registry.require(TYPESCRIPT_ADAPTER.key),
    });

    expect(result.graph.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.resolution === 'proven' && edge.evidence !== undefined)).toBe(true);
  });

  it('keeps dynamic member access visible as unresolved (NEG3-02)', async () => {
    const fixture = createFixture(TYPESCRIPT_CONSUMER);
    fixtures.push(fixture);

    const result = await TYPESCRIPT_ADAPTER.extract({
      root: fixture.root,
      files: ['src/api/client.ts', 'src/orders/dynamic.ts'],
      version: '26.12.1',
      capability: registry.require(TYPESCRIPT_ADAPTER.key),
    });

    expect(result.graph.edges.some((edge) => edge.resolution === 'unresolved')).toBe(true);
    expect(result.unknowns.length).toBeGreaterThan(0);
  });
});

describe('Python L1 extraction (Python 3.10.0)', () => {
  it('extracts a positive FastAPI route and model', async () => {
    const fixture = createFixture(PYTHON_SERVICE);
    fixtures.push(fixture);

    const result = await PYTHON_ADAPTER.extract({
      root: fixture.root,
      files: Object.keys(PYTHON_SERVICE),
      version: '3.10.0',
      capability: registry.require(PYTHON_ADAPTER.key),
    });

    expect(result.graph.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === 'dto')).toBe(true);
  });

  it('reports unsupported dynamic reflection rather than treating it as absent', async () => {
    const fixture = createFixture({
      'requirements.txt': 'fastapi==0.115.6\n',
      'app/main.py': [
        'from importlib import import_module',
        '',
        'def load_handler(name: str):',
        '    module = import_module(name)',
        '    return getattr(module, "handle")',
      ].join('\n'),
    });
    fixtures.push(fixture);

    const result = await PYTHON_ADAPTER.extract({
      root: fixture.root,
      files: ['requirements.txt', 'app/main.py'],
      version: '3.10.0',
      capability: registry.require(PYTHON_ADAPTER.key),
    });

    expect(result.unknowns.some((unknown) => /dynamic|reflection|import/i.test(unknown))).toBe(true);
    expect(result.graph.edges.every((edge) => edge.resolution !== 'proven' || edge.evidence !== undefined)).toBe(true);
  });
});

describe('PHP L1 extraction (PHP 8.5.12)', () => {
  it('extracts a positive Laravel route and controller method', async () => {
    const fixture = createFixture(PHP_SERVICE);
    fixtures.push(fixture);

    const result = await PHP_ADAPTER.extract({
      root: fixture.root,
      files: Object.keys(PHP_SERVICE),
      version: '8.5.12',
      capability: registry.require(PHP_ADAPTER.key),
    });

    expect(result.graph.nodes.some((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.graph.edges.some((edge) => edge.resolution === 'proven')).toBe(true);
  });

  it('rejects unsupported framework config instead of generic verified', async () => {
    const fixture = createFixture({
      'composer.json': '{"require":{"php":"^8.3","symfony/framework-bundle":"^7.0"}}',
      'src/Controller.php': '<?php class Controller { public function index() {} }',
    });
    fixtures.push(fixture);

    const result = await PHP_ADAPTER.extract({
      root: fixture.root,
      files: ['composer.json', 'src/Controller.php'],
      version: '8.5.12',
      capability: registry.require(PHP_ADAPTER.key),
    });

    expect(result.status).toBe('unsupported');
    expect(result.graph.edges).toHaveLength(0);
  });
});
