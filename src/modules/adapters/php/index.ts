import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import {
  CapabilityRecordSchema,
  SystemGraphSchema,
  type CapabilityKey,
  type CapabilityRecord,
  type GraphEdge,
  type GraphNode,
} from '../../../core/index.js';
import { snapshotId, type AdapterDefinition, type AdapterExtractInput, type AdapterExtractResult } from '../types.js';
import { AdapterRegistry } from '../registry/index.js';

/**
 * PHP adapter (L1: discovery and extraction).
 *
 * Extraction uses PHP's own tokenizer (`token_get_all`), so the token stream
 * comes from the real lexer rather than a regular expression pass. The adapter
 * supports Laravel's route files and controller classes.
 *
 * A framework this adapter does not implement yields a typed `unsupported`
 * status with an empty graph and a named unsupported surface. It never returns
 * an empty *success*, because an empty graph reads as "no impact" (NEG3-09).
 */

export const PHP_ADAPTER_VERSION = '1.0.1';

export const PHP_KEY: CapabilityKey = {
  ecosystem: 'php',
  language: 'php',
  framework: 'laravel',
  versionRange: '>=11.0 <12.0',
  componentKind: 'backend',
  changeCategory: 'api-contract',
  featureRestrictions: [],
  runnerProfile: 'php-linux',
  adapterVersion: PHP_ADAPTER_VERSION,
};

export const PHP_ADAPTER_RECORD: CapabilityRecord = CapabilityRecordSchema.parse({
  schemaVersion: '2',
  key: PHP_KEY,
  targetLevel: 'L2',
  provenLevel: 'none',
  certificationStatus: 'uncertified',
  evidenceRefs: [],
  limitations: [
    'Only the Laravel route/controller shape is extracted; other frameworks are reported as unsupported.',
    'Dynamic container resolution is reported as unresolved.',
  ],
  toolchainIdentities: {},
});
const registeredCapabilities = new AdapterRegistry([PHP_ADAPTER_RECORD]);

/** The reviewed helper that tokenises the snapshot with PHP's own lexer. */
const TOKENISE_HELPER = `
$payload = json_decode(stream_get_contents(STDIN), true);
$out = [];
$errors = [];
foreach ($payload as $entry) {
    try { $tokens = token_get_all($entry['source'], TOKEN_PARSE); }
    catch (ParseError $error) { $errors[] = $entry['file'] . ':' . $error->getLine() . ': ' . $error->getMessage(); continue; }
    $tokens = array_values(array_filter($tokens, fn($t) => !is_array($t) || !in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)));
    $count = count($tokens);
    for ($i = 0; $i < $count; $i++) {
        $token = $tokens[$i];
        if (!is_array($token)) { continue; }
        [$id, $text, $line] = $token;

        if ($id === T_STRING && strtolower($text) === 'app' && ($tokens[$i + 1] ?? null) === '(') {
            $out[] = ['kind' => 'dynamic', 'file' => $entry['file'], 'line' => $line,
                      'name' => 'app', 'detail' => 'dynamic container lookup'];
        }

        if ($id === T_STRING && in_array(strtolower($text), ['get', 'post', 'put', 'delete', 'patch'], true)) {
            $separator = $tokens[$i - 1] ?? null;
            $receiver = $tokens[$i - 2] ?? null;
            if (!is_array($separator) || $separator[0] !== T_DOUBLE_COLON || !is_array($receiver) ||
                    !in_array(ltrim($receiver[1], chr(92)), ['Route', 'Illuminate'.chr(92).'Support'.chr(92).'Facades'.chr(92).'Route'], true)) continue;
            $j = $i + 1;
            while ($j < $count && is_array($tokens[$j]) && in_array($tokens[$j][0], [T_WHITESPACE], true)) { $j++; }
            if ($j < $count && $tokens[$j] === '(') {
                $k = $j + 1;
                while ($k < $count && is_array($tokens[$k]) && $tokens[$k][0] === T_WHITESPACE) { $k++; }
                // A literal prefix is not a literal argument (for example, '/orders/' . $id).
                $argumentEnd = $tokens[$k + 1] ?? null;
                if ($k < $count && is_array($tokens[$k]) && $tokens[$k][0] === T_CONSTANT_ENCAPSED_STRING &&
                        ($argumentEnd === ',' || $argumentEnd === ')')) {
                    $route = trim($tokens[$k][1], "'\\"");
                    $out[] = ['kind' => 'route', 'file' => $entry['file'], 'line' => $line,
                              'name' => $route, 'detail' => strtoupper($text)];
                } else {
                    $out[] = ['kind' => 'dynamic', 'file' => $entry['file'], 'line' => $line,
                              'name' => $text, 'detail' => 'non-literal Laravel route'];
                }
            }
        }

        if ($id === T_VARIABLE && $text === '$this') {
            $out[] = ['kind' => 'controller', 'file' => $entry['file'], 'line' => $line,
                      'name' => '$this', 'detail' => 'controller instance'];
        }
    }
}
echo json_encode(['schemaVersion' => '1', 'phpVersion' => PHP_VERSION, 'facts' => $out, 'errors' => $errors]);
`;

const PhpParseResultSchema = z.object({
  schemaVersion: z.literal('1'), phpVersion: z.string(), errors: z.array(z.string()),
  facts: z.array(z.object({ kind: z.enum(['route', 'controller', 'dynamic']), file: z.string(),
    line: z.number().int().positive(), name: z.string(), detail: z.string() })),
});

export const PHP_ADAPTER: AdapterDefinition = {
  name: 'php',
  contractVersion: '2',
  key: PHP_KEY,
  records: [PHP_ADAPTER_RECORD],

  async extract(input: AdapterExtractInput): Promise<AdapterExtractResult> {
    const snapshot = snapshotId(input.root, input.version);
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      return unsupported(input, 'Unregistered or invalid PHP capability tuple.');
    }
    const diagnostics: string[] = [];

    // Framework gate: an unsupported framework is refused explicitly.
    const composer = input.files.find((file) => file.endsWith('composer.json'));
    if (composer !== undefined) {
      try {
        const manifest = JSON.parse(readFileSync(join(input.root, composer), 'utf8')) as {
          require?: Record<string, string>;
        };
        const dependencies = Object.keys(manifest.require ?? {});
        const supported = dependencies.some((dependency) => dependency.startsWith('laravel/framework'));
        if (!supported) {
          return unsupported(
            input,
            `Framework dependencies [${dependencies.join(', ') || 'none'}] are not supported by the PHP adapter`,
          );
        }
      } catch (error) {
        diagnostics.push(`Could not read composer.json: ${(error as Error).message}`);
      }
    }

    const entries: { file: string; source: string }[] = [];
    for (const file of input.files) {
      if (!file.endsWith('.php')) continue;
      try {
        entries.push({ file, source: readFileSync(join(input.root, file), 'utf8') });
      } catch (error) {
        diagnostics.push(`Could not read ${file}: ${(error as Error).message}`);
      }
    }

    if (entries.length === 0) {
      return unsupported(input, 'No PHP source was present in the snapshot.');
    }

    const { runNative, parseNativeJson } = await import('../native/process.js');
    const run = await runNative(
      'php',
      ['-r', TOKENISE_HELPER],
      {
        cwd: input.root,
        timeoutMs: 30_000,
        maxOutputBytes: 4 * 1024 * 1024,
        input: JSON.stringify(entries),
      },
    );

    if (run.exitCode !== 0) {
      return {
        status: 'failed',
        graph: emptyGraph(snapshot),
        unknowns: [`php exited with code ${run.exitCode}`],
        unsupportedSurfaces: [],
        diagnostics: [run.stderr.slice(0, 2000)],
        toolchainIdentity: 'php@unobserved',
      };
    }

    const parsed = PhpParseResultSchema.safeParse(parseNativeJson(run.stdout));
    if (!parsed.success) {
      return { status: 'failed', graph: emptyGraph(snapshot), unknowns: ['Invalid PHP parser result.'],
        unsupportedSurfaces: [], diagnostics: [parsed.error.message], toolchainIdentity: 'php@unobserved' };
    }
    const { facts, errors, phpVersion } = parsed.data;
    const toolchainIdentity = `php@${phpVersion}`;
    if (phpVersion !== input.version || errors.length > 0) {
      return { status: 'failed', graph: emptyGraph(snapshot),
        unknowns: phpVersion !== input.version ? [`PHP toolchain mismatch: requested ${input.version}, observed ${phpVersion}.`] : errors,
        unsupportedSurfaces: [], diagnostics: [...diagnostics, ...errors], toolchainIdentity };
    }
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const unknowns: string[] = [];

    for (const entry of entries) {
      const moduleId = `component:${entry.file}`;
      nodes.set(moduleId, {
        id: moduleId,
        kind: 'component',
        locator: entry.file,
        snapshot,
        label: entry.file,
      });
    }

    for (const fact of facts) {
      const fromId = `component:${fact.file}`;
      if (!nodes.has(fromId)) continue;

      if (fact.kind === 'dynamic') {
        const locator = `${fact.file}:${fact.line}`;
        const target = `symbol:dynamic:${locator}:${fact.name}`;
        const reason = `${fact.detail} at ${locator} cannot be resolved statically`;
        nodes.set(target, { id: target, kind: 'symbol', locator, snapshot, label: fact.name });
        edges.push({ id: `edge:${fromId}->${target}`, kind: 'calls', from: fromId, to: target,
          resolution: 'unresolved', unresolvedReason: reason, runtimeObserved: false });
        unknowns.push(reason);
      }

      if (fact.kind === 'route') {
        const endpointId = `endpoint:${fact.detail} ${fact.name}`;
        nodes.set(endpointId, {
          id: endpointId,
          kind: 'endpoint',
          locator: `${fact.file}:${fact.line}`,
          snapshot,
          label: `${fact.detail} ${fact.name}`,
        });
        edges.push({
          id: `edge:${fromId}->${endpointId}`,
          kind: 'calls',
          from: fromId,
          to: endpointId,
          resolution: 'proven',
          evidence: {
            locator: `${fact.file}:${fact.line}`,
            snapshot,
            method: 'php-tokenizer-route-call',
          },
          runtimeObserved: false,
        });
      }
    }

    return {
      status: edges.length > 0 ? 'ok' : 'unsupported',
      graph: SystemGraphSchema.parse({ schemaVersion: '1', snapshot, nodes: [...nodes.values()], edges }),
      unknowns,
      unsupportedSurfaces: edges.length > 0 ? [] : ['No supported Laravel route syntax was found.'],
      diagnostics,
      toolchainIdentity,
    };
  },
};

function unsupported(input: AdapterExtractInput, reason: string): AdapterExtractResult {
  const snapshot = snapshotId(input.root, input.version);
  return {
    status: 'unsupported',
    graph: SystemGraphSchema.parse({
      schemaVersion: '1',
      snapshot,
      nodes: [{ id: 'component:unsupported', kind: 'component', locator: 'unsupported', snapshot }],
      edges: [],
    }),
    unknowns: [],
    unsupportedSurfaces: [reason],
    diagnostics: [],
    toolchainIdentity: 'php@unobserved',
  };
}

function emptyGraph(snapshot: string) {
  return SystemGraphSchema.parse({
    schemaVersion: '1',
    snapshot,
    nodes: [{ id: 'component:empty', kind: 'component', locator: 'empty', snapshot }],
    edges: [],
  });
}
