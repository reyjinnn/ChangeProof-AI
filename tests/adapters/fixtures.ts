import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Fixture authoring for adapter conformance.
 *
 * Fixtures are written to a temporary directory and removed afterwards: they are
 * test inputs, never part of the product source, and never executed with host
 * authority. Each fixture pins the toolchain version it was written for, so a
 * conformance run against a different version is a different case rather than a
 * silently reused result.
 */

export interface Fixture {
  readonly root: string;
  readonly files: Readonly<Record<string, string>>;
  write(path: string, content: string): void;
  cleanup(): void;
}

export function createFixture(files: Readonly<Record<string, string>>): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'changeproof-fixture-'));
  const fixture: Fixture = {
    root,
    files,
    write(path: string, content: string): void {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, 'utf8');
    },
    cleanup(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };

  for (const [path, content] of Object.entries(files)) {
    fixture.write(path, content);
  }
  return fixture;
}

/**
 * A TypeScript/Node consumer that calls a typed API client.
 *
 * The positive case resolves the call to a concrete symbol; the negative case
 * reaches the same client through a computed property, which a static extractor
 * cannot resolve and must therefore report as `unresolved`.
 */
export const TYPESCRIPT_CONSUMER = {
  'package.json': JSON.stringify(
    {
      name: 'web-storefront',
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies: { next: '15.1.0' },
    },
    null,
    2,
  ),
  'src/api/client.ts': [
    "export interface OrderDto { id: string; totalCents: number; currency: string }",
    '',
    'export async function fetchOrder(id: string): Promise<OrderDto> {',
    '  const response = await fetch(`/api/orders/${id}`);',
    '  return response.json() as Promise<OrderDto>;',
    '}',
  ].join('\n'),
  'src/orders/checkout.ts': [
    "import { fetchOrder } from '../api/client.js';",
    '',
    'export async function checkout(orderId: string): Promise<number> {',
    '  const order = await fetchOrder(orderId);',
    '  return order.totalCents;',
    '}',
  ].join('\n'),
  'src/orders/dynamic.ts': [
    "import * as client from '../api/client.js';",
    '',
    'export async function callDynamic(operation: string): Promise<unknown> {',
    "  const fn = (client as unknown as Record<string, () => Promise<unknown>>)[operation];",
    '  return fn();',
    '}',
  ].join('\n'),
} as const;

/** A FastAPI-style Python service exposing a typed route. */
export const PYTHON_SERVICE = {
  'requirements.txt': 'fastapi==0.115.6\npydantic==2.10.4\n',
  'app/main.py': [
    'from fastapi import FastAPI',
    'from pydantic import BaseModel',
    '',
    'app = FastAPI()',
    '',
    '',
    'class OrderOut(BaseModel):',
    '    id: str',
    '    total_cents: int',
    '',
    '',
    '@app.get("/api/orders/{order_id}")',
    'async def get_order(order_id: str) -> OrderOut:',
    '    return OrderOut(id=order_id, total_cents=100)',
  ].join('\n'),
  'app/handlers.py': [
    'from .main import get_order',
    '',
    '',
    'async def handle(order_id: str) -> int:',
    '    result = await get_order(order_id)',
    '    return result.total_cents',
  ].join('\n'),
} as const;

/** A Spring Boot-style JVM service with a Java controller and a Kotlin service. */
export const JVM_SERVICE = {
  'pom.xml': [
    '<project>',
    '  <modelVersion>4.0.0</modelVersion>',
    '  <groupId>com.acme</groupId>',
    '  <artifactId>orders-service</artifactId>',
    '  <version>1.0.0</version>',
    '  <properties>',
    '    <maven.compiler.source>21</maven.compiler.source>',
    '    <maven.compiler.target>21</maven.compiler.target>',
    '    <kotlin.version>2.1.0</kotlin.version>',
    '  </properties>',
    '</project>',
  ].join('\n'),
  'src/main/java/com/acme/OrderController.java': [
    'package com.acme;',
    '',
    'import org.springframework.web.bind.annotation.GetMapping;',
    'import org.springframework.web.bind.annotation.PathVariable;',
    'import org.springframework.web.bind.annotation.RestController;',
    '',
    '@RestController',
    'public class OrderController {',
    '  @GetMapping("/api/orders/{orderId}")',
    '  public OrderDto getOrder(@PathVariable String orderId) {',
    '    return new OrderDto(orderId, 100L);',
    '  }',
    '}',
  ].join('\n'),
  'src/main/java/com/acme/OrderDto.java': [
    'package com.acme;',
    '',
    'public record OrderDto(String id, long totalCents) {}',
  ].join('\n'),
  'src/main/kotlin/com/acme/OrderService.kt': [
    'package com.acme',
    '',
    'class OrderService {',
    '  suspend fun totalCents(orderId: String): Long = 100L',
    '}',
  ].join('\n'),
} as const;

/** A Laravel-style PHP service with a controller and a route file. */
export const PHP_SERVICE = {
  'composer.json': JSON.stringify(
    {
      name: 'acme/orders',
      require: { php: '^8.3', 'laravel/framework': '^11.0' },
    },
    null,
    2,
  ),
  'app/Http/Controllers/OrderController.php': [
    '<?php',
    '',
    'namespace App\\Http\\Controllers;',
    '',
    'class OrderController',
    '{',
    '    public function show(string $orderId): array',
    '    {',
    '        return ["id" => $orderId, "total_cents" => 100];',
    '    }',
    '}',
  ].join('\n'),
  'routes/api.php': [
    '<?php',
    '',
    "use App\\Http\\Controllers\\OrderController;",
    '',
    "Route::get('/api/orders/{orderId}', [OrderController::class, 'show']);",
  ].join('\n'),
} as const;
