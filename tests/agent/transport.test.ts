import { describe, expect, it } from 'vitest';

import { modelFetchTransport } from '../../src/modules/agent/transport.js';

function stubFetch(handler: (url: string, init: RequestInit) => unknown): {
  fetchImpl: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: unknown, init?: unknown): Promise<unknown> => {
    calls.push({ url: String(url), init: init as RequestInit });
    return Promise.resolve(handler(String(url), (init ?? {}) as RequestInit));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const BROKER_BODY = {
  model: 'muse-spark-1.3',
  configId: 'config-default-1',
  promptId: 'prompt-diagnose-1',
  messages: [{ role: 'user', content: 'Null deref at line 9.' }],
  tools: [{ name: 'read_file', description: 'Read a file.', parameters: '{"type":"object"}' }],
  maxTokens: 64,
};

function chatReply(): unknown {
  return {
    id: 'req-live-1',
    model: 'muse-spark-1.3',
    choices: [
      {
        message: {
          content: 'diagnosis: missing null check',
          tool_calls: [{ function: { name: 'read_file', arguments: '{"path":"src/a.ts"}' } }],
        },
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  };
}

describe('modelFetchTransport (FR3-07 live seam)', () => {
  it('posts chat/completions with a bearer credential and maps the reply into the broker seam', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({
      status: 200,
      json: () => Promise.resolve(chatReply()),
    }));
    const transport = modelFetchTransport('https://api.meta.ai/v1/', fetchImpl);
    const response = await transport.send({ credential: 'live-secret', body: BROKER_BODY });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.meta.ai/v1/chat/completions');
    const init = calls[0]?.init;
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer live-secret');
    expect(JSON.stringify(init?.body)).not.toContain('live-secret');
    expect(response.status).toBe(200);
    const seam = JSON.parse(response.bodyText) as { model: string; providerRequestId: string };
    expect(seam.model).toBe('muse-spark-1.3');
    expect(seam.providerRequestId).toBe('req-live-1');
  });

  it('refuses an empty credential and an empty base URL without calling fetch', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 200, json: () => Promise.resolve({}) }));
    const transport = modelFetchTransport('https://api.meta.ai/v1', fetchImpl);
    await expect(transport.send({ credential: '', body: BROKER_BODY })).rejects.toThrow(/anonymous|empty/i);
    expect(calls).toHaveLength(0);
    expect(() => modelFetchTransport('///', fetchImpl)).toThrow(/empty/i);
  });

  it('returns the status on a provider refusal without leaking the provider body', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 500, json: () => Promise.resolve({ secret: 'x' }) }));
    const response = await modelFetchTransport('https://api.meta.ai/v1', fetchImpl).send({
      credential: 'live-secret',
      body: BROKER_BODY,
    });
    expect(response.status).toBe(500);
    expect(response.bodyText).not.toContain('secret');
  });

  it('refuses an unknown provider shape instead of guessing', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 200, json: () => Promise.resolve({ hello: 'world' }) }));
    await expect(
      modelFetchTransport('https://api.meta.ai/v1', fetchImpl).send({ credential: 'live-secret', body: BROKER_BODY }),
    ).rejects.toThrow(/unknown/i);
  });
});
