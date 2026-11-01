import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

/**
 * Shared rig for fixture-baseline native tests (WP3-06/17/16 dry runs).
 *
 * Spawns the real fixture service + consumer as child processes, drives them
 * over HTTP, and stops everything on demand. No verdicts here — callers assert
 * what they need. Timeouts fail the calling test, never pass it.
 */

export interface RigConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly fixtureDir: string;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not allocate a probe port.'));
        return;
      }
      const port = address.port;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

function waitForLine(proc: ChildProcess, needle: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${needle}.`));
    }, timeoutMs);
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString('utf8').includes(needle)) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Process exited (${String(code)}) before ${needle}.`));
    });
  });
}

export function createRig(config: RigConfig): {
  startService(version: 'v1' | 'v2'): Promise<{ port: number }>;
  startConsumer(): Promise<void>;
  stopAll(): Promise<void>;
  orderStatus(port: number, orderId: string): Promise<string>;
  waitForStatus(port: number, orderId: string, want: string, timeoutMs: number): Promise<number>;
  placeOrder(port: number, tenant: string, amountCents: number): Promise<string>;
} {
  const processes: ChildProcess[] = [];

  async function stopAll(): Promise<void> {
    for (const proc of processes.splice(0)) {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        continue;
      }
      proc.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve(undefined);
        }, 5_000);
        proc.on('exit', () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
    }
  }

  return {
    async startService(version: 'v1' | 'v2'): Promise<{ port: number }> {
      const port = await freePort();
      const proc = spawn(
        process.execPath,
        [
          join(config.fixtureDir, 'service.mjs'),
          '--port',
          String(port),
          '--version',
          version,
          '--database-url',
          config.databaseUrl,
          '--redis-url',
          config.redisUrl,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      processes.push(proc);
      await waitForLine(proc, '"event":"listening"', 15_000);
      return { port };
    },

    async startConsumer(): Promise<void> {
      const proc = spawn(
        process.execPath,
        [join(config.fixtureDir, 'consumer.mjs'), '--database-url', config.databaseUrl, '--redis-url', config.redisUrl],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      processes.push(proc);
      await waitForLine(proc, '"event":"consumer-ready"', 15_000);
    },

    stopAll,

    async orderStatus(port: number, orderId: string): Promise<string> {
      const response = await fetch(`http://127.0.0.1:${String(port)}/orders/${orderId}`);
      const body = (await response.json()) as { status?: unknown };
      return typeof body.status === 'string' ? body.status : '';
    },

    async waitForStatus(port: number, orderId: string, want: string, timeoutMs: number): Promise<number> {
      const started = Date.now();
      for (;;) {
        const response = await fetch(`http://127.0.0.1:${String(port)}/orders/${orderId}`);
        const body = (await response.json()) as { status?: unknown };
        if (body.status === want) {
          return Date.now() - started;
        }
        if (Date.now() - started > timeoutMs) {
          throw new Error(`Order ${orderId} never reached ${want}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },

    async placeOrder(port: number, tenant: string, amountCents: number): Promise<string> {
      const response = await fetch(`http://127.0.0.1:${String(port)}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant, amountCents }),
      });
      if (response.status !== 201) {
        throw new Error(`Order creation returned ${String(response.status)}.`);
      }
      const body = (await response.json()) as { orderId?: unknown };
      if (typeof body.orderId !== 'string') {
        throw new Error('Order creation returned no order id.');
      }
      return body.orderId;
    },
  };
}
