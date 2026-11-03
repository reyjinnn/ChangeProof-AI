import { describe, expect, it } from 'vitest';

import type { ModelCompleteInput } from '../../src/core/index.js';
import { createModelClient, type ModelTransport } from '../../src/modules/agent/index.js';

/**
 * WP3-07 / T-20 — model broker (FR3-07, NEG3-08/10/13).
 *
 * Written before the implementation. The broker sends allowlisted context
 * with recorded IDs, revalidates every response, raises typed failures for
 * outage/malformed/no-tool-call, enforces a cost ceiling that is never
 * reset, and falls back only through explicit configuration. Transports are
 * fakes: no live provider exists at the configured URL (see the phase
 * report), and no endpoint is invented to fake one.
 */

const SECRET = 'broker-held-model-secret';

function fakeSecrets(): { readCredential(ref: string): Promise<string> } {
  return {
    readCredential(ref: string): Promise<string> {
      if (ref !== 'model-secret-ref') {
        return Promise.reject(new Error('unknown secret ref'));
      }
      return Promise.resolve(SECRET);
    },
  };
}

interface SeenRequest {
  credential: string;
  body: unknown;
}

function fakeTransport(handler: (seen: SeenRequest) => { status: number; bodyText: string }): ModelTransport & {
  seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  return {
    seen,
    send(request: SeenRequest): Promise<{ status: number; bodyText: string }> {
      seen.push(request);
      return Promise.resolve(handler(request));
    },
  };
}

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: 'muse-spark-1.3',
    outputText: ' диагноза: missing null check',
    toolCalls: [{ name: 'read_file', arguments: '{"path":"src/a.ts"}' }],
    usage: { inputTokens: 100, outputTokens: 50 },
    providerRequestId: 'req-1',
    ...overrides,
  });
}

function input(overrides: Partial<ModelCompleteInput> = {}): ModelCompleteInput {
  return {
    promptId: 'prompt-diagnose-1',
    messages: [
      { role: 'system', content: 'You diagnose.' },
      { role: 'user', content: 'Null deref at line 9.', source: 'incident' },
    ],
    tools: [{ name: 'read_file', description: 'Read a file.', parameters: '{"type":"object"}' }],
    maxTokens: 500,
    requireToolCall: true,
    ...overrides,
  };
}

function clientFor(transport: ModelTransport, overrides: Record<string, unknown> = {}) {
  return createModelClient({
    transport,
    secrets: fakeSecrets(),
    secretRef: 'model-secret-ref',
    provider: 'meta-muse-spark',
    model: 'muse-spark-1.3',
    configId: 'config-default-1',
    tokenCeiling: 100_000,
    ...overrides,
  });
}

describe('allowlisted context and recorded identity (FR3-07)', () => {
  it('sends broker-owned and allowlisted messages while dropping the rest', async () => {
    const transport = fakeTransport(() => ({ status: 200, bodyText: validBody() }));
    const client = clientFor(transport);
    const result = await client.complete(
      input({
        messages: [
          { role: 'system', content: 'You diagnose.' },
          { role: 'user', content: 'Keep me.', source: 'incident' },
          { role: 'user', content: 'Drop me.', source: 'untrusted-log' },
        ],
        contextAllowlist: ['incident'],
      }),
    );
    expect(result.droppedContextMessages).toBe(1);
    const sent = transport.seen[0]?.body as { messages: { content: string }[] };
    expect(sent.messages.map((message) => message.content)).toEqual(['You diagnose.', 'Keep me.']);
  });

  it('admits broker-owned content only when no allowlist is given', async () => {
    const transport = fakeTransport(() => ({ status: 200, bodyText: validBody() }));
    const client = clientFor(transport);
    const result = await client.complete(input());
    expect(result.droppedContextMessages).toBe(1);
    const sent = transport.seen[0]?.body as { messages: { content: string }[] };
    expect(sent.messages).toHaveLength(1);
  });

  it('records prompt, config, and model ids on the result', async () => {
    const transport = fakeTransport(() => ({ status: 200, bodyText: validBody() }));
    const client = clientFor(transport);
    const result = await client.complete(input({ contextAllowlist: ['incident'] }));
    expect(result.promptId).toBe('prompt-diagnose-1');
    expect(result.configId).toBe('config-default-1');
    expect(result.model).toBe('muse-spark-1.3');
    expect(result.providerRequestId).toBe('req-1');
    expect(result.usedFallback).toBe(false);
  });

  it('reads the credential at call time without logging or echoing it', async () => {
    const transport = fakeTransport(() => ({ status: 200, bodyText: validBody() }));
    const client = clientFor(transport);
    const result = await client.complete(input({ contextAllowlist: ['incident'] }));
    expect(transport.seen[0]?.credential).toBe(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('typed response failures (NEG3-08/10)', () => {
  it('rejects a malformed response instead of propagating it', async () => {
    const transport = fakeTransport(() => ({ status: 200, bodyText: 'not-json{{{' }));
    const client = clientFor(transport);
    await expect(client.complete(input({ contextAllowlist: ['incident'] }))).rejects.toThrow(/malformed/i);
  });

  it('rejects tool calls with unparseable arguments', async () => {
    const transport = fakeTransport(() => ({
      status: 200,
      bodyText: validBody({ toolCalls: [{ name: 'read_file', arguments: '{oops' }] }),
    }));
    const client = clientFor(transport);
    await expect(client.complete(input({ contextAllowlist: ['incident'] }))).rejects.toThrow(/malformed/i);
  });

  it('rejects a model identity mismatch instead of trusting the label', async () => {
    const transport = fakeTransport(() => ({ status: 200, bodyText: validBody({ model: 'other-model-9' }) }));
    const client = clientFor(transport);
    await expect(client.complete(input({ contextAllowlist: ['incident'] }))).rejects.toThrow(/identity/i);
  });

  it('raises a typed failure when a required tool call is missing', async () => {
    const transport = fakeTransport(() => ({ status: 200, bodyText: validBody({ toolCalls: [] }) }));
    const client = clientFor(transport);
    await expect(client.complete(input({ contextAllowlist: ['incident'] }))).rejects.toThrow(/no tool call/i);
  });

  it('raises a typed outage when the transport fails', async () => {
    const transport = fakeTransport(() => {
      throw new Error('socket hangup');
    });
    const client = clientFor(transport);
    await expect(client.complete(input({ contextAllowlist: ['incident'] }))).rejects.toThrow(/outage/i);
  });

  it('raises a typed outage on a non-200 provider status without leaking the body', async () => {
    const transport = fakeTransport(() => ({ status: 500, bodyText: 'internal secrets here' }));
    const client = clientFor(transport);
    const failure = await client.complete(input({ contextAllowlist: ['incident'] })).then(
      () => 'unexpected-success',
      (error: unknown) => (error instanceof Error ? error.message : 'unexpected-shape'),
    );
    expect(failure).toMatch(/outage/i);
    expect(failure).not.toContain('internal secrets here');
  });
});

describe('cost ceiling is never reset (NEG3-13)', () => {
  it('refuses calls past the token ceiling and keeps refusing', async () => {
    const transport = fakeTransport(() => ({ status: 200, bodyText: validBody() }));
    const client = clientFor(transport, { tokenCeiling: 200 });
    const first = await client.complete(input({ contextAllowlist: ['incident'], maxTokens: 40 }));
    expect(first.cumulativeTokens).toBe(150);
    await expect(client.complete(input({ contextAllowlist: ['incident'], maxTokens: 60 }))).rejects.toThrow(
      /ceiling/i,
    );
    await expect(client.complete(input({ contextAllowlist: ['incident'], maxTokens: 60 }))).rejects.toThrow(/ceiling/i);
    const small = await client.complete(input({ contextAllowlist: ['incident'], maxTokens: 40 }));
    // Actuals (input tokens) can land past the ceiling on the final admitted
    // call; the overrun is reported, and the run stops here.
    expect(small.cumulativeTokens).toBe(300);
    await expect(client.complete(input({ contextAllowlist: ['incident'], maxTokens: 1 }))).rejects.toThrow(/ceiling/i);
    expect(transport.seen).toHaveLength(2);
  });
});

describe('fallback is explicit and recorded (FR3-07)', () => {
  it('uses the fallback transport once on primary outage and records it', async () => {
    const primary = fakeTransport(() => {
      throw new Error('primary down');
    });
    const fallback = fakeTransport(() => ({ status: 200, bodyText: validBody() }));
    const client = clientFor(primary, { fallbackTransport: fallback });
    const result = await client.complete(input({ contextAllowlist: ['incident'] }));
    expect(result.usedFallback).toBe(true);
    expect(primary.seen).toHaveLength(1);
    expect(fallback.seen).toHaveLength(1);
  });

  it('fails instead of silently switching providers when no fallback is configured', async () => {
    const primary = fakeTransport(() => {
      throw new Error('primary down');
    });
    const client = clientFor(primary);
    await expect(client.complete(input({ contextAllowlist: ['incident'] }))).rejects.toThrow(/outage/i);
  });

  it('does not fall back on a malformed primary response', async () => {
    const primary = fakeTransport(() => ({ status: 200, bodyText: 'garbage' }));
    const fallback = fakeTransport(() => ({ status: 200, bodyText: validBody() }));
    const client = clientFor(primary, { fallbackTransport: fallback });
    await expect(client.complete(input({ contextAllowlist: ['incident'] }))).rejects.toThrow(/malformed/i);
    expect(fallback.seen).toHaveLength(0);
  });
});
