import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { AdapterFixRequestSchema } from '../../src/core/index.js';
import { reviewPatch } from '../../src/modules/agent/index.js';
import {
  TYPESCRIPT_ADAPTER,
  TYPESCRIPT_ADAPTER_RECORD,
  TYPESCRIPT_EXPRESS_RECORD,
} from '../../src/modules/adapters/index.js';
import { createFixture } from './fixtures.js';

const PRODUCER_NEW_CONSUMER_OLD = {
  'src/api/client.ts': [
    'export interface OrderDto { id: string; amountCents: number; currency: string }',
    '',
    'export async function fetchOrder(id: string): Promise<OrderDto> {',
    "  const response = await fetch('/api/orders/' + id);",
    '  return response.json() as Promise<OrderDto>;',
    '}',
  ].join('\n'),
  'src/orders/checkout.ts': [
    "import { fetchOrder } from '../api/client.js';",
    "import type { OrderDto } from '../api/client.js';",
    '',
    'export async function checkout(orderId: string): Promise<number> {',
    '  const order: OrderDto = await fetchOrder(orderId);',
    '  return order.totalCents;',
    '}',
  ].join('\n'),
};

const DYNAMIC_CONSUMER = {
  ...PRODUCER_NEW_CONSUMER_OLD,
  'src/orders/dynamic.ts': [
    "import * as client from '../api/client.js';",
    '',
    'export async function callDynamic(operation: string): Promise<unknown> {',
    '  const table = client as unknown as Record<string, () => Promise<unknown>>;',
    '  const fn = table[operation];',
    '  return fn();',
    '}',
  ].join('\n'),
};

const ROUTE_FILES = {
  'src/server/routes.ts': [
    "import { Router } from 'express';",
    'export const router = Router();',
    "router.get('/orders/list', (req, res) => { res.json({ ok: true }); });",
  ].join('\n'),
  'src/web/client.ts': [
    'export async function loadOrders(): Promise<unknown> {',
    "  const response = await fetch('/orders/list');",
    '  return response.json();',
    '}',
  ].join('\n'),
};

const TEMPLATE_ROUTE = {
  'src/web/client.ts': [
    'export async function loadOrder(id: string): Promise<unknown> {',
    '  const response = await fetch(`/orders/${id}`);',
    '  return response.json();',
    '}',
  ].join('\n'),
};

function renameRequest(overrides: Record<string, unknown> = {}) {
  return AdapterFixRequestSchema.parse({
    schemaVersion: '1',
    requestId: 'req-ts-001',
    changeKind: 'field_rename',
    entity: 'src/api/client.OrderDto',
    before: 'totalCents',
    after: 'amountCents',
    intentRef: 'intent-001',
    scope: ['src'],
    ...overrides,
  });
}

describe('typescript planFix: field rename', () => {
  it('plans a consumer update with impact refs and a verifiable digest', async () => {
    const fixture = createFixture(PRODUCER_NEW_CONSUMER_OLD);
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts', 'src/orders/checkout.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request: renameRequest(),
      });
      expect(result.status).toBe('ok');
      expect(result.patch?.operations).toHaveLength(1);
      const operation = result.patch?.operations[0];
      expect(operation?.path).toBe('src/orders/checkout.ts');
      expect(operation?.content).toContain('order.amountCents');
      expect(operation?.content).not.toContain('totalCents');
      expect(operation?.impactRefs[0]).toContain('symbol:src/api/client#OrderDto');
      expect(result.patch?.intentRefs).toEqual(['intent-001']);
    } finally {
      fixture.cleanup();
    }
  });

  it('reports no_impact when no consumer references the old field', async () => {
    const fixture = createFixture({
      'src/api/client.ts': PRODUCER_NEW_CONSUMER_OLD['src/api/client.ts'],
      'src/orders/other.ts': 'export const keepalive = 1;\n',
    });
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts', 'src/orders/other.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request: renameRequest(),
      });
      expect(result.status).toBe('no_impact');
      expect(result.patch).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses to plan when a computed access could touch the entity', async () => {
    const fixture = createFixture(DYNAMIC_CONSUMER);
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts', 'src/orders/checkout.ts', 'src/orders/dynamic.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request: renameRequest(),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
      expect(result.unsupportedSurfaces.join('\n')).toContain('src/orders/dynamic.ts');
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses to plan a consumer outside the approved scope', async () => {
    const fixture = createFixture(PRODUCER_NEW_CONSUMER_OLD);
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts', 'src/orders/checkout.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request: renameRequest({ scope: ['src/api'] }),
      });
      expect(result.status).toBe('unsupported');
      expect(result.unsupportedSurfaces.join('\n')).toContain('src/orders/checkout.ts');
    } finally {
      fixture.cleanup();
    }
  });

  it('fails when the after-state is not declared anywhere', async () => {
    const fixture = createFixture({
      'src/api/client.ts': 'export interface OrderDto { id: string; totalCents: number }\n',
      'src/orders/checkout.ts': PRODUCER_NEW_CONSUMER_OLD['src/orders/checkout.ts'],
    });
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts', 'src/orders/checkout.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request: renameRequest(),
      });
      expect(result.status).toBe('failed');
      expect(result.unknowns.join('\n')).toContain('amountCents');
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed on an unregistered capability tuple', async () => {
    const fixture = createFixture(PRODUCER_NEW_CONSUMER_OLD);
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts'],
        version: '5.9.3',
        capability: { ...TYPESCRIPT_ADAPTER_RECORD, key: { ...TYPESCRIPT_ADAPTER_RECORD.key, framework: 'svelte' } },
        request: renameRequest(),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });
});

describe('typescript planFix: route path change', () => {
  function routeRequest(overrides: Record<string, unknown> = {}) {
    return AdapterFixRequestSchema.parse({
      schemaVersion: '1',
      requestId: 'req-ts-002',
      changeKind: 'route_path_change',
      entity: 'src/server/routes.router',
      before: '/orders/list',
      after: '/v2/orders/list',
      intentRef: 'intent-002',
      scope: ['src'],
      ...overrides,
    });
  }

  it('updates registration and consumer literals together', async () => {
    const fixture = createFixture(ROUTE_FILES);
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/server/routes.ts', 'src/web/client.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_EXPRESS_RECORD,
        request: routeRequest(),
      });
      expect(result.status).toBe('ok');
      expect(result.patch?.operations.map((operation) => operation.path).sort()).toEqual([
        'src/server/routes.ts',
        'src/web/client.ts',
      ]);
      for (const operation of result.patch?.operations ?? []) {
        expect(operation.content).toContain('/v2/orders/list');
        expect(operation.content).not.toContain("'/orders/list'");
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses to guess a route embedded in a template expression', async () => {
    const fixture = createFixture(TEMPLATE_ROUTE);
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/web/client.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request: routeRequest({ before: '/orders/', after: '/v2/orders/' }),
      });
      expect(result.status).toBe('unsupported');
      expect(result.unsupportedSurfaces.join('\n')).toContain('template expression');
    } finally {
      fixture.cleanup();
    }
  });

  it('fails when the route was never observed', async () => {
    const fixture = createFixture(ROUTE_FILES);
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/server/routes.ts', 'src/web/client.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_EXPRESS_RECORD,
        request: routeRequest({ before: '/never/observed' }),
      });
      expect(result.status).toBe('failed');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('typescript guard-to-apply wiring', () => {
  it('applies a guard-accepted patch and the file changes on disk', async () => {
    const fixture = createFixture(PRODUCER_NEW_CONSUMER_OLD);
    try {
      const planned = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts', 'src/orders/checkout.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request: renameRequest(),
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
        writableRoots: ['src'],
        protectedRoots: [],
        allowedOperations: ['write'],
        maxSizeBytes: 1024 * 1024,
        approvedScope: ['src'],
      });
      expect(review.accepted).toBe(true);
      const applied = await TYPESCRIPT_ADAPTER.applyPatch({
        root: fixture.root,
        patch,
        authorizations: patch.operations.map((operation) => ({
          operation: 'write' as const,
          path: operation.path,
          authorizedRoot: 'src',
        })),
      });
      expect(applied.applied).toEqual(['src/orders/checkout.ts']);
      expect(readFileSync(`${fixture.root}/src/orders/checkout.ts`, 'utf8')).toContain('order.amountCents');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('typescript planChecks', () => {
  it('plans a next build check bound to the patch digest', async () => {
    const fixture = createFixture(PRODUCER_NEW_CONSUMER_OLD);
    try {
      const request = renameRequest();
      const planned = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts', 'src/orders/checkout.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request,
      });
      const patch = planned.patch;
      if (patch === null) throw new Error('planned patch is missing');
      const plan = await TYPESCRIPT_ADAPTER.planChecks({
        root: fixture.root,
        patch,
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request,
        runnerIdentity: 'node-linux',
        version: '5.9.3',
      });
      expect(plan.patchDigest).toBe(patch.patchDigest);
      expect(plan.checks).toHaveLength(1);
      expect(plan.checks[0]?.checkId).toBe('next-build');
      expect(plan.checks[0]?.command).toBe('pnpm');
      expect(plan.checks[0]?.cwd).toBe(fixture.root);
    } finally {
      fixture.cleanup();
    }
  });

  it('plans a tsc check for the express tuple', async () => {
    const fixture = createFixture(ROUTE_FILES);
    try {
      const request = AdapterFixRequestSchema.parse({
        schemaVersion: '1',
        requestId: 'req-ts-003',
        changeKind: 'route_path_change',
        entity: 'src/server/routes.router',
        before: '/orders/list',
        after: '/v2/orders/list',
        intentRef: 'intent-003',
        scope: ['src'],
      });
      const planned = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/server/routes.ts', 'src/web/client.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_EXPRESS_RECORD,
        request,
      });
      const patch = planned.patch;
      if (patch === null) throw new Error('planned patch is missing');
      const plan = await TYPESCRIPT_ADAPTER.planChecks({
        root: fixture.root,
        patch,
        capability: TYPESCRIPT_EXPRESS_RECORD,
        request,
        runnerIdentity: 'node-linux',
        version: '5.9.3',
      });
      expect(plan.checks[0]?.checkId).toBe('tsc-noemit');
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses to plan checks for a tampered patch', async () => {
    const fixture = createFixture(PRODUCER_NEW_CONSUMER_OLD);
    try {
      const request = renameRequest();
      const planned = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts', 'src/orders/checkout.ts'],
        version: '5.9.3',
        capability: TYPESCRIPT_ADAPTER_RECORD,
        request,
      });
      const patch = planned.patch;
      if (patch === null) throw new Error('planned patch is missing');
      const op = patch.operations[0];
      if (op === undefined) throw new Error('planned op is missing');
      const tampered = { ...patch, operations: [{ ...op, content: 'tampered' }] };
      await expect(
        TYPESCRIPT_ADAPTER.planChecks({
          root: fixture.root,
          patch: tampered,
          capability: TYPESCRIPT_ADAPTER_RECORD,
          request,
          runnerIdentity: 'node-linux',
          version: '5.9.3',
        }),
      ).rejects.toThrow(/digest/);
    } finally {
      fixture.cleanup();
    }
  });
});
