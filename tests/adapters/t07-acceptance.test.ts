import { afterEach, describe, expect, it } from 'vitest';

import type { CapabilityKey } from '../../src/core/index.js';
import { DOTNET_ADAPTER, GO_ADAPTER, PHP_ADAPTER, PYTHON_ADAPTER, type AdapterDefinition } from '../../src/modules/adapters/index.js';
import { createFixture } from './fixtures.js';

// Reviewed native parsers over synthetic source, never framework execution or
// Linux-profile qualification. No customer application is built or imported.
const fixtures: { cleanup: () => void }[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });

const cases = [
  { adapter: PYTHON_ADAPTER, version: '3.10.0', file: 'main.py', source: '@app.get("/orders")\ndef orders():\n    return {}\n' },
  { adapter: PHP_ADAPTER, version: '8.5.12', file: 'routes.php', source: "<?php Route::get('/orders', fn() => []);" },
  { adapter: GO_ADAPTER, version: '1.27.3', file: 'main.go', source: 'package main\nimport "github.com/gin-gonic/gin"\nfunc main() { r := gin.Default(); r.GET("/orders", handler) }\n' },
  { adapter: DOTNET_ADAPTER, version: '10.0.403', file: 'Program.cs', source: 'var app = WebApplication.Create();\napp.MapGet("/orders", () => new Order());\npublic record Order();' },
] as const;

function record(adapter: AdapterDefinition) {
  const value = adapter.records[0];
  if (value === undefined) throw new Error('Expected a registered capability');
  return value;
}

describe.each(cases)('T-07 $adapter.name registered tuple', ({ adapter, version, file, source }) => {
  const mutations: { label: string; key: Partial<CapabilityKey> }[] = [
    { label: 'framework', key: { framework: 'unregistered-framework' } },
    { label: 'version range', key: { versionRange: '>=99 <100' } },
    { label: 'feature profile', key: { featureRestrictions: ['unregistered-feature'] } },
  ];
  it.each(mutations)('refuses an unregistered $label before reading source (NEG3-09)', async ({ key }) => {
    const registered = record(adapter);
    const result = await adapter.extract({ root: 'missing-t07-snapshot', files: [], version,
      capability: { ...registered, key: { ...registered.key, ...key } } });
    expect(result.status).toBe('unsupported');
    expect(result.unsupportedSurfaces.join(' ')).toMatch(/unregistered|invalid.*capability/i);
    expect(result.graph.edges).toEqual([]);
  });

  if (adapter !== PYTHON_ADAPTER) {
    // Python's mismatch path already has a dedicated observed-version test.
    it('refuses a mismatched native toolchain pin', async () => {
      const fixture = createFixture({ [file]: source }); fixtures.push(fixture);
      const result = await adapter.extract({ root: fixture.root, files: [file], version: '0.0.0', capability: record(adapter) });
      expect(result.status).not.toBe('ok');
      expect([...result.unknowns, ...result.unsupportedSurfaces].join(' ')).toMatch(/pin|mismatch/i);
      expect(result.graph.edges).toEqual([]);
    }, 120_000);
  }

  it('fails honestly when the native executable cannot be found', async () => {
    const fixture = createFixture({ [file]: source }); fixtures.push(fixture);
    // Exercise the real launcher failure, not a mocked parser response.
    // Capture both spellings BEFORE mutating either: Windows aliases them,
    // whereas a case-sensitive worker environment may expose separate keys.
    const previous = { PATH: process.env['PATH'], Path: process.env['Path'] };
    process.env['PATH'] = fixture.root;
    process.env['Path'] = fixture.root;
    try {
      const result = await adapter.extract({ root: fixture.root, files: [file], version, capability: record(adapter) });
      expect(result.status).toBe('failed');
      expect(result.toolchainIdentity).toBe(`${adapter.name}@unobserved`);
      expect(result.graph.edges).toEqual([]);
      expect([...result.unknowns, ...result.diagnostics].join(' ')).toMatch(/127|ENOENT|discovery failed/i);
    } finally {
      if (previous.PATH === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previous.PATH;
      if (previous.Path === undefined) delete process.env['Path'];
      else process.env['Path'] = previous.Path;
    }
  });
});

describe('T-07 parser failures and unresolved provenance', () => {
  it.each([cases[0], cases[1], cases[2], cases[3]])('$adapter.name refuses malformed source alongside a valid route', async ({ adapter, version, file, source }) => {
    const broken = `broken.${file.split('.').at(-1)}`;
    const invalid = adapter === PHP_ADAPTER ? '<?php function broken( {' : '{ invalid syntax !!!';
    const fixture = createFixture({ [file]: source, [broken]: invalid }); fixtures.push(fixture);
    const result = await adapter.extract({ root: fixture.root, files: [file, broken], version, capability: record(adapter) });
    expect(result.status).toBe('failed');
    expect([...result.unknowns, ...result.diagnostics].join(' ')).toContain(broken);
    expect(result.graph.edges).toEqual([]);
  }, 120_000);

  it('keeps a PHP dynamic container lookup visible next to a resolved route', async () => {
    const fixture = createFixture({ 'routes.php': "<?php\nRoute::get('/orders', fn() => []);\n$service = 'handler';\napp($service);\n" }); fixtures.push(fixture);
    const result = await PHP_ADAPTER.extract({ root: fixture.root, files: ['routes.php'], version: '8.5.12', capability: record(PHP_ADAPTER) });
    expect(result.status).toBe('ok');
    expect(result.graph.edges.some((edge) => edge.resolution === 'proven')).toBe(true);
    expectUnresolved(result, 'routes.php:4', /dynamic container/i);
  });

  it('does not misidentify an unrelated PHP get function as a Laravel route', async () => {
    const fixture = createFixture({ 'unrelated.php': "<?php function get($path) { return $path; } get('/not-a-route');" }); fixtures.push(fixture);
    const result = await PHP_ADAPTER.extract({ root: fixture.root, files: ['unrelated.php'], version: '8.5.12', capability: record(PHP_ADAPTER) });
    expect(result.status).toBe('unsupported');
    expect(result.graph.edges).toEqual([]);
  });

  it('extracts actual Gin route syntax under the registered Gin tuple', async () => {
    const input = cases[2];
    const fixture = createFixture({ [input.file]: input.source }); fixtures.push(fixture);
    const result = await GO_ADAPTER.extract({ root: fixture.root, files: [input.file], version: input.version, capability: record(GO_ADAPTER) });
    expect(result.status).toBe('ok');
    expect(result.toolchainIdentity).toBe('go@1.27.3');
    expect(result.graph.edges).toContainEqual(expect.objectContaining({
      to: 'endpoint:GET /orders', resolution: 'proven', runtimeObserved: false,
      evidence: { locator: 'main.go:3', snapshot: result.graph.snapshot, method: 'go-ast-parser' },
    }));
  }, 120_000);

  it('keeps a computed Gin route unresolved alongside a literal route', async () => {
    const fixture = createFixture({ 'main.go': 'package main\nimport "github.com/gin-gonic/gin"\nfunc main() { r := gin.Default(); r.GET("/orders", handler); r.POST(path, handler) }\n' }); fixtures.push(fixture);
    const result = await GO_ADAPTER.extract({ root: fixture.root, files: ['main.go'], version: '1.27.3', capability: record(GO_ADAPTER) });
    expect(result.status).toBe('ok');
    expectUnresolved(result, 'main.go:3', /non-literal Gin route/i);
  }, 120_000);

  it('does not treat a Go listener address as an HTTP route', async () => {
    const fixture = createFixture({ 'main.go': 'package main\nimport "net/http"\nfunc main() { http.ListenAndServe(":8080", nil) }\n' }); fixtures.push(fixture);
    const result = await GO_ADAPTER.extract({ root: fixture.root, files: ['main.go'], version: '1.27.3', capability: record(GO_ADAPTER) });
    expect(result.status).toBe('unsupported');
    expect(result.graph.edges).toEqual([]);
  }, 120_000);

  it('does not promote a reassigned Gin router binding to proven', async () => {
    const fixture = createFixture({ 'main.go': 'package main\nimport "github.com/gin-gonic/gin"\nfunc main() { r := gin.Default(); r = otherRouter(); r.GET("/orders", handler) }\n' }); fixtures.push(fixture);
    const result = await GO_ADAPTER.extract({ root: fixture.root, files: ['main.go'], version: '1.27.3', capability: record(GO_ADAPTER) });
    expectUnresolved(result, 'main.go:3', /reassigned Gin router/i);
    expect(result.graph.edges.some((edge) => edge.resolution === 'proven')).toBe(false);
  }, 120_000);

  it('keeps a computed ASP.NET route unresolved alongside a literal route', async () => {
    const fixture = createFixture({ 'Program.cs': 'var app = WebApplication.Create();\napp.MapGet("/orders", () => 1);\napp.MapPost(path, () => 2);\n' }); fixtures.push(fixture);
    const result = await DOTNET_ADAPTER.extract({ root: fixture.root, files: ['Program.cs'], version: '10.0.403', capability: record(DOTNET_ADAPTER) });
    expect(result.status).toBe('ok');
    expectUnresolved(result, 'Program.cs:3', /non-literal endpoint mapping/i);
  }, 120_000);
});

describe('T-07 PHP route argument acceptance', () => {
  it.each([
    { label: 'single-quoted literal', call: "Route::get('/orders', fn() => []);" },
    { label: 'double-quoted literal with comments', call: 'Route::get( /* path */ "/orders" /* handler */, fn() => []);' },
    { label: 'literal before the closing parenthesis', call: "Route::get('/orders');" },
  ])('retains the complete route and provenance for a $label', async ({ call }) => {
    const fixture = createFixture({ 'routes.php': `<?php\n${call}\n` }); fixtures.push(fixture);
    const result = await PHP_ADAPTER.extract({ root: fixture.root, files: ['routes.php'], version: '8.5.12', capability: record(PHP_ADAPTER) });
    expect(result.status).toBe('ok');
    expect(result.toolchainIdentity).toBe('php@8.5.12');
    expect(result.unknowns).toEqual([]);
    expect(result.graph.edges).toEqual([expect.objectContaining({
      kind: 'calls', from: 'component:routes.php', to: 'endpoint:GET /orders',
      resolution: 'proven', runtimeObserved: false,
      evidence: { locator: 'routes.php:2', snapshot: result.graph.snapshot, method: 'php-tokenizer-route-call' },
    })]);
    expect(result.graph.nodes.find((node) => node.id === 'endpoint:GET /orders')).toMatchObject({
      kind: 'endpoint', label: 'GET /orders', locator: 'routes.php:2', snapshot: result.graph.snapshot,
    });
  });

  it.each([
    { label: 'literal concatenated with a variable', argument: "'/orders/' . $id" },
    { label: 'concatenated literals', argument: "'/orders/' . 'pending'" },
    { label: 'variable', argument: '$path' },
    { label: 'computed function call', argument: "routePath('/orders/')" },
    { label: 'conditional with a literal prefix', argument: "'/orders/' ? $path : '/fallback'" },
  ])('keeps a $label unresolved without proving a literal prefix', async ({ argument }) => {
    const fixture = createFixture({ 'routes.php': `<?php\nRoute::get('/known', fn() => []);\nRoute::post(${argument}, fn() => []);\n` }); fixtures.push(fixture);
    const result = await PHP_ADAPTER.extract({ root: fixture.root, files: ['routes.php'], version: '8.5.12', capability: record(PHP_ADAPTER) });
    expect(result.status).toBe('ok');
    expect(result.toolchainIdentity).toBe('php@8.5.12');
    expect(result.graph.edges.filter((edge) => edge.resolution === 'proven')).toEqual([expect.objectContaining({
      from: 'component:routes.php', to: 'endpoint:GET /known', runtimeObserved: false,
      evidence: { locator: 'routes.php:2', snapshot: result.graph.snapshot, method: 'php-tokenizer-route-call' },
    })]);
    expect(result.graph.nodes.filter((node) => node.kind === 'endpoint').map((node) => node.id)).toEqual(['endpoint:GET /known']);
    expect(result.graph.edges.filter((edge) => edge.resolution === 'unresolved')).toHaveLength(1);
    expectUnresolved(result, 'routes.php:3', /non-literal Laravel route/i);
    expect(result.graph.edges.find((edge) => edge.resolution === 'unresolved')?.from).toBe('component:routes.php');
  });
});

function expectUnresolved(result: Awaited<ReturnType<AdapterDefinition['extract']>>, locator: string, reason: RegExp) {
  const edge = result.graph.edges.find((candidate) => candidate.resolution === 'unresolved');
  expect(edge).toBeDefined();
  expect(edge?.unresolvedReason).toMatch(reason);
  expect(edge?.unresolvedReason).toContain(locator);
  expect(edge?.evidence).toBeUndefined();
  expect(edge?.runtimeObserved).toBe(false);
  expect(result.graph.nodes.find((node) => node.id === edge?.to)).toMatchObject({ locator, snapshot: result.graph.snapshot });
  expect(result.unknowns.join(' ')).toContain(locator);
}
