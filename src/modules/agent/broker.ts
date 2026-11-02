import { z } from 'zod';

import {
  ChangeProofError,
  IdSchema,
  NonEmptyStringSchema,
  type ModelClientPort,
  type ModelCompleteInput,
  type ModelCompleteResult,
  type ModelMessage,
  type SecretBrokerPort,
} from '../../core/index.js';

/**
 * Versioned model client over an injected transport (WP3-07, FR3-07).
 *
 * The broker sends allowlisted context with recorded prompt/config/model
 * IDs, revalidates every response, and raises typed failures for outages,
 * malformed responses, identity mismatches, and missing tool calls. The
 * credential is read from the broker at call time and handed to the
 * transport (trusted product code, like the GitHub client) — it never
 * reaches the model context, logs, or results. Spending accrues against a
 * finite ceiling with no reset path: a call is admitted only when
 * spent + maxTokens fits, so actuals (input tokens bill too) can overrun
 * on the final admitted call — the overrun is reported and the next call
 * is refused, never silently continued. Fallback transports run only when explicitly
 * configured, only for transport outages (never for malformed responses),
 * and every result records whether the fallback served it.
 */

export const MODEL_CONTRACT_VERSION = '1';

export interface ModelTransportRequest {
  readonly credential: string;
  readonly body: unknown;
}

export interface ModelTransportResponse {
  readonly status: number;
  readonly bodyText: string;
}

/** Raw provider exchange. Implementations own HTTP; validation stays here. */
export interface ModelTransport {
  send(request: ModelTransportRequest): Promise<ModelTransportResponse>;
}

export interface ModelClientConfig {
  readonly transport: ModelTransport;
  readonly secrets: SecretBrokerPort;
  readonly secretRef: string;
  readonly provider: string;
  readonly model: string;
  readonly configId: string;
  readonly tokenCeiling: number;
  readonly fallbackTransport?: ModelTransport;
}

const ToolCallSchema = z.object({ name: z.string().min(1), arguments: z.string() });

const InputMessageSchema = z.object({
  role: z.enum(['system', 'user', 'tool']),
  source: z.string().optional(),
  content: z.string(),
});

const InputToolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: z.string(),
});

const ProviderBodySchema = z.object({
  model: z.string().min(1),
  outputText: z.string(),
  toolCalls: z.array(ToolCallSchema),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  providerRequestId: z.string().min(1),
});

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ChangeProofError(`${name} must be a positive integer; refusing.`);
  }
}

interface FilterableMessage {
  readonly role: 'system' | 'user' | 'tool';
  readonly content: string;
  readonly source?: string | undefined;
}

function filterContext(
  messages: readonly FilterableMessage[],
  allowlist: readonly string[] | undefined,
): { kept: ModelMessage[]; dropped: number } {
  const kept: ModelMessage[] = [];
  let dropped = 0;
  for (const message of messages) {
    const source = message.source;
    if (source === undefined || (allowlist?.includes(source) ?? false)) {
      kept.push(
        source === undefined
          ? { role: message.role, content: message.content }
          : { role: message.role, content: message.content, source },
      );
    } else {
      dropped += 1;
    }
  }
  if (kept.length === 0) {
    throw new ChangeProofError('Context filtering left no message; refusing an empty call.');
  }
  return { kept, dropped };
}

export function createModelClient(config: ModelClientConfig): ModelClientPort {
  const provider = NonEmptyStringSchema.parse(config.provider);
  const model = NonEmptyStringSchema.parse(config.model);
  const configId = IdSchema.parse(config.configId);
  const secretRef = NonEmptyStringSchema.parse(config.secretRef);
  assertPositiveInt(config.tokenCeiling, 'Token ceiling');
  const promptShape = IdSchema;
  let spentTokens = 0;

  async function attempt(
    transport: ModelTransport,
    credential: string,
    body: unknown,
  ): Promise<ModelTransportResponse> {
    try {
      return await transport.send({ credential, body });
    } catch (error) {
      throw new ChangeProofError('Model outage: the provider transport failed before responding.', {
        cause: error,
      });
    }
  }

  function validateResponse(bodyText: string): z.infer<typeof ProviderBodySchema> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      throw new ChangeProofError('Model response malformed: the provider body is not JSON.');
    }
    const body = ProviderBodySchema.safeParse(parsed);
    if (!body.success) {
      throw new ChangeProofError('Model response malformed: required fields are missing or mistyped.');
    }
    if (body.data.model !== model) {
      throw new ChangeProofError(
        `Model identity mismatch: expected "${model}" but the provider answered as "${body.data.model}".`,
      );
    }
    for (const call of body.data.toolCalls) {
      try {
        JSON.parse(call.arguments) as unknown;
      } catch {
        throw new ChangeProofError(`Model response malformed: tool "${call.name}" has unparseable arguments.`);
      }
    }
    for (const tokens of [body.data.usage.inputTokens, body.data.usage.outputTokens]) {
      if (!Number.isInteger(tokens) || tokens < 0) {
        throw new ChangeProofError('Model response malformed: usage counts are unreadable.');
      }
    }
    return body.data;
  }

  return {
    provider,
    contractVersion: MODEL_CONTRACT_VERSION,
    async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
      const promptId = promptShape.parse(input.promptId);
      assertPositiveInt(input.maxTokens, 'Max tokens');
      // Runtime validation for untrusted callers; zod keeps the types exact.
      const messages = z.array(InputMessageSchema).safeParse(input.messages);
      const tools = z.array(InputToolSchema).safeParse(input.tools);
      if (!messages.success || !tools.success) {
        throw new ChangeProofError('Model input messages or tools are malformed; refusing.');
      }
      const { kept, dropped } = filterContext(messages.data, input.contextAllowlist);
      if (spentTokens + input.maxTokens > config.tokenCeiling) {
        throw new ChangeProofError(
          `Token ceiling exceeded: ${spentTokens} spent, ${input.maxTokens} requested, ` +
            `ceiling ${config.tokenCeiling}. The ceiling is never reset; open a new budgeted run instead.`,
        );
      }
      const credential = await config.secrets.readCredential(secretRef);
      if (credential.length === 0) {
        throw new ChangeProofError('Model credential is empty; refusing an anonymous call.');
      }
      const body = { model, configId, promptId, messages: kept, tools: tools.data, maxTokens: input.maxTokens };
      let response: ModelTransportResponse;
      let usedFallback = false;
      try {
        response = await attempt(config.transport, credential, body);
      } catch (error) {
        if (config.fallbackTransport === undefined) {
          throw error;
        }
        response = await attempt(config.fallbackTransport, credential, body);
        usedFallback = true;
      }
      if (response.status !== 200) {
        // The provider body stays out of the error: it may carry anything.
        throw new ChangeProofError(`Model outage: the provider answered HTTP ${response.status}.`);
      }
      const validated = validateResponse(response.bodyText);
      if (input.requireToolCall && validated.toolCalls.length === 0) {
        throw new ChangeProofError('Model made no tool call while one was required; refusing to guess.');
      }
      spentTokens += validated.usage.inputTokens + validated.usage.outputTokens;
      return {
        model: validated.model,
        outputText: validated.outputText,
        toolCalls: validated.toolCalls,
        usage: validated.usage,
        providerRequestId: validated.providerRequestId,
        promptId,
        configId,
        usedFallback,
        droppedContextMessages: dropped,
        cumulativeTokens: spentTokens,
      };
    },
  };
}
