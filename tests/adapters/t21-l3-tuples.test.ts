import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AdapterFixRequestSchema,
  CapabilityRecordSchema,
  type AdapterPatch,
  type CapabilityRecord,
} from '../../src/core/index.js';
import { reviewPatch } from '../../src/modules/agent/index.js';
import {
  PYTHON_ADAPTER,
  PYTHON_ADAPTER_RECORD,
  PYTHON_DJANGO_RECORD,
  PYTHON_PYDANTIC_RECORD,
  PYTHON_SQLALCHEMY_RECORD,
  TYPESCRIPT_ADAPTER,
  TYPESCRIPT_ADAPTER_RECORD,
  TYPESCRIPT_EXPRESS_RECORD,
  TYPESCRIPT_FASTIFY_RECORD,
  TYPESCRIPT_NESTJS_RECORD,
  TYPESCRIPT_PRISMA_RECORD,
  TYPESCRIPT_REACT_RECORD,
} from '../../src/modules/adapters/index.js';
import type { AdapterDefinition } from '../../src/modules/adapters/types.js';
import { createFixture } from './fixtures.js';
import { pnpmAdd, runPlannedCheck, runPython } from './native-exec.js';

/**
 * T-21: L3 tuple coverage for TypeScript and Python (WP3-08 slice).
 *
 * Every tuple proves the full L3 path on a framework-shaped fixture:
 * extract with the real parser -> planFix -> guard review -> apply to
 * disk -> execute the exact check the adapter planned, exit 0.
 * Per-tuple negatives pin fail-closed behavior (NEG3-02/09).
 */

const TS_VERSION = '5.9.3';

function tsRenameRequest(entity: string, scope: readonly string[], overrides: Record<string, unknown> = {}) {
  return AdapterFixRequestSchema.parse({
    schemaVersion: '1',
    requestId: 'req-t21-ts',
    changeKind: 'field_rename',
    entity,
    before: 'totalCents',
    after: 'amountCents',
    intentRef: 'intent-t21',
    scope: [...scope],
    ...overrides,
  });
}

function tsRouteRequest(overrides: Record<string, unknown> = {}) {
  return AdapterFixRequestSchema.parse({
    schemaVersion: '1',
    requestId: 'req-t21-route',
    changeKind: 'route_path_change',
    entity: 'src/server/routes.router',
    before: '/orders/list',
    after: '/v2/orders/list',
    intentRef: 'intent-t21',
    scope: ['src'],
    ...overrides,
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

const ORDER_CLIENT_TS = [
  'export interface OrderDto { id: string; amountCents: number; currency: string }',
  '',
  'export async function fetchOrder(id: string): Promise<OrderDto> {',
  "  const response = await fetch('/api/orders/' + id);",
  '  return response.json() as Promise<OrderDto>;',
  '}',
  '',
].join('\n');

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      target: 'es2022',
      module: 'esnext',
      moduleResolution: 'bundler',
      noEmit: true,
      types: [],
    },
    include: ['src'],
  },
  null,
  2,
);

describe('T-21 react tuple: TSX consumer rename + real tsc', () => {
  const files = {
    'src/api/client.ts': ORDER_CLIENT_TS,
    'src/orders/OrderView.tsx': [
      "import type { OrderDto } from '../api/client.js';",
      "import type { JSX } from 'react';",
      '',
      'export function OrderView({ order }: { order: OrderDto }): JSX.Element {',
      '  return <div>{order.totalCents}</div>;',
      '}',
      '',
    ].join('\n'),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'es2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          noEmit: true,
          types: [],
        },
        include: ['src'],
      },
      null,
      2,
    ),
    'package.json': JSON.stringify({ name: 'react-fixture', private: true, type: 'module' }),
  };

  it(
    'plans, applies, and tsc-accepts a prop rename in a TSX consumer',
    { timeout: 300_000 },
    async () => {
      const fixture = createFixture(files);
      try {
        const install = await pnpmAdd(fixture.root, ['react@19.0.0', '@types/react@19.0.0'], {
          allowBuild: 'none',
        });
        expect(install.exitCode, install.stderr).toBe(0);
        const planned = await TYPESCRIPT_ADAPTER.planFix({
          root: fixture.root,
          files: ['src/api/client.ts', 'src/orders/OrderView.tsx'],
          version: TS_VERSION,
          capability: TYPESCRIPT_REACT_RECORD,
          request: tsRenameRequest('src/api/client.OrderDto', ['src']),
        });
        expect(planned.status).toBe('ok');
        const patch = planned.patch;
        if (patch === null) throw new Error('planned patch is missing');
        await guardAndApply(TYPESCRIPT_ADAPTER, fixture.root, patch, ['src']);
        expect(readFileSync(`${fixture.root}/src/orders/OrderView.tsx`, 'utf8')).toContain(
          'order.amountCents',
        );
        const plan = await TYPESCRIPT_ADAPTER.planChecks({
          root: fixture.root,
          patch,
          capability: TYPESCRIPT_REACT_RECORD,
          request: tsRenameRequest('src/api/client.OrderDto', ['src']),
          runnerIdentity: 'node-linux',
          version: TS_VERSION,
        });
        expect(plan.patchDigest).toBe(patch.patchDigest);
        expect(plan.checks).toHaveLength(1);
        const [check] = plan.checks;
        if (check === undefined) throw new Error('planned check is missing');
        expect(check.checkId).toBe('tsc-noemit');
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, executed.stdout + executed.stderr).toBe(0);
      } finally {
        fixture.cleanup();
      }
    },
  );

  it('refuses a computed member access inside TSX (NEG3-02)', async () => {
    const fixture = createFixture({
      'src/api/client.ts': ORDER_CLIENT_TS,
      'src/orders/OrderView.tsx': [
        "import type { OrderDto } from '../api/client.js';",
        "import type { JSX } from 'react';",
        '',
        'export function OrderView({ order, key }: { order: OrderDto; key: string }): JSX.Element {',
        '  return <div>{order[key as keyof OrderDto]}</div>;',
        '}',
        '',
      ].join('\n'),
    });
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/api/client.ts', 'src/orders/OrderView.tsx'],
        version: TS_VERSION,
        capability: TYPESCRIPT_REACT_RECORD,
        request: tsRenameRequest('src/api/client.OrderDto', ['src']),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
      expect(result.unsupportedSurfaces.join('\n')).toContain('src/orders/OrderView.tsx');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-21 nestjs tuple: decorator routes + real tsc', () => {
  const controller = [
    'declare type ClassDecorator = (target: object) => void;',
    'declare type MethodDecorator = (target: object, key: string | symbol) => void;',
    'declare function Controller(prefix?: string): ClassDecorator;',
    'declare function Get(path?: string): MethodDecorator;',
    '',
    "@Controller('orders')",
    'export class OrdersController {',
    "  @Get('list')",
    '  list(): unknown {',
    '    return { ok: true };',
    '  }',
    '}',
    '',
  ].join('\n');
  const client = [
    'export async function loadOrders(): Promise<unknown> {',
    "  const response = await fetch('/orders/list');",
    '  return response.json();',
    '}',
    '',
  ].join('\n');
  const tsconfig = JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        experimentalDecorators: true,
        noEmit: true,
        types: [],
      },
      include: ['src'],
    },
    null,
    2,
  );

  it(
    'extracts decorator routes and tsc-accepts a route change',
    { timeout: 300_000 },
    async () => {
      const fixture = createFixture({
        'src/orders/orders.controller.ts': controller,
        'src/web/client.ts': client,
        'tsconfig.json': tsconfig,
        'package.json': JSON.stringify({ name: 'nestjs-fixture', private: true, type: 'module' }),
      });
      try {
        const install = await pnpmAdd(fixture.root, ['typescript@5.9.3'], { dev: true });
        expect(install.exitCode, install.stderr).toBe(0);
        const extracted = await TYPESCRIPT_ADAPTER.extract({
          root: fixture.root,
          files: ['src/orders/orders.controller.ts', 'src/web/client.ts'],
          version: TS_VERSION,
          capability: TYPESCRIPT_NESTJS_RECORD,
        });
        expect(extracted.status).toBe('ok');
        expect(
          extracted.graph.nodes.some(
            (node) => node.kind === 'endpoint' && node.label === 'GET /orders/list',
          ),
        ).toBe(true);
        const request = tsRouteRequest({
          entity: 'src/orders/orders.controller.OrdersController',
          before: '/orders/list',
          after: '/orders/all',
        });
        const planned = await TYPESCRIPT_ADAPTER.planFix({
          root: fixture.root,
          files: ['src/orders/orders.controller.ts', 'src/web/client.ts'],
          version: TS_VERSION,
          capability: TYPESCRIPT_NESTJS_RECORD,
          request,
        });
        expect(planned.status).toBe('ok');
        const patch = planned.patch;
        if (patch === null) throw new Error('planned patch is missing');
        await guardAndApply(TYPESCRIPT_ADAPTER, fixture.root, patch, ['src']);
        expect(readFileSync(`${fixture.root}/src/web/client.ts`, 'utf8')).toContain('/orders/all');
        const plan = await TYPESCRIPT_ADAPTER.planChecks({
          root: fixture.root,
          patch,
          capability: TYPESCRIPT_NESTJS_RECORD,
          request,
          runnerIdentity: 'node-linux',
          version: TS_VERSION,
        });
        expect(plan.checks).toHaveLength(1);
        const [check] = plan.checks;
        if (check === undefined) throw new Error('planned check is missing');
        expect(check.checkId).toBe('tsc-noemit');
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, executed.stdout + executed.stderr).toBe(0);
      } finally {
        fixture.cleanup();
      }
    },
  );

  it('fails a route change when the decorator path is computed (NEG3-02)', async () => {
    const fixture = createFixture({
      'src/orders/orders.controller.ts': [
        'declare type ClassDecorator = (target: object) => void;',
        'declare type MethodDecorator = (target: object, key: string | symbol) => void;',
        'declare function Controller(prefix?: string): ClassDecorator;',
        'declare function Get(path?: string): MethodDecorator;',
        'declare const prefix: string;',
        '',
        '@Controller(prefix)',
        'export class OrdersController {',
        '  @Get(prefix + \'/list\')',
        '  list(): unknown {',
        '    return { ok: true };',
        '  }',
        '}',
        '',
      ].join('\n'),
    });
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/orders/orders.controller.ts'],
        version: TS_VERSION,
        capability: TYPESCRIPT_NESTJS_RECORD,
        request: tsRouteRequest({
          entity: 'src/orders/orders.controller.OrdersController',
          before: '/orders/list',
          after: '/orders/all',
        }),
      });
      expect(result.status).toBe('failed');
      expect(result.patch).toBeNull();
      expect(result.unknowns.join('\n')).toContain('not observed');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-21 fastify tuple: call-shape routes + real tsc', () => {
  const app = [
    "import Fastify from 'fastify';",
    'export const app = Fastify();',
    "app.get('/orders/list', () => ({ ok: true }));",
    '',
  ].join('\n');
  const ambient = [
    "declare module 'fastify' {",
    '  const factory: () => { get(path: string, handler: () => unknown): void };',
    '  export default factory;',
    '}',
    '',
  ].join('\n');
  const client = [
    'export async function loadOrders(): Promise<unknown> {',
    "  const response = await fetch('/orders/list');",
    '  return response.json();',
    '}',
    '',
  ].join('\n');

  it(
    'plans, applies, and tsc-accepts a fastify route change',
    { timeout: 300_000 },
    async () => {
      const fixture = createFixture({
        'src/server/app.ts': app,
        'src/types/fastify.d.ts': ambient,
        'src/web/client.ts': client,
        'tsconfig.json': TSCONFIG,
        'package.json': JSON.stringify({ name: 'fastify-fixture', private: true, type: 'module' }),
      });
      try {
        const install = await pnpmAdd(fixture.root, ['typescript@5.9.3'], { dev: true });
        expect(install.exitCode, install.stderr).toBe(0);
        const request = tsRouteRequest({ entity: 'src/server/app.app' });
        const planned = await TYPESCRIPT_ADAPTER.planFix({
          root: fixture.root,
          files: ['src/server/app.ts', 'src/web/client.ts'],
          version: TS_VERSION,
          capability: TYPESCRIPT_FASTIFY_RECORD,
          request,
        });
        expect(planned.status).toBe('ok');
        const patch = planned.patch;
        if (patch === null) throw new Error('planned patch is missing');
        await guardAndApply(TYPESCRIPT_ADAPTER, fixture.root, patch, ['src']);
        const plan = await TYPESCRIPT_ADAPTER.planChecks({
          root: fixture.root,
          patch,
          capability: TYPESCRIPT_FASTIFY_RECORD,
          request,
          runnerIdentity: 'node-linux',
          version: TS_VERSION,
        });
        const [check] = plan.checks;
        if (check === undefined) throw new Error('planned check is missing');
        expect(check.checkId).toBe('tsc-noemit');
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, executed.stdout + executed.stderr).toBe(0);
      } finally {
        fixture.cleanup();
      }
    },
  );

  it('refuses a fastify route embedded in a template expression (NEG3-02)', async () => {
    const fixture = createFixture({
      'src/web/client.ts': [
        'export async function loadOrder(id: string): Promise<unknown> {',
        '  const response = await fetch(`/orders/${id}`);',
        '  return response.json();',
        '}',
        '',
      ].join('\n'),
    });
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/web/client.ts'],
        version: TS_VERSION,
        capability: TYPESCRIPT_FASTIFY_RECORD,
        request: tsRouteRequest({ before: '/orders/', after: '/v2/orders/' }),
      });
      expect(result.status).toBe('unsupported');
      expect(result.unsupportedSurfaces.join('\n')).toContain('template expression');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-21 express tuple: execute the planned tsc check', () => {
  it(
    'applies a route change and the planned tsc check exits 0',
    { timeout: 300_000 },
    async () => {
      const fixture = createFixture({
        'src/types/express.d.ts': [
          "declare module 'express' {",
          '  export function Router(): { get(path: string, handler: () => unknown): void };',
          '}',
          '',
        ].join('\n'),
        'src/server/routes.ts': [
          "import { Router } from 'express';",
          'export const router = Router();',
          "router.get('/orders/list', () => ({ ok: true }));",
          '',
        ].join('\n'),
        'src/web/client.ts': [
          'export async function loadOrders(): Promise<unknown> {',
          "  const response = await fetch('/orders/list');",
          '  return response.json();',
          '}',
          '',
        ].join('\n'),
        'tsconfig.json': TSCONFIG,
        'package.json': JSON.stringify({ name: 'express-fixture', private: true, type: 'module' }),
      });
      try {
        const install = await pnpmAdd(fixture.root, ['typescript@5.9.3'], { dev: true });
        expect(install.exitCode, install.stderr).toBe(0);
        const request = tsRouteRequest();
        const planned = await TYPESCRIPT_ADAPTER.planFix({
          root: fixture.root,
          files: ['src/server/routes.ts', 'src/web/client.ts'],
          version: TS_VERSION,
          capability: TYPESCRIPT_EXPRESS_RECORD,
          request,
        });
        expect(planned.status).toBe('ok');
        const patch = planned.patch;
        if (patch === null) throw new Error('planned patch is missing');
        await guardAndApply(TYPESCRIPT_ADAPTER, fixture.root, patch, ['src']);
        const plan = await TYPESCRIPT_ADAPTER.planChecks({
          root: fixture.root,
          patch,
          capability: TYPESCRIPT_EXPRESS_RECORD,
          request,
          runnerIdentity: 'node-linux',
          version: TS_VERSION,
        });
        const [check] = plan.checks;
        if (check === undefined) throw new Error('planned check is missing');
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, executed.stdout + executed.stderr).toBe(0);
      } finally {
        fixture.cleanup();
      }
    },
  );
});

describe('T-21 next tuple: real next build on the patched app', () => {
  it(
    'plans a DTO rename and a real next build exits 0',
    { timeout: 600_000 },
    async () => {
      const fixture = createFixture({
        'lib/order.ts': [
          'export interface OrderDto { id: string; amountCents: number; currency: string }',
          '',
          'export async function fetchOrder(id: string): Promise<OrderDto> {',
          "  const response = await fetch('/api/orders/' + id);",
          '  return response.json() as Promise<OrderDto>;',
          '}',
          '',
        ].join('\n'),
        'app/page.tsx': [
          "import type { OrderDto } from '../lib/order.js';",
          "import type { JSX } from 'react';",
          '',
          "const order: OrderDto = { id: '1', amountCents: 100, currency: 'USD' };",
          '',
          'export default function Page(): JSX.Element {',
          '  return <h1>{order.totalCents}</h1>;',
          '}',
          '',
        ].join('\n'),
        'app/layout.tsx': [
          "import type { JSX, ReactNode } from 'react';",
          '',
          'export default function Layout({ children }: { children: ReactNode }): JSX.Element {',
          '  return (',
          '    <html>',
          '      <body>{children}</body>',
          '    </html>',
          '  );',
          '}',
          '',
        ].join('\n'),
        'tsconfig.json': JSON.stringify(
          {
            compilerOptions: {
              strict: true,
              target: 'es2022',
              module: 'esnext',
              moduleResolution: 'bundler',
              jsx: 'preserve',
              noEmit: true,
              incremental: false,
              types: [],
            },
            include: ['app', 'lib'],
          },
          null,
          2,
        ),
        'package.json': JSON.stringify({ name: 'next-fixture', private: true, type: 'module' }),
      });
      try {
        const install = await pnpmAdd(
          fixture.root,
          [
            'next@15.1.0',
            'react@19.0.0',
            'react-dom@19.0.0',
            'typescript@5.9.3',
            '@types/react@19.0.0',
            '@types/node@24.8.0',
          ],
          { allowBuild: 'sharp' },
        );
        expect(install.exitCode, install.stderr).toBe(0);
        const request = tsRenameRequest('lib/order.OrderDto', ['app', 'lib']);
        const planned = await TYPESCRIPT_ADAPTER.planFix({
          root: fixture.root,
          files: ['lib/order.ts', 'app/page.tsx'],
          version: TS_VERSION,
          capability: TYPESCRIPT_ADAPTER_RECORD,
          request,
        });
        expect(planned.status).toBe('ok');
        const patch = planned.patch;
        if (patch === null) throw new Error('planned patch is missing');
        await guardAndApply(TYPESCRIPT_ADAPTER, fixture.root, patch, ['app', 'lib']);
        expect(readFileSync(`${fixture.root}/app/page.tsx`, 'utf8')).toContain('order.amountCents');
        const plan = await TYPESCRIPT_ADAPTER.planChecks({
          root: fixture.root,
          patch,
          capability: TYPESCRIPT_ADAPTER_RECORD,
          request,
          runnerIdentity: 'node-linux',
          version: TS_VERSION,
        });
        const [check] = plan.checks;
        if (check === undefined) throw new Error('planned check is missing');
        expect(check.checkId).toBe('next-build');
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, executed.stdout + executed.stderr).toBe(0);
        expect(executed.stdout).toContain('Compiled successfully');
      } finally {
        fixture.cleanup();
      }
    },
  );
});

describe('T-21 prisma tuple: schema rename + real validate', () => {
  const schema = [
    'datasource db {',
    '  provider = "sqlite"',
    '  url      = "file:./dev.db"',
    '}',
    '',
    'generator client {',
    '  provider = "prisma-client-js"',
    '}',
    '',
    'model Order {',
    '  id         Int @id @default(autoincrement())',
    '  totalCents Int',
    '}',
    '',
  ].join('\n');

  function prismaRequest(overrides: Record<string, unknown> = {}) {
    return AdapterFixRequestSchema.parse({
      schemaVersion: '1',
      requestId: 'req-t21-prisma',
      changeKind: 'field_rename',
      entity: 'prisma/schema.Order',
      before: 'totalCents',
      after: 'amountCents',
      intentRef: 'intent-t21',
      scope: ['prisma'],
      ...overrides,
    });
  }

  it(
    'extracts the schema, renames the field, and real prisma validate exits 0',
    { timeout: 300_000 },
    async () => {
      const fixture = createFixture({ 'prisma/schema.prisma': schema });
      try {
        const extracted = await TYPESCRIPT_ADAPTER.extract({
          root: fixture.root,
          files: ['prisma/schema.prisma'],
          version: TS_VERSION,
          capability: TYPESCRIPT_PRISMA_RECORD,
        });
        expect(extracted.status).toBe('ok');
        expect(
          extracted.graph.nodes.some((node) => node.label?.includes('Order') === true),
        ).toBe(true);
        const request = prismaRequest();
        const planned = await TYPESCRIPT_ADAPTER.planFix({
          root: fixture.root,
          files: ['prisma/schema.prisma'],
          version: TS_VERSION,
          capability: TYPESCRIPT_PRISMA_RECORD,
          request,
        });
        expect(planned.status).toBe('ok');
        const patch = planned.patch;
        if (patch === null) throw new Error('planned patch is missing');
        await guardAndApply(TYPESCRIPT_ADAPTER, fixture.root, patch, ['prisma']);
        const patched = readFileSync(`${fixture.root}/prisma/schema.prisma`, 'utf8');
        expect(patched).toContain('amountCents');
        expect(patched).not.toContain('totalCents');
        const plan = await TYPESCRIPT_ADAPTER.planChecks({
          root: fixture.root,
          patch,
          capability: TYPESCRIPT_PRISMA_RECORD,
          request,
          runnerIdentity: 'node-linux',
          version: TS_VERSION,
        });
        expect(plan.patchDigest).toBe(patch.patchDigest);
        const [check] = plan.checks;
        if (check === undefined) throw new Error('planned check is missing');
        expect(check.checkId).toBe('prisma-validate');
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, executed.stdout + executed.stderr).toBe(0);
      } finally {
        fixture.cleanup();
      }
    },
  );

  it('fails extraction on a schema the native validator rejects', async () => {
    const fixture = createFixture({
      'prisma/schema.prisma': [
        'datasource db {',
        '  provider = "sqlite"',
        '  url      = "file:./dev.db"',
        '}',
        '',
        'model Order {',
        '  id         Int @id @default(autoincrement())',
        '  totalCents NotAType',
        '}',
        '',
      ].join('\n'),
    });
    try {
      const result = await TYPESCRIPT_ADAPTER.extract({
        root: fixture.root,
        files: ['prisma/schema.prisma'],
        version: TS_VERSION,
        capability: TYPESCRIPT_PRISMA_RECORD,
      });
      expect(result.status).toBe('failed');
      expect(result.unknowns.join('\n')).toContain('prisma');
    } finally {
      fixture.cleanup();
    }
  });

  it('fails a rename when TypeScript consumers use the old field', async () => {
    const fixture = createFixture({
      'prisma/schema.prisma': schema,
      'src/use.ts': [
        "import type { OrderDto } from './dto.js';",
        'export function total(order: OrderDto): number {',
        '  return order.totalCents;',
        '}',
        '',
      ].join('\n'),
      'src/dto.ts': ['export interface OrderDto { totalCents: number }', ''].join('\n'),
    });
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['prisma/schema.prisma', 'src/use.ts', 'src/dto.ts'],
        version: TS_VERSION,
        capability: TYPESCRIPT_PRISMA_RECORD,
        request: prismaRequest(),
      });
      expect(result.status).toBe('failed');
      expect(result.patch).toBeNull();
      expect(result.unknowns.join('\n')).toContain('src/use.ts');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-21 fastapi tuple: execute the planned checks', () => {
  const models = [
    'from pydantic import BaseModel',
    '',
    '',
    'class OrderOut(BaseModel):',
    '    id: str',
    '    amount_cents: int',
    '',
  ].join('\n');
  const billing = [
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

  function request(overrides: Record<string, unknown> = {}) {
    return AdapterFixRequestSchema.parse({
      schemaVersion: '1',
      requestId: 'req-t21-py',
      changeKind: 'field_rename',
      entity: 'app.models.OrderOut',
      before: 'total_cents',
      after: 'amount_cents',
      intentRef: 'intent-t21',
      scope: ['app'],
      ...overrides,
    });
  }

  it('applies a rename and the planned compile+import checks exit 0', { timeout: 120_000 }, async () => {
    const probe = await runPython(process.cwd(), [
      '-c',
      'import sys; print(".".join(map(str, sys.version_info[:3])))',
    ]);
    expect(probe.exitCode).toBe(0);
    const version = probe.stdout.trim();
    const fixture = createFixture({ 'app/models.py': models, 'app/billing.py': billing });
    try {
      const planned = await PYTHON_ADAPTER.planFix({
        root: fixture.root,
        files: ['app/models.py', 'app/billing.py'],
        version,
        capability: PYTHON_ADAPTER_RECORD,
        request: request(),
      });
      expect(planned.status).toBe('ok');
      const patch = planned.patch;
      if (patch === null) throw new Error('planned patch is missing');
      await guardAndApply(PYTHON_ADAPTER, fixture.root, patch, ['app']);
      const plan = await PYTHON_ADAPTER.planChecks({
        root: fixture.root,
        patch,
        capability: PYTHON_ADAPTER_RECORD,
        request: request(),
        runnerIdentity: 'python-linux',
        version,
      });
      expect(plan.checks.length).toBeGreaterThan(0);
      for (const check of plan.checks) {
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, `${check.checkId}: ${executed.stdout}${executed.stderr}`).toBe(0);
      }
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-21 django tuple: model rename + real manage.py test', () => {
  it('plans a field rename and a real django test run exits 0', { timeout: 300_000 }, async () => {
    const probe = await runPython(process.cwd(), [
      '-c',
      'import sys; print(".".join(map(str, sys.version_info[:3])))',
    ]);
    expect(probe.exitCode).toBe(0);
    const version = probe.stdout.trim();
    const fixture = createFixture({
      'manage.py': [
        '#!/usr/bin/env python',
        'import os',
        'import sys',
        '',
        '',
        'def main():',
        "    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')",
        '    from django.core.management import execute_from_command_line',
        '    execute_from_command_line(sys.argv)',
        '',
        '',
        "if __name__ == '__main__':",
        '    main()',
        '',
      ].join('\n'),
      'proj/__init__.py': '',
      'proj/settings.py': [
        'SECRET_KEY = "django-test-fixture-key-not-a-secret"',
        'DEBUG = False',
        'INSTALLED_APPS = ["django.contrib.contenttypes", "django.contrib.auth", "shop"]',
        'DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}',
        'USE_TZ = True',
        '',
      ].join('\n'),
      'shop/__init__.py': '',
      'shop/models.py': [
        'from django.db import models',
        '',
        '',
        'class Order(models.Model):',
        '    amount_cents = models.IntegerField()',
        '',
      ].join('\n'),
      'shop/services.py': [
        'from shop.models import Order',
        '',
        '',
        'def total(order: Order) -> int:',
        '    return order.total_cents',
        '',
      ].join('\n'),
      'shop/tests.py': [
        'from django.test import TestCase',
        '',
        'from shop.models import Order',
        'from shop.services import total',
        '',
        '',
        'class OrderTest(TestCase):',
        '    def test_total(self):',
        '        self.assertEqual(total(Order(amount_cents=50)), 50)',
        '',
      ].join('\n'),
    });
    try {
      const req = AdapterFixRequestSchema.parse({
        schemaVersion: '1',
        requestId: 'req-t21-dj',
        changeKind: 'field_rename',
        entity: 'shop.models.Order',
        before: 'total_cents',
        after: 'amount_cents',
        intentRef: 'intent-t21',
        scope: ['shop'],
      });
      const planned = await PYTHON_ADAPTER.planFix({
        root: fixture.root,
        files: ['shop/models.py', 'shop/services.py'],
        version,
        capability: PYTHON_DJANGO_RECORD,
        request: req,
      });
      expect(planned.status).toBe('ok');
      const patch = planned.patch;
      if (patch === null) throw new Error('planned patch is missing');
      await guardAndApply(PYTHON_ADAPTER, fixture.root, patch, ['shop']);
      expect(readFileSync(`${fixture.root}/shop/services.py`, 'utf8')).toContain(
        'order.amount_cents',
      );
      const plan = await PYTHON_ADAPTER.planChecks({
        root: fixture.root,
        patch,
        capability: PYTHON_DJANGO_RECORD,
        request: req,
        runnerIdentity: 'python-linux',
        version,
      });
      expect(plan.checks).toHaveLength(1);
      const [check] = plan.checks;
      if (check === undefined) throw new Error('planned check is missing');
      expect(check.checkId).toBe('django-test');
      const executed = await runPlannedCheck(check);
      expect(executed.exitCode, executed.stdout + executed.stderr).toBe(0);
      expect(executed.stdout + executed.stderr).toContain('OK');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-21 pydantic tuple: schema rename + real validation', () => {
  it('plans a rename and real pydantic validation exits 0', { timeout: 120_000 }, async () => {
    const probe = await runPython(process.cwd(), [
      '-c',
      'import sys; print(".".join(map(str, sys.version_info[:3])))',
    ]);
    expect(probe.exitCode).toBe(0);
    const version = probe.stdout.trim();
    const fixture = createFixture({
      'app/schemas.py': [
        'from pydantic import BaseModel',
        '',
        '',
        'class OrderSchema(BaseModel):',
        '    id: str',
        '    amount_cents: int',
        '',
      ].join('\n'),
      'app/cart.py': [
        'from app.schemas import OrderSchema',
        '',
        '',
        'def read(order: OrderSchema) -> int:',
        '    return order.total_cents',
        '',
        '',
        'def build(order_id: str) -> OrderSchema:',
        '    return OrderSchema(id=order_id, total_cents=100)',
        '',
      ].join('\n'),
    });
    try {
      const req = AdapterFixRequestSchema.parse({
        schemaVersion: '1',
        requestId: 'req-t21-pd',
        changeKind: 'field_rename',
        entity: 'app.schemas.OrderSchema',
        before: 'total_cents',
        after: 'amount_cents',
        intentRef: 'intent-t21',
        scope: ['app'],
      });
      const planned = await PYTHON_ADAPTER.planFix({
        root: fixture.root,
        files: ['app/schemas.py', 'app/cart.py'],
        version,
        capability: PYTHON_PYDANTIC_RECORD,
        request: req,
      });
      expect(planned.status).toBe('ok');
      const patch = planned.patch;
      if (patch === null) throw new Error('planned patch is missing');
      await guardAndApply(PYTHON_ADAPTER, fixture.root, patch, ['app']);
      const plan = await PYTHON_ADAPTER.planChecks({
        root: fixture.root,
        patch,
        capability: PYTHON_PYDANTIC_RECORD,
        request: req,
        runnerIdentity: 'python-linux',
        version,
      });
      for (const check of plan.checks) {
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, `${check.checkId}: ${executed.stdout}${executed.stderr}`).toBe(0);
      }
      const validated = await runPython(
        fixture.root,
        ['-c', 'from app.schemas import OrderSchema; print(OrderSchema(id="1", amount_cents=100).amount_cents)'],
      );
      expect(validated.exitCode, validated.stderr).toBe(0);
      expect(validated.stdout.trim()).toBe('100');
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses to plan when a getattr could touch the entity (NEG3-02)', async () => {
    const probe = await runPython(process.cwd(), [
      '-c',
      'import sys; print(".".join(map(str, sys.version_info[:3])))',
    ]);
    const version = probe.stdout.trim();
    const fixture = createFixture({
      'app/schemas.py': [
        'from pydantic import BaseModel',
        '',
        '',
        'class OrderSchema(BaseModel):',
        '    id: str',
        '    amount_cents: int',
        '',
      ].join('\n'),
      'app/cart.py': [
        'from app.schemas import OrderSchema',
        '',
        '',
        'def read_field(order: OrderSchema, field: str):',
        '    return getattr(order, field)',
        '',
      ].join('\n'),
    });
    try {
      const result = await PYTHON_ADAPTER.planFix({
        root: fixture.root,
        files: ['app/schemas.py', 'app/cart.py'],
        version,
        capability: PYTHON_PYDANTIC_RECORD,
        request: AdapterFixRequestSchema.parse({
          schemaVersion: '1',
          requestId: 'req-t21-pd-neg',
          changeKind: 'field_rename',
          entity: 'app.schemas.OrderSchema',
          before: 'total_cents',
          after: 'amount_cents',
          intentRef: 'intent-t21',
          scope: ['app'],
        }),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
      expect(result.unsupportedSurfaces.join('\n')).toContain('app/cart.py');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-21 sqlalchemy tuple: mapping rename + real sqlite round-trip', () => {
  it('plans a rename and a real mapping round-trip exits 0', { timeout: 120_000 }, async () => {
    const probe = await runPython(process.cwd(), [
      '-c',
      'import sys; print(".".join(map(str, sys.version_info[:3])))',
    ]);
    expect(probe.exitCode).toBe(0);
    const version = probe.stdout.trim();
    const fixture = createFixture({
      'app/models.py': [
        'from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column',
        '',
        '',
        'class Base(DeclarativeBase):',
        '    pass',
        '',
        '',
        'class Order(Base):',
        "    __tablename__ = 'orders'",
        '    id: Mapped[int] = mapped_column(primary_key=True)',
        '    amount_cents: Mapped[int] = mapped_column()',
        '',
      ].join('\n'),
      'app/repo.py': [
        'from app.models import Order',
        '',
        '',
        'def read(order: Order) -> int:',
        '    return order.total_cents',
        '',
      ].join('\n'),
    });
    try {
      const req = AdapterFixRequestSchema.parse({
        schemaVersion: '1',
        requestId: 'req-t21-sa',
        changeKind: 'field_rename',
        entity: 'app.models.Order',
        before: 'total_cents',
        after: 'amount_cents',
        intentRef: 'intent-t21',
        scope: ['app'],
      });
      const planned = await PYTHON_ADAPTER.planFix({
        root: fixture.root,
        files: ['app/models.py', 'app/repo.py'],
        version,
        capability: PYTHON_SQLALCHEMY_RECORD,
        request: req,
      });
      expect(planned.status).toBe('ok');
      const patch = planned.patch;
      if (patch === null) throw new Error('planned patch is missing');
      await guardAndApply(PYTHON_ADAPTER, fixture.root, patch, ['app']);
      const plan = await PYTHON_ADAPTER.planChecks({
        root: fixture.root,
        patch,
        capability: PYTHON_SQLALCHEMY_RECORD,
        request: req,
        runnerIdentity: 'python-linux',
        version,
      });
      for (const check of plan.checks) {
        const executed = await runPlannedCheck(check);
        expect(executed.exitCode, `${check.checkId}: ${executed.stdout}${executed.stderr}`).toBe(0);
      }
      const roundTrip = await runPython(fixture.root, [
        '-c',
        [
          'from sqlalchemy import create_engine, select',
          'from sqlalchemy.orm import Session',
          'from app.models import Base, Order',
          'engine = create_engine("sqlite+pysqlite:///:memory:")',
          'Base.metadata.create_all(engine)',
          'with Session(engine) as session:',
          '    session.add(Order(amount_cents=7))',
          '    session.commit()',
          '    print(session.scalar(select(Order.amount_cents)))',
        ].join('\n'),
      ]);
      expect(roundTrip.exitCode, roundTrip.stderr).toBe(0);
      expect(roundTrip.stdout.trim()).toBe('7');
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses to plan when a computed subscript could touch the entity (NEG3-02)', async () => {
    const probe = await runPython(process.cwd(), [
      '-c',
      'import sys; print(".".join(map(str, sys.version_info[:3])))',
    ]);
    const version = probe.stdout.trim();
    const fixture = createFixture({
      'app/models.py': [
        'from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column',
        '',
        '',
        'class Base(DeclarativeBase):',
        '    pass',
        '',
        '',
        'class Order(Base):',
        "    __tablename__ = 'orders'",
        '    id: Mapped[int] = mapped_column(primary_key=True)',
        '    amount_cents: Mapped[int] = mapped_column()',
        '',
      ].join('\n'),
      'app/repo.py': [
        'from app.models import Order',
        '',
        '',
        'def read(row, key: str):',
        '    return row[key]',
        '',
      ].join('\n'),
    });
    try {
      const result = await PYTHON_ADAPTER.planFix({
        root: fixture.root,
        files: ['app/models.py', 'app/repo.py'],
        version,
        capability: PYTHON_SQLALCHEMY_RECORD,
        request: AdapterFixRequestSchema.parse({
          schemaVersion: '1',
          requestId: 'req-t21-sa-neg',
          changeKind: 'field_rename',
          entity: 'app.models.Order',
          before: 'total_cents',
          after: 'amount_cents',
          intentRef: 'intent-t21',
          scope: ['app'],
        }),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
      expect(result.unsupportedSurfaces.join('\n')).toContain('app/repo.py');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('T-21 unsupported frameworks stay explicit (NEG3-09)', () => {
  function unregisteredRecord(ecosystem: 'typescript' | 'python', framework: string): CapabilityRecord {
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
        runnerProfile: ecosystem === 'typescript' ? 'node-linux' : 'python-linux',
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

  it('refuses planFix for an unregistered TypeScript framework', async () => {
    const fixture = createFixture({ 'src/a.ts': 'export const a = 1;\n' });
    try {
      const result = await TYPESCRIPT_ADAPTER.planFix({
        root: fixture.root,
        files: ['src/a.ts'],
        version: TS_VERSION,
        capability: unregisteredRecord('typescript', 'nuxt'),
        request: tsRenameRequest('src/a.a', ['src']),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses planFix for an unregistered Python framework', async () => {
    const probe = await runPython(process.cwd(), [
      '-c',
      'import sys; print(".".join(map(str, sys.version_info[:3])))',
    ]);
    const fixture = createFixture({ 'app/a.py': 'A = 1\n' });
    try {
      const result = await PYTHON_ADAPTER.planFix({
        root: fixture.root,
        files: ['app/a.py'],
        version: probe.stdout.trim(),
        capability: unregisteredRecord('python', 'flask'),
        request: AdapterFixRequestSchema.parse({
          schemaVersion: '1',
          requestId: 'req-t21-flask',
          changeKind: 'field_rename',
          entity: 'app.a.A',
          before: 'x',
          after: 'y',
          intentRef: 'intent-t21',
          scope: ['app'],
        }),
      });
      expect(result.status).toBe('unsupported');
      expect(result.patch).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });
});
