// One small paid model call through the real broker seam (FR3-07 live proof).
// Usage: node scripts/model-live-smoke.mjs   (reads .env, writes runs/model-live-smoke.json)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = (m[2] ?? '').trim();
}
for (const key of ['CHANGEPROOF_MODEL_API_KEY', 'CHANGEPROOF_MODEL_URL', 'CHANGEPROOF_MODEL_NAME', 'CHANGEPROOF_MODEL_PROVIDER']) {
  if (!env[key]) {
    console.error(`missing ${key} in .env; refusing`);
    process.exit(1);
  }
}

const { createModelClient, modelFetchTransport } = await import('../dist/modules/agent/index.js');

const secrets = {
  async readCredential(ref) {
    if (ref !== 'model-key') throw new Error(`unknown secret ref ${ref}`);
    return env.CHANGEPROOF_MODEL_API_KEY;
  },
};

const client = createModelClient({
  transport: modelFetchTransport(env.CHANGEPROOF_MODEL_URL),
  secrets,
  secretRef: 'model-key',
  provider: env.CHANGEPROOF_MODEL_PROVIDER,
  model: env.CHANGEPROOF_MODEL_NAME,
  configId: 'config-live-smoke-1',
  tokenCeiling: 2_000,
});

try {
  const result = await client.complete({
    promptId: 'prompt-live-smoke-1',
    messages: [
      { role: 'system', content: 'Reply with exactly one short sentence.' },
      { role: 'user', content: 'In one sentence: why is independent verification important for code changes?' },
    ],
    tools: [{ name: 'noop', description: 'Do nothing.', parameters: '{"type":"object","properties":{}}' }],
    maxTokens: 128,
    requireToolCall: false,
  });
  const receipt = {
    at: new Date().toISOString(),
    transport: 'modelFetchTransport',
    provider: result.provider ?? client.provider,
    model: result.model,
    promptId: result.promptId,
    configId: result.configId,
    providerRequestId: result.providerRequestId,
    usage: result.usage,
    cumulativeTokens: result.cumulativeTokens,
    contractVersion: client.contractVersion,
    outputTextPreview: result.outputText.slice(0, 200),
  };
  mkdirSync('runs', { recursive: true });
  writeFileSync('runs/model-live-smoke.json', `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  console.log(`LIVE OK model=${receipt.model} usage=${receipt.usage.inputTokens}+${receipt.usage.outputTokens} req=${receipt.providerRequestId}`);
} catch (error) {
  console.error(`LIVE FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
