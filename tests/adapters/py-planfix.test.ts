import { readFileSync } from 'node:fs';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AdapterFixRequestSchema } from '../../src/core/index.js';
import { reviewPatch } from '../../src/modules/agent/index.js';
import { runNative } from '../../src/modules/adapters/native/process.js';
import {
  PYTHON_ADAPTER,
  PYTHON_ADAPTER_RECORD,
  PYTHON_DJANGO_RECORD,
} from '../../src/modules/adapters/index.js';
import { createFixture } from './fixtures.js';

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

const MODELS_NEW = [
  'from pydantic import BaseModel',
  '',
  '',
  'class OrderOut(BaseModel):',
  '    id: str',
  '    amount_cents: int',
  '',
].join('\n');

const BILLING_OLD = [
  'from app.models import OrderOut',
  '',
  '',
  'def invoice_total(order: OrderOut) -> int:',
  '    return order.total_cents',
  '',
  '',
  'def build(order_id: str) -> OrderOut:',
  '    return OrderOut(id=order_id, total_cents=100)',
  '',
].join('\n');

const GETATTR_CONSUMER = [
  'from app.models import OrderOut',
  '',
  '',
  'def read_field(order: OrderOut, field: str):',
  '    return getattr(order, field)',
  '',
].join('\n');

const ROUTE_FILES = {
  'app/main.py': [
    'from fastapi import FastAPI',
    '',
    'app = FastAPI()',
    '',
    '',
    "@app.get('/orders/list')",
    'def list_orders():',
    "    return {'ok': True}",
    '',
  ].join('\n'),
  'app/client.py': [
    'import httpx',
    '',
    '',
    'def load_orders() -> dict:',
    "    return httpx.get('/orders/list').json()",
    '',
  ].join('\n'),
};

function renameRequest(overrides: Record<string, unknown> = {}) {
  return AdapterFixRequestSchema.parse({
    schemaVersion: '1',
    requestId: 'req-py-001',
    changeKind: 'field_rename',
    entity: 'app.models.OrderOut',
    before: 'total_cents',
    after: 'amount_cents',
    intentRef: 'intent-001',
    scope: ['app'],
    ...overrides,
  });
}

describe('python planFix: field rename', () => {
  it('rewrites attribute reads and constructor keywords with impact refs', async () => {
    const fixture = createFixture({ 'app/models.py': MODELS_NEW, 'app/billing.py': BILLING_OLD });
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/models.py', 'app/billing.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request: renameRequest(),
    });
    expect(result.status).toBe('ok');
    expect(result.patch?.operations).toHaveLength(1);
    const operation = result.patch?.operations[0];
    expect(operation?.path).toBe('app/billing.py');
    expect(operation?.content).toContain('order.amount_cents');
    expect(operation?.content).toContain('amount_cents=100');
    expect(operation?.content).not.toContain('total_cents');
    expect(operation?.impactRefs.length).toBeGreaterThan(0);
  });

  it('reports no_impact when no consumer references the old field', async () => {
    const fixture = createFixture({ 'app/models.py': MODELS_NEW, 'app/other.py': 'KEEPALIVE = 1\n' });
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/models.py', 'app/other.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request: renameRequest(),
    });
    expect(result.status).toBe('no_impact');
    expect(result.patch).toBeNull();
  });

  it('refuses to plan when a getattr could touch the entity', async () => {
    const fixture = createFixture({ 'app/models.py': MODELS_NEW, 'app/billing.py': GETATTR_CONSUMER });
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/models.py', 'app/billing.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request: renameRequest(),
    });
    expect(result.status).toBe('unsupported');
    expect(result.patch).toBeNull();
    expect(result.unsupportedSurfaces.join('\n')).toContain('app/billing.py');
  });

  it('refuses a read from a file without a proven import edge', async () => {
    const fixture = createFixture({
      'app/models.py': MODELS_NEW,
      'app/billing.py': BILLING_OLD,
      'app/stray.py': 'def read(order):\n    return order.total_cents\n',
    });
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/models.py', 'app/billing.py', 'app/stray.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request: renameRequest(),
    });
    expect(result.status).toBe('unsupported');
    expect(result.unsupportedSurfaces.join('\n')).toContain('app/stray.py');
  });

  it('refuses an ambiguous partial-module import', async () => {
    const fixture = createFixture({
      'app/models.py': MODELS_NEW,
      'app/billing.py': ['from app import models', '', '', 'def build():', '    return models.OrderOut(id="1", total_cents=1)', ''].join(
        '\n',
      ),
    });
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/models.py', 'app/billing.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request: renameRequest(),
    });
    expect(result.status).toBe('unsupported');
    expect(result.unsupportedSurfaces.join('\n')).toContain('ambiguous');
  });

  it('fails when the after-state is not declared anywhere', async () => {
    const fixture = createFixture({
      'app/models.py': 'class OrderOut:\n    total_cents: int\n',
      'app/billing.py': BILLING_OLD,
    });
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/models.py', 'app/billing.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request: renameRequest(),
    });
    expect(result.status).toBe('failed');
    expect(result.unknowns.join('\n')).toContain('amount_cents');
  });
});

describe('python planFix: route path change', () => {
  function routeRequest(overrides: Record<string, unknown> = {}) {
    return AdapterFixRequestSchema.parse({
      schemaVersion: '1',
      requestId: 'req-py-002',
      changeKind: 'route_path_change',
      entity: 'app.main.routes',
      before: '/orders/list',
      after: '/v2/orders/list',
      intentRef: 'intent-002',
      scope: ['app'],
      ...overrides,
    });
  }

  it('updates registration and consumer literals together', async () => {
    const fixture = createFixture(ROUTE_FILES);
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/main.py', 'app/client.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request: routeRequest(),
    });
    expect(result.status).toBe('ok');
    expect(result.patch?.operations.map((operation) => operation.path).sort()).toEqual([
      'app/client.py',
      'app/main.py',
    ]);
    for (const operation of result.patch?.operations ?? []) {
      expect(operation.content).toContain('/v2/orders/list');
      expect(operation.content).not.toContain("'/orders/list'");
    }
  });

  it('refuses to guess a route embedded in an f-string', async () => {
    const fixture = createFixture({
      'app/main.py': ROUTE_FILES['app/main.py'],
      'app/client.py': "def load(verbose: bool) -> str:\n    return f'/orders/list?verbose={verbose}'\n",
    });
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/main.py', 'app/client.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request: routeRequest(),
    });
    expect(result.status).toBe('unsupported');
    expect(result.unsupportedSurfaces.join('\n')).toContain('f-string');
  });

  it('fails when the route was never observed', async () => {
    const fixture = createFixture(ROUTE_FILES);
    fixtures.push(fixture);
    const result = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/main.py', 'app/client.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request: routeRequest({ before: '/never/observed' }),
    });
    expect(result.status).toBe('failed');
  });
});

describe('python guard-to-apply wiring', () => {
  it('applies a guard-accepted patch and the file changes on disk', async () => {
    const fixture = createFixture({ 'app/models.py': MODELS_NEW, 'app/billing.py': BILLING_OLD });
    fixtures.push(fixture);
    const request = renameRequest();
    const planned = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/models.py', 'app/billing.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request,
    });
    expect(planned.status).toBe('ok');
    const patch = planned.patch;
    if (patch === null) throw new Error('planned patch is missing');
    const review = reviewPatch({
      operations: patch.operations.map((operation) => ({
        operation: operation.operation,
        path: operation.path,
        sizeBytes: Buffer.byteLength(operation.content, 'utf8'),
      })),
      writableRoots: ['app'],
      protectedRoots: [],
      allowedOperations: ['write'],
      maxSizeBytes: 1024 * 1024,
      approvedScope: ['app'],
    });
    expect(review.accepted).toBe(true);
    const applied = await PYTHON_ADAPTER.applyPatch({
      root: fixture.root,
      patch,
      authorizations: patch.operations.map((operation) => ({
        operation: 'write' as const,
        path: operation.path,
        authorizedRoot: 'app',
      })),
    });
    expect(applied.applied).toEqual(['app/billing.py']);
    expect(readFileSync(`${fixture.root}/app/billing.py`, 'utf8')).toContain('order.amount_cents');
  });
});

describe('python planChecks', () => {
  it('plans compile and import checks bound to the patch digest', async () => {
    const fixture = createFixture({ 'app/models.py': MODELS_NEW, 'app/billing.py': BILLING_OLD });
    fixtures.push(fixture);
    const request = renameRequest();
    const planned = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/models.py', 'app/billing.py'],
      version: observedVersion,
      capability: PYTHON_ADAPTER_RECORD,
      request,
    });
    const patch = planned.patch;
    if (patch === null) throw new Error('planned patch is missing');
    const plan = await PYTHON_ADAPTER.planChecks({
      root: fixture.root,
      patch,
      capability: PYTHON_ADAPTER_RECORD,
      request,
      runnerIdentity: 'python-linux',
      version: observedVersion,
    });
    expect(plan.patchDigest).toBe(patch.patchDigest);
    expect(plan.checks.map((check) => check.checkId)).toEqual(['compileall', 'import-module']);
    expect(plan.checks[1]?.args).toEqual(['-c', 'import app.models']);
  });

  it('plans a django test run for the django tuple', async () => {
    const fixture = createFixture({ 'app/models.py': MODELS_NEW, 'app/billing.py': BILLING_OLD });
    fixtures.push(fixture);
    const request = renameRequest();
    const planned = await PYTHON_ADAPTER.planFix({
      root: fixture.root,
      files: ['app/models.py', 'app/billing.py'],
      version: observedVersion,
      capability: PYTHON_DJANGO_RECORD,
      request,
    });
    const patch = planned.patch;
    if (patch === null) throw new Error('planned patch is missing');
    const plan = await PYTHON_ADAPTER.planChecks({
      root: fixture.root,
      patch,
      capability: PYTHON_DJANGO_RECORD,
      request,
      runnerIdentity: 'python-linux',
      version: observedVersion,
    });
    expect(plan.checks.map((check) => check.checkId)).toEqual(['django-test']);
  });
});
