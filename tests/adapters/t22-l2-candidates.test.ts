import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  AdapterFixRequestSchema,
  AdapterFixStatusSchema,
  CapabilityRecordSchema,
  type AdapterPatch,
  type CapabilityRecord,
} from '../../src/core/index.js';
import { reviewPatch } from '../../src/modules/agent/index.js';
import {
  GO_ADAPTER,
  GO_ADAPTER_RECORD,
  GO_FIBER_RECORD,
  PHP_ADAPTER,
  PHP_ADAPTER_RECORD,
} from '../../src/modules/adapters/index.js';
import { runNative } from '../../src/modules/adapters/native/process.js';
import type { AdapterDefinition } from '../../src/modules/adapters/types.js';
import { createFixture } from './fixtures.js';
import { runPlannedCheck } from './native-exec.js';

/**
 * T-22: Go (Gin, Fiber) and PHP (Laravel) L2 adapters (WP3-09 slice).
 *
 * L2 proves a nontrivial candidate patch + guard validation on a real
 * toolchain. L2 output is a candidate: it is never labeled fixed here —
 * the verdict belongs to the verifier + policy, not the adapter.
 */

let goVersion = '';
let phpVersion = '';

beforeAll(async () => {
  const go = await runNative('go', ['version'], {
    cwd: process.cwd(),
    timeoutMs: 30_000,
    maxOutputBytes: 4096,
  });
  expect(go.exitCode, go.stderr).toBe(0);
  goVersion = go.stdout.trim().split(' ')[2]?.replace(/^go/, '') ?? '';
  expect(goVersion).toMatch(/^\d+\.\d+\.\d+$/);
  const php = await runNative('php', ['-r', 'echo PHP_VERSION;'], {
    cwd: process.cwd(),
    timeoutMs: 30_000,
    maxOutputBytes: 4096,
  });
  expect(php.exitCode, php.stderr).toBe(0);
  phpVersion = php.stdout.trim();
  expect(phpVersion).toMatch(/^\d+\.\d+/);
}, 60_000);

function routeRequest(entity: string, scope: readonly string[], id: string) {
  return AdapterFixRequestSchema.parse({
    schemaVersion: '1',
    requestId: id,
    changeKind: 'route_path_change',
    entity,
    before: '/orders/list',
    after: '/v2/orders/list',
    intentRef: 'intent-t22',
    scope: [...scope],
  });
}

async function guardAndApply(
  adapter: AdapterDefinition,
  root: string,
  patch: AdapterPatch,
  scope: readonly string[],
): Promise<readonly string[]> {
  const review = reviewPatch({
    operations: patch.operations.map((operation) => ({
      operation: operation.operation,
      path: operation.path,
      sizeBytes: Buffer.byteLength(operation.content, 'utf8'),
    })),
    writableRoots: [...scope],
    protectedRoots: [],
    allowedOperations: ['write'],
    maxSizeBytes: 1024 * 1024,
    approvedScope: [...scope],
  });
  expect(review.accepted).toBe(true);
  const applied = await adapter.applyPatch({
    root,
    patch,
    authorizations: patch.operations.map((operation) => ({
      operation: 'write' as const,
      path: operation.path,
      authorizedRoot:
        scope.find((entry) => operation.path === entry || operation.path.startsWith(`${entry}/`)) ??
        scope[0] ??
        '',
    })),
  });
  expect(applied.patchDigest).toBe(patch.patchDigest);
  return applied.applied;
}

async function goModTidy(root: string): Promise<void> {
  const tidy = await runNative('go', ['mod', 'tidy'], {
    cwd: root,
    timeoutMs: 300_000,
    maxOutputBytes: 64_000,
  });
  expect(tidy.exitCode, tidy.stdout + tidy.stderr).toBe(0);
}

describe('T-22 gin tuple: route candidate + real go build', () => {
  const files = {
    'go.mod': ['module t22gin', '', 'go 1.27', '', 'require github.com/gin-gonic/gin v1.10.0', ''].join(
      '\n',
    ),
    'server/routes.go': [
      'package server',
      '',
      'import "github.com/gin-gonic/gin"',
      '',
      'func SetupRouter() *gin.Engine {',
      '	r := gin.Default()',
      '	r.GET("/orders/list", listOrders)',
      '	return r',
      '}',
      '',
      'func listOrders(c *gin.Context) {',
      '	c.JSON(200, gin.H{"ok": true})',
      '}',
      '',
    ].join('\n'),
    'client/paths.go': [
      'package client',
      '',
      'const OrdersPath = "/orders/list"',
      '',
      'func FetchURL(base string) string {',
      '	return base + OrdersPath',
      '}',
      '',
    ].join('\n'),
    'main.go': [
      'package main',
      '',
      'import (',
      '	"t22gin/client"',
      '	"t22gin/server"',
      ')',
      '',
      'func main() {',
      '	_ = server.SetupRouter()',
      '	_ = client.FetchURL("http://localhost:8080")',
      '}',
      '',
    ].join('\n'),
  };

  it(
    'plans a two-file route candidate and go build + vet exit 0',
    { timeout: 600_000 },
    async () => {
      const fixture = createFixture(files);
      try {
        await goModTidy(fixture.root);
        const request = routeRequest('server/routes.SetupRouter', ['server', 'client'], 'req-t22-gin');
        const planned = await GO_ADAPTER.planFix({
          root: fixture.root,
          files: ['server/routes.go', 'client/paths.go', 'main.go'],
          version: goVersion,
          capability: GO_ADAPTER_RECORD,
          request,
        });
        expect(planned.status).toBe('ok');
        const patch = planned.patch;
        if (patch === null) throw new Error('planned patch is missing');
        expect(patch.operations.map((operation) => operation.path).sort()).toEqual([
          'client/paths.go',
          'server/routes.go',
        ]);
        await guardAndApply(GO_ADAPTER, fixture.root, patch, ['server', 'client']);
        expect(readFileSync(`${fixture.root}/server/routes.go`, 'utf8')).toContain('/v2/orders/list');
        const plan = await GO_ADAPTER.planChecks({
          root: fixture.root,
          patch,
          capability: GO_ADAPTER_RECORD,
          request,
          runnerIdentity: 'go-windows',
          version: goVersion,
        });
        expect(plan.patchDigest).toBe(patch.patchDigest);
        expect(plan.checks.map((check) => check.checkId)).toEqual(['go-build', 'go-vet']);
        for (const check of plan.checks) {
          const executed = await runPlannedCheck(check);
          expect(executed.exitCode, `${check.checkId}: ${executed.stdout}${executed.stderr}`).toBe(0);
        }
      } finally {
        fixture.cleanup();
      }
    },
  );

  it('refuses a route change when a computed route is in scope (NEG3-02)', async () => {
    const fixture = createFixture({
      'server/routes.go': files['server/routes.go'],
      'server/legacy.go': [
        'package server',
        '',
        'import "github.com/gin-gonic/gin"',
        '',
        'func SetupLegacy(version string) *gin.Engine {',
        '	r := gin.Default()',
        '	r.GET("/orders/" + version, listOrders)',
        '	return r',
        '}',
        '',
      ].join('\n'),
    });
    try {
      const result = await GO_ADAPTER.planFix({
        root: fixture.root,
        files: ['server/routes.go', 'server/legacy.go'],
        version: goVersion,
        capability: GO_ADAPTER_RECORD,
        request: routeRequest('server/routes.SetupRouter', ['server'], 'req-t22-gin-neg'),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
      expect(result.unsupportedSurfaces.join('\n')).toContain('server/legacy.go');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-22 unmodeled shapes refuse the plan', () => {
  it('refuses when a gin group prefix reshapes paths', async () => {
    const fixture = createFixture({
      'server/routes.go': [
        'package server',
        '',
        'import "github.com/gin-gonic/gin"',
        '',
        'func SetupRouter() *gin.Engine {',
        '	r := gin.Default()',
        '	r.GET("/orders/list", listOrders)',
        '	api := r.Group("/api")',
        '	_ = api',
        '	return r',
        '}',
        '',
        'func listOrders(c *gin.Context) {',
        '	c.JSON(200, gin.H{"ok": true})',
        '}',
        '',
      ].join('\n'),
    });
    try {
      const result = await GO_ADAPTER.planFix({
        root: fixture.root,
        files: ['server/routes.go'],
        version: goVersion,
        capability: GO_ADAPTER_RECORD,
        request: routeRequest('server/routes.SetupRouter', ['server'], 'req-t22-gin-group'),
      });
      expect(result.status).toBe('unsupported');
      expect(result.unsupportedSurfaces.join('\n')).toContain('server/routes.go');
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses a prefixed laravel group and name-derived routes', async () => {
    const fixture = createFixture({
      'routes/web.php': [
        '<?php',
        '',
        'use Illuminate\\Support\\Facades\\Route;',
        '',
        "Route::get('/orders/list', ['c', 'index']);",
        "Route::group(['prefix' => 'api'], function () {",
        '});',
        "Route::resource('orders', 'OrderController');",
        '',
      ].join('\n'),
    });
    try {
      const result = await PHP_ADAPTER.planFix({
        root: fixture.root,
        files: ['routes/web.php'],
        version: phpVersion,
        capability: PHP_ADAPTER_RECORD,
        request: routeRequest('routes/web.C', ['routes'], 'req-t22-php-group'),
      });
      expect(result.status).toBe('unsupported');
      expect(result.unsupportedSurfaces.join('\n')).toContain('routes/web.php');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-22 fiber tuple: route candidate + real go build', () => {
  const files = {
    'go.mod': ['module t22fiber', '', 'go 1.27', '', 'require github.com/gofiber/fiber/v2 v2.52.6', ''].join(
      '\n',
    ),
    'server/routes.go': [
      'package server',
      '',
      'import "github.com/gofiber/fiber/v2"',
      '',
      'func SetupApp() *fiber.App {',
      '	app := fiber.New()',
      '	app.Get("/orders/list", listOrders)',
      '	return app',
      '}',
      '',
      'func listOrders(c *fiber.Ctx) error {',
      '	return c.JSON(fiber.Map{"ok": true})',
      '}',
      '',
    ].join('\n'),
    'client/paths.go': [
      'package client',
      '',
      'const OrdersPath = "/orders/list"',
      '',
      'func FetchURL(base string) string {',
      '	return base + OrdersPath',
      '}',
      '',
    ].join('\n'),
    'main.go': [
      'package main',
      '',
      'import (',
      '	"t22fiber/client"',
      '	"t22fiber/server"',
      ')',
      '',
      'func main() {',
      '	_ = server.SetupApp()',
      '	_ = client.FetchURL("http://localhost:8080")',
      '}',
      '',
    ].join('\n'),
  };

  it(
    'plans a two-file route candidate and go build + vet exit 0',
    { timeout: 600_000 },
    async () => {
      const fixture = createFixture(files);
      try {
        await goModTidy(fixture.root);
        const request = routeRequest('server/routes.SetupApp', ['server', 'client'], 'req-t22-fiber');
        const planned = await GO_ADAPTER.planFix({
          root: fixture.root,
          files: ['server/routes.go', 'client/paths.go', 'main.go'],
          version: goVersion,
          capability: GO_FIBER_RECORD,
          request,
        });
        expect(planned.status).toBe('ok');
        const patch = planned.patch;
        if (patch === null) throw new Error('planned patch is missing');
        expect(patch.operations.map((operation) => operation.path).sort()).toEqual([
          'client/paths.go',
          'server/routes.go',
        ]);
        await guardAndApply(GO_ADAPTER, fixture.root, patch, ['server', 'client']);
        const plan = await GO_ADAPTER.planChecks({
          root: fixture.root,
          patch,
          capability: GO_FIBER_RECORD,
          request,
          runnerIdentity: 'go-windows',
          version: goVersion,
        });
        expect(plan.checks.map((check) => check.checkId)).toEqual(['go-build', 'go-vet']);
        for (const check of plan.checks) {
          const executed = await runPlannedCheck(check);
          expect(executed.exitCode, `${check.checkId}: ${executed.stdout}${executed.stderr}`).toBe(0);
        }
      } finally {
        fixture.cleanup();
      }
    },
  );

  it('refuses a route change when the router binding is reassigned (NEG3-02)', async () => {
    const fixture = createFixture({
      'server/routes.go': files['server/routes.go'],
      'server/shadow.go': [
        'package server',
        '',
        'import "github.com/gofiber/fiber/v2"',
        '',
        'func SetupShadow() *fiber.App {',
        '	app := fiber.New()',
        '	app = fiber.New(fiber.Config{})',
        '	app.Get("/orders/list", listOrders)',
        '	return app',
        '}',
        '',
      ].join('\n'),
    });
    try {
      const result = await GO_ADAPTER.planFix({
        root: fixture.root,
        files: ['server/routes.go', 'server/shadow.go'],
        version: goVersion,
        capability: GO_FIBER_RECORD,
        request: routeRequest('server/routes.SetupApp', ['server'], 'req-t22-fiber-neg'),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
      expect(result.unsupportedSurfaces.join('\n')).toContain('server/shadow.go');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-22 laravel tuple: route candidate + real php -l', () => {
  const files = {
    'composer.json': JSON.stringify(
      { name: 't22/shop', require: { 'laravel/framework': '^11.0', php: '>=8.2' } },
      null,
      2,
    ),
    'routes/web.php': [
      '<?php',
      '',
      'use App\\Http\\Controllers\\OrderController;',
      'use Illuminate\\Support\\Facades\\Route;',
      '',
      "Route::get('/orders/list', [OrderController::class, 'index']);",
      '',
    ].join('\n'),
    'app/Http/Controllers/OrderController.php': [
      '<?php',
      '',
      'namespace App\\Http\\Controllers;',
      '',
      'class OrderController {',
      '    public function index(): array {',
      '        return $this->list();',
      '    }',
      '',
      '    private function list(): array {',
      "        return ['ok' => true];",
      '    }',
      '}',
      '',
    ].join('\n'),
    'client/paths.php': [
      '<?php',
      '',
      'namespace Client;',
      '',
      "const ORDERS_PATH = '/orders/list';",
      '',
      'function fetchUrl(string $base): string {',
      '    return $base . ORDERS_PATH;',
      '}',
      '',
    ].join('\n'),
  };

  it('plans a two-file route candidate and php -l exits 0', { timeout: 120_000 }, async () => {
    const fixture = createFixture(files);
    try {
      const request = routeRequest('routes/web.OrderController', ['routes', 'client'], 'req-t22-php');
      const planned = await PHP_ADAPTER.planFix({
        root: fixture.root,
        files: ['composer.json', 'routes/web.php', 'app/Http/Controllers/OrderController.php', 'client/paths.php'],
        version: phpVersion,
        capability: PHP_ADAPTER_RECORD,
        request,
      });
      expect(planned.status).toBe('ok');
      const patch = planned.patch;
      if (patch === null) throw new Error('planned patch is missing');
      expect(patch.operations.map((operation) => operation.path).sort()).toEqual([
        'client/paths.php',
        'routes/web.php',
      ]);
      await guardAndApply(PHP_ADAPTER, fixture.root, patch, ['routes', 'client']);
      expect(readFileSync(`${fixture.root}/routes/web.php`, 'utf8')).toContain('/v2/orders/list');
      const plan = await PHP_ADAPTER.planChecks({
        root: fixture.root,
        patch,
        capability: PHP_ADAPTER_RECORD,
        request,
        runnerIdentity: 'php-linux',
        version: phpVersion,
      });
      expect(plan.patchDigest).toBe(patch.patchDigest);
      expect(plan.checks.length).toBe(2);
      expect(plan.checks.map((check) => check.checkId).sort()).toEqual([
        'php-lint:client/paths.php',
        'php-lint:routes/web.php',
      ]);
      for (const check of plan.checks) {
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, `${check.checkId}: ${executed.stdout}${executed.stderr}`).toBe(0);
        expect(executed.stdout).toContain('No syntax errors detected');
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses a route change when a dynamic lookup is in scope (NEG3-02)', async () => {
    const fixture = createFixture({
      'routes/web.php': files['routes/web.php'],
      'routes/dynamic.php': [
        '<?php',
        '',
        'use Illuminate\\Support\\Facades\\Route;',
        '',
        '$orders = app(\'orders\');',
        "Route::get('/orders/' . $version, [$orders, 'index']);",
        '',
      ].join('\n'),
    });
    try {
      const result = await PHP_ADAPTER.planFix({
        root: fixture.root,
        files: ['routes/web.php', 'routes/dynamic.php'],
        version: phpVersion,
        capability: PHP_ADAPTER_RECORD,
        request: routeRequest('routes/web.OrderController', ['routes'], 'req-t22-php-neg'),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
      expect(result.unsupportedSurfaces.join('\n')).toContain('routes/dynamic.php');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-22 L2 stays a candidate, never fixed', () => {
  it('has no fixed value in the adapter fix status contract', () => {
    expect(AdapterFixStatusSchema.options).toEqual(['ok', 'unsupported', 'no_impact', 'failed']);
    expect(AdapterFixStatusSchema.safeParse('fixed').success).toBe(false);
    expect(AdapterFixStatusSchema.safeParse('candidate').success).toBe(false);
  });

  it('refuses planFix for unregistered Go and PHP frameworks (NEG3-09)', async () => {
    function unregisteredRecord(ecosystem: 'go' | 'php', framework: string): CapabilityRecord {
      return CapabilityRecordSchema.parse({
        schemaVersion: '2',
        key: {
          ecosystem,
          language: ecosystem,
          framework,
          versionRange: '>=1.0.0 <2.0.0',
          componentKind: 'backend',
          changeCategory: 'api-contract',
          featureRestrictions: [],
          runnerProfile: ecosystem === 'go' ? 'go-windows' : 'php-linux',
          adapterVersion: '9.9.9',
        },
        targetLevel: 'L1',
        provenLevel: 'none',
        certificationStatus: 'uncertified',
        evidenceRefs: [],
        limitations: [],
        toolchainIdentities: {},
      });
    }
    const goFixture = createFixture({ 'server/a.go': 'package server\n' });
    try {
      const goResult = await GO_ADAPTER.planFix({
        root: goFixture.root,
        files: ['server/a.go'],
        version: goVersion,
        capability: unregisteredRecord('go', 'echo'),
        request: routeRequest('server/a.A', ['server'], 'req-t22-echo'),
      });
      expect(goResult.status).toBe('unsupported');
      expect(goResult.patch).toBeNull();
    } finally {
      goFixture.cleanup();
    }
    const phpFixture = createFixture({ 'src/a.php': "<?php\n" });
    try {
      const phpResult = await PHP_ADAPTER.planFix({
        root: phpFixture.root,
        files: ['src/a.php'],
        version: phpVersion,
        capability: unregisteredRecord('php', 'symfony'),
        request: routeRequest('src/a.A', ['src'], 'req-t22-symfony'),
      });
      expect(phpResult.status).toBe('unsupported');
      expect(phpResult.patch).toBeNull();
    } finally {
      phpFixture.cleanup();
    }
  });

  it('refuses check plans for tampered patches', async () => {
    const fixture = createFixture({
      'client/paths.php': ["<?php\nconst P = '/orders/list';\n", ''].join('\n'),
    });
    try {
      const planned = await PHP_ADAPTER.planFix({
        root: fixture.root,
        files: ['client/paths.php'],
        version: phpVersion,
        capability: PHP_ADAPTER_RECORD,
        request: routeRequest('client/paths.P', ['client'], 'req-t22-tamper'),
      });
      expect(planned.status).toBe('failed');
      const tampered: AdapterPatch = {
        schemaVersion: '1',
        patchId: 'tampered',
        intentRefs: ['intent-t22'],
        operations: [{ operation: 'write', path: 'client/paths.php', content: 'x', impactRefs: ['c'] }],
        patchDigest: '0'.repeat(64),
      };
      await expect(
        PHP_ADAPTER.planChecks({
          root: fixture.root,
          patch: tampered,
          capability: PHP_ADAPTER_RECORD,
          request: routeRequest('client/paths.P', ['client'], 'req-t22-tamper'),
          runnerIdentity: 'php-linux',
          version: phpVersion,
        }),
      ).rejects.toThrow();
    } finally {
      fixture.cleanup();
    }
  });
});
