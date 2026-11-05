import { z } from 'zod';

import { ChangeProofError } from '../../core/index.js';

import type { ModelTransport, ModelTransportRequest, ModelTransportResponse } from './broker.js';

/**
 * Live HTTP transport for the model broker (WP3-07, FR3-07).
 *
 * The broker owns validation and identity; this transport owns HTTP only.
 * It speaks the OpenAI-compatible `/chat/completions` dialect of the
 * operator-configured provider (target: Meta Muse Spark `muse-spark-1.3`)
 * and maps the provider reply into the broker's neutral seam. Anything
 * the provider shape cannot supply is a refusal, never a guess. The
 * credential travels in the `Authorization` header only — never in the
 * body, logs, or errors.
 */

const BrokerBodySchema = z.object({
  model: z.string().min(1),
  configId: z.string().min(1),
  promptId: z.string().min(1),
  messages: z.array(z.object({ role: z.string().min(1), content: z.string() })),
  tools: z.array(
    z.object({ name: z.string().min(1), description: z.string(), parameters: z.string() }),
  ),
  maxTokens: z.number().int().positive(),
});

const ChatToolCallSchema = z.object({
  function: z.object({ name: z.string().min(1), arguments: z.string() }).optional(),
});

const ChatChoiceSchema = z.object({
  message: z.object({
    content: z.string().nullish(),
    tool_calls: z.array(ChatToolCallSchema).nullish(),
  }),
});

const ChatResponseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  choices: z.array(ChatChoiceSchema).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }),
});

export function modelFetchTransport(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): ModelTransport {
  const base = baseUrl.replace(/\/+$/, '');
  if (base.length === 0) {
    throw new ChangeProofError('Model base URL is empty; refusing.');
  }
  return {
    async send(request: ModelTransportRequest): Promise<ModelTransportResponse> {
      if (request.credential.length === 0) {
        throw new ChangeProofError('Model credential is empty; refusing an anonymous call.');
      }
      const parsed = BrokerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ChangeProofError('Model broker body is malformed; refusing to translate it.');
      }
      const brokerBody = parsed.data;
      const tools = brokerBody.tools.map((tool) => {
        let parameters: unknown;
        try {
          parameters = JSON.parse(tool.parameters) as unknown;
        } catch {
          throw new ChangeProofError(`Model tool "${tool.name}" has unparseable parameters; refusing.`);
        }
        return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
      });
      let response: Response;
      try {
        response = await fetchImpl(`${base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${request.credential}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: brokerBody.model,
            messages: brokerBody.messages,
            tools: tools.length > 0 ? tools : undefined,
            max_tokens: brokerBody.maxTokens,
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        throw new ChangeProofError(
          `Model request failed: ${error instanceof Error ? error.message : 'unknown transport error'}; refusing to guess.`,
          { cause: error },
        );
      }
      if (response.status !== 200) {
        // The provider body stays out of the seam: the broker reports the
        // status without it, so provider content never leaks into errors.
        return { status: response.status, bodyText: '' };
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ChangeProofError('Model response is not JSON; refusing to guess.');
      }
      const chat = ChatResponseSchema.safeParse(payload);
      if (!chat.success) {
        throw new ChangeProofError('Model response shape is unknown; refusing to guess.');
      }
      const message = chat.data.choices[0]?.message;
      if (message === undefined) {
        throw new ChangeProofError('Model response has no choice; refusing to guess.');
      }
      const seam = {
        model: chat.data.model,
        outputText: message.content ?? '',
        toolCalls: (message.tool_calls ?? []).map((call) => ({
          name: call.function?.name ?? '',
          arguments: call.function?.arguments ?? '',
        })).filter((call) => call.name.length > 0),
        usage: {
          inputTokens: chat.data.usage.prompt_tokens,
          outputTokens: chat.data.usage.completion_tokens,
        },
        providerRequestId: chat.data.id,
      };
      return { status: 200, bodyText: JSON.stringify(seam) };
    },
  };
}
