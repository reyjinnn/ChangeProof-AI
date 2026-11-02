import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import {
  AdapterCheckPlanSchema,
  AdapterFixRequestSchema,
  AdapterPatchSchema,
  CapabilityRecordSchema,
  ChangeProofError,
  SystemGraphSchema,
  digestAdapterPatch,
  type AdapterCheckPlan,
  type AdapterFixRequest,
  type AdapterPatchOperation,
  type CapabilityKey,
  type CapabilityRecord,
  type GraphEdge,
  type GraphNode,
  type SystemGraph,
} from '../../../core/index.js';
import {
  ADAPTER_CONTRACT_VERSION,
  snapshotId,
  type AdapterApplyInput,
  type AdapterApplyResult,
  type AdapterDefinition,
  type AdapterExtractInput,
  type AdapterExtractResult,
  type AdapterPlanChecksInput,
  type AdapterPlanFixInput,
  type AdapterPlanFixResult,
} from '../types.js';
import { applyAdapterPatch } from '../apply.js';
import { AdapterRegistry } from '../registry/index.js';

/**
 * PHP adapter (L2: Laravel route extraction plus route-path candidate
 * patches with guard validation).
 *
 * Extraction uses PHP's own tokenizer (`token_get_all`), so the token stream
 * comes from the real lexer rather than a regular expression pass. The adapter
 * supports Laravel's route files and controller classes.
 *
 * A framework this adapter does not implement yields a typed `unsupported`
 * status with an empty graph and a named unsupported surface. It never returns
 * an empty *success*, because an empty graph reads as "no impact" (NEG3-09).
 */

export const PHP_ADAPTER_VERSION = '1.1.0';

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
    'Fix planning covers route_path_change over statically resolved route literals; field renames are not planned.',
    'Route literals are matched textually within the approved scope; a dynamic lookup anywhere in scope refuses the plan.',
    'Prefixed route groups, name-derived routes (resource/fallback), and unmodeled route methods refuse the plan; prefixes are not composed.',
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
    $file = $entry['file'];
    try { $raw = token_get_all($entry['source'], TOKEN_PARSE); }
    catch (ParseError $error) { $errors[] = $file . ':' . $error->getLine() . ': ' . $error->getMessage(); continue; }
    // Track byte offsets before filtering: token texts concatenate to the source exactly.
    $tracked = [];
    $cursor = 0;
    foreach ($raw as $tok) {
        $text = is_array($tok) ? $tok[1] : $tok;
        $tracked[] = ['tok' => $tok, 'offset' => $cursor, 'len' => strlen($text)];
        $cursor += strlen($text);
    }
    // Interpolated "..." spans: a literal part inside one is a template part, not a plain string.
    $open = null;
    foreach ($tracked as $index => $item) {
        if (is_array($item['tok']) || $item['tok'] !== '"') continue;
        if ($open === null) { $open = $index; continue; }
        for ($s = $open + 1; $s < $index; $s++) {
            $inner = $tracked[$s]['tok'];
            if (is_array($inner) && in_array($inner[0], [T_VARIABLE, T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true)) {
                for ($m = $open; $m <= $index; $m++) { $tracked[$m]['interp'] = true; }
                break;
            }
        }
        $open = null;
    }
    $tokens = array_values(array_filter($tracked, fn($e) => !is_array($e['tok']) || !in_array($e['tok'][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)));
    $count = count($tokens);
    $t = function ($n) use ($tokens, $count) { return $n >= 0 && $n < $count ? $tokens[$n]['tok'] : null; };
    for ($i = 0; $i < $count; $i++) {
        $item = $tokens[$i];
        $token = $item['tok'];
        if (!is_array($token)) { continue; }
        [$id, $text, $line] = $token;
        $offset = $item['offset'];
        $length = $item['len'];

        if ($id === T_CONSTANT_ENCAPSED_STRING) {
            if (($item['interp'] ?? false) === true) {
                $out[] = ['kind' => 'dynamic', 'file' => $file, 'line' => $line, 'offset' => $offset, 'length' => $length,
                          'name' => 'interpolation', 'detail' => 'interpolated string part'];
            } else {
                $out[] = ['kind' => 'str', 'file' => $file, 'line' => $line, 'offset' => $offset, 'length' => $length,
                          'name' => trim($text, "'\\""), 'detail' => 'string-literal'];
            }
        }

        if ($id === T_STRING && strtolower($text) === 'app' && $t($i + 1) === '(') {
            $out[] = ['kind' => 'dynamic', 'file' => $file, 'line' => $line, 'offset' => $offset, 'length' => $length,
                      'name' => 'app', 'detail' => 'dynamic container lookup'];
        }

        if ($id === T_STRING && in_array(strtolower($text), ['get', 'post', 'put', 'delete', 'patch'], true)) {
            $separator = $t($i - 1);
            $receiver = $t($i - 2);
            if (!is_array($separator) || $separator[0] !== T_DOUBLE_COLON || !is_array($receiver) ||
                    !in_array(ltrim($receiver[1], chr(92)), ['Route', 'Illuminate'.chr(92).'Support'.chr(92).'Facades'.chr(92).'Route'], true)) continue;
            $j = $i + 1;
            while ($j < $count && is_array($t($j)) && in_array($t($j)[0], [T_WHITESPACE], true)) { $j++; }
            if ($j < $count && $t($j) === '(') {
                $k = $j + 1;
                while ($k < $count && is_array($t($k)) && $t($k)[0] === T_WHITESPACE) { $k++; }
                // A literal prefix is not a literal argument (for example, '/orders/' . $id).
                $argumentEnd = $t($k + 1);
                $literal = $t($k);
                if ($k < $count && is_array($literal) && $literal[0] === T_CONSTANT_ENCAPSED_STRING &&
                        ($argumentEnd === ',' || $argumentEnd === ')')) {
                    $route = trim($literal[1], "'\\"");
                    $out[] = ['kind' => 'route', 'file' => $file, 'line' => $line,
                              'offset' => $tokens[$k]['offset'], 'length' => $tokens[$k]['len'],
                              'name' => $route, 'detail' => strtoupper($text)];
                } else {
                    $out[] = ['kind' => 'dynamic', 'file' => $file, 'line' => $line, 'offset' => $offset, 'length' => $length,
                              'name' => $text, 'detail' => 'non-literal Laravel route'];
                }
            }
        }

        if ($id === T_STRING && !in_array(strtolower($text), ['get', 'post', 'put', 'delete', 'patch'], true)) {
            $separator = $t($i - 1);
            $receiver = $t($i - 2);
            if (!is_array($separator) || $separator[0] !== T_DOUBLE_COLON || !is_array($receiver) ||
                    !in_array(ltrim($receiver[1], chr(92)), ['Route', 'Illuminate'.chr(92).'Support'.chr(92).'Facades'.chr(92).'Route'], true)) continue;
            $lower = strtolower($text);
            // Name-derived routes cannot be matched literally.
            if (in_array($lower, ['resource', 'apiresource', 'fallback'], true)) {
                $out[] = ['kind' => 'dynamic', 'file' => $file, 'line' => $line, 'offset' => $offset, 'length' => $length,
                          'name' => $text, 'detail' => 'unmodeled Laravel route method'];
                continue;
            }
            // A prefixed group reshapes every nested path: any 'prefix' key blocks literal planning.
            if ($lower === 'group') {
                $j = $i + 1;
                if ($t($j) === '(') {
                    $depth = 0;
                    for ($k = $j; $k < $count && $k < $j + 200; $k++) {
                        $inner = $t($k);
                        if ($inner === '(' || $inner === '[') { $depth++; continue; }
                        if ($inner === ')' || $inner === ']') { $depth--; if ($depth <= 0) break; continue; }
                        if (is_array($inner) && $inner[0] === T_CONSTANT_ENCAPSED_STRING && trim($inner[1], "'\\"") === 'prefix') {
                            $out[] = ['kind' => 'dynamic', 'file' => $file, 'line' => $line, 'offset' => $offset, 'length' => $length,
                                      'name' => $text, 'detail' => 'route group with prefix'];
                            break;
                        }
                    }
                }
                continue;
            }
            // Any other Route:: method with a route-shaped literal argument stays visible.
            $j = $i + 1;
            if ($t($j) === '(') {
                $depth = 0;
                for ($k = $j; $k < $count && $k < $j + 120; $k++) {
                    $inner = $t($k);
                    if ($inner === '(' || $inner === '[') { $depth++; continue; }
                    if ($inner === ')' || $inner === ']') { $depth--; if ($depth <= 0) break; continue; }
                    if ($depth === 1 && is_array($inner) && $inner[0] === T_CONSTANT_ENCAPSED_STRING &&
                            str_starts_with(trim($inner[1], "'\\""), '/')) {
                        $out[] = ['kind' => 'dynamic', 'file' => $file, 'line' => $line, 'offset' => $offset, 'length' => $length,
                                  'name' => $text, 'detail' => 'unmodeled Laravel route method'];
                        break;
                    }
                }
            }
        }

        if ($id === T_VARIABLE && $text === '$this') {
            $out[] = ['kind' => 'controller', 'file' => $file, 'line' => $line, 'offset' => $offset, 'length' => $length,
                      'name' => '$this', 'detail' => 'controller instance'];
        }
    }
}
echo json_encode(['schemaVersion' => '2', 'phpVersion' => PHP_VERSION, 'facts' => $out, 'errors' => $errors]);
`;

const PhpParseResultSchema = z.object({
  schemaVersion: z.literal('2'), phpVersion: z.string(), errors: z.array(z.string()),
  facts: z.array(z.object({ kind: z.enum(['route', 'controller', 'dynamic', 'str']), file: z.string(),
    line: z.number().int().positive(), offset: z.number().int().nonnegative(), length: z.number().int().nonnegative(),
    name: z.string(), detail: z.string() })),
});

type PhpFact = z.infer<typeof PhpParseResultSchema>['facts'][number];

export const PHP_ADAPTER: AdapterDefinition = {
  name: 'php',
  contractVersion: ADAPTER_CONTRACT_VERSION,
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
      if (fact.kind === 'str') continue;
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

  async planFix(input: AdapterPlanFixInput): Promise<AdapterPlanFixResult> {
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      return {
        status: 'unsupported',
        patch: null,
        unknowns: [],
        unsupportedSurfaces: ['Unregistered or invalid PHP capability tuple: fix planning refuses unknown scope.'],
        diagnostics: [],
      };
    }
    const request = AdapterFixRequestSchema.safeParse(input.request);
    if (!request.success) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`Malformed fix request: ${request.error.message}`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    if (request.data.changeKind !== 'route_path_change') {
      return {
        status: 'unsupported',
        patch: null,
        unknowns: [],
        unsupportedSurfaces: ['PHP L2 plans route_path_change only; field renames are not planned.'],
        diagnostics: [],
      };
    }
    if (splitEntity(request.data.entity) === null) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`Entity "${request.data.entity}" is not module-qualified; expected "module.Symbol".`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    const extracted = await PHP_ADAPTER.extract({
      root: input.root,
      files: input.files,
      version: input.version,
      capability: input.capability,
    });
    if (extracted.status !== 'ok') {
      return {
        status: 'failed',
        patch: null,
        unknowns: [...extracted.unknowns],
        unsupportedSurfaces: [...extracted.unsupportedSurfaces],
        diagnostics: [...extracted.diagnostics],
      };
    }
    const observed = extracted.graph.nodes.some(
      (node) => node.kind === 'endpoint' && (node.label?.endsWith(` ${request.data.before}`) ?? false),
    );
    if (!observed) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`Route "${request.data.before}" was not observed in the snapshot; refusing to plan blind.`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    return planPhpRouteChange(input, request.data, extracted.graph);
  },

  async applyPatch(input: AdapterApplyInput): Promise<AdapterApplyResult> {
    return applyAdapterPatch(input);
  },

  async planChecks(input: AdapterPlanChecksInput): Promise<AdapterCheckPlan> {
    const patch = AdapterPatchSchema.parse(input.patch);
    if (digestAdapterPatch(patch) !== patch.patchDigest) {
      throw new ChangeProofError('Patch digest mismatch; refusing to plan checks for a changed candidate.');
    }
    const capability = CapabilityRecordSchema.safeParse(input.capability);
    if (!capability.success || registeredCapabilities.get(capability.data.key) === null) {
      throw new ChangeProofError('Unregistered PHP capability tuple; refusing to plan checks for unknown scope.');
    }
    if (capability.data.key.framework !== 'laravel') {
      throw new ChangeProofError(`No PHP check plan for framework "${capability.data.key.framework}".`);
    }
    const targets = patch.operations.map((operation) => operation.path).filter((path) => path.endsWith('.php'));
    if (targets.length === 0) {
      throw new ChangeProofError('No PHP source in the patch; refusing to plan lint without a target.');
    }
    return Promise.resolve(
      AdapterCheckPlanSchema.parse({
        schemaVersion: '1',
        planId: `plan-${patch.patchDigest.slice(0, 12)}`,
        patchDigest: patch.patchDigest,
        checks: targets.map((target) => ({
          checkId: `php-lint:${target}`,
          kind: 'build' as const,
          command: 'php',
          args: ['-l', target],
          cwd: input.root,
          timeoutMs: 60_000,
          required: true,
        })),
        runnerIdentity: input.runnerIdentity,
      }),
    );
  },
};

async function tokenisePhp(
  root: string,
  files: readonly string[],
): Promise<{ facts: PhpFact[]; phpVersion: string }> {
  const entries: { file: string; source: string }[] = [];
  for (const file of files) {
    if (!file.endsWith('.php')) continue;
    entries.push({ file, source: readFileSync(join(root, file), 'utf8') });
  }
  const { runNative, parseNativeJson } = await import('../native/process.js');
  const run = await runNative('php', ['-r', TOKENISE_HELPER], {
    cwd: root,
    timeoutMs: 30_000,
    maxOutputBytes: 4 * 1024 * 1024,
    input: JSON.stringify(entries),
  });
  if (run.exitCode !== 0) {
    throw new ChangeProofError(`php exited with code ${run.exitCode}: ${run.stderr.slice(0, 500)}`);
  }
  const parsed = PhpParseResultSchema.safeParse(parseNativeJson(run.stdout));
  if (!parsed.success) {
    throw new ChangeProofError(`Invalid PHP parser result: ${parsed.error.message}`);
  }
  return { facts: parsed.data.facts, phpVersion: parsed.data.phpVersion };
}

async function planPhpRouteChange(
  input: AdapterPlanFixInput,
  request: AdapterFixRequest,
  graph: SystemGraph,
): Promise<AdapterPlanFixResult> {
  if (request.after.includes("'") || request.after.includes('"')) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [`Route "${request.after}" cannot be quoted into a PHP string literal; refusing to emit broken code.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  let facts: PhpFact[];
  try {
    const parsed = await tokenisePhp(input.root, input.files);
    if (parsed.phpVersion !== input.version) {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`PHP toolchain mismatch: requested ${input.version}, observed ${parsed.phpVersion}.`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
    facts = parsed.facts;
  } catch (error) {
    return {
      status: 'failed',
      patch: null,
      unknowns: [error instanceof Error ? error.message : 'PHP tokenizer failed.'],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  const blockers = [...new Set(facts.filter((fact) => fact.kind === 'dynamic').map((fact) => fact.file))];
  if (blockers.length > 0) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: blockers.map(
        (file) => `Dynamic lookup in ${file} could touch "${request.before}"; static planning refuses hidden gaps.`,
      ),
      diagnostics: [],
    };
  }
  const contents = new Map<string, string>();
  for (const file of input.files.filter((path) => path.endsWith('.php'))) {
    try {
      contents.set(file, readFileSync(join(input.root, file), 'utf8'));
    } catch {
      return {
        status: 'failed',
        patch: null,
        unknowns: [`Cannot plan without reading ${file}; hidden references fail closed.`],
        unsupportedSurfaces: [],
        diagnostics: [],
      };
    }
  }
  const matches = facts.filter((fact) => fact.kind === 'str' && fact.name === request.before);
  const operations: AdapterPatchOperation[] = [];
  const outOfScope: string[] = [];
  const byFile = new Map<string, PhpFact[]>();
  for (const match of matches) {
    const list = byFile.get(match.file) ?? [];
    list.push(match);
    byFile.set(match.file, list);
  }
  for (const [file, literals] of byFile) {
    const content = contents.get(file);
    if (content === undefined) continue;
    if (!inScope(file, request.scope)) {
      outOfScope.push(file);
      continue;
    }
    const ordered = [...literals].sort((left, right) => right.offset - left.offset);
    let patched = content;
    for (const literal of ordered) {
      const quote = patched.slice(literal.offset, literal.offset + 1);
      const closer = quote === '"' ? '"' : "'";
      patched =
        patched.slice(0, literal.offset) +
        `${closer}${request.after}${closer}` +
        patched.slice(literal.offset + literal.length);
    }
    const refs = graph.edges
      .filter((edge) => edge.from === `component:${file}` && edge.to.startsWith('endpoint:') && edge.resolution === 'proven')
      .map((edge) => edge.id);
    operations.push({
      operation: 'write',
      path: file,
      content: patched,
      impactRefs: refs.length > 0 ? refs : [`component:${file}`],
    });
  }
  if (outOfScope.length > 0) {
    return {
      status: 'unsupported',
      patch: null,
      unknowns: [],
      unsupportedSurfaces: outOfScope.map(
        (file) => `Route "${request.before}" is referenced from ${file}, outside the approved scope.`,
      ),
      diagnostics: [],
    };
  }
  if (operations.length === 0) {
    return {
      status: 'no_impact',
      patch: null,
      unknowns: [`Route "${request.before}" has no in-scope literal to update; no patch planned.`],
      unsupportedSurfaces: [],
      diagnostics: [],
    };
  }
  const intentRefs = [request.intentRef];
  return {
    status: 'ok',
    patch: {
      schemaVersion: '1',
      patchId: `php-${createHash('sha256').update(`${request.requestId}:${request.entity}:${request.before}:${request.after}`).digest('hex').slice(0, 12)}`,
      intentRefs,
      operations,
      patchDigest: digestAdapterPatch({ intentRefs, operations }),
    },
    unknowns: [],
    unsupportedSurfaces: [],
    diagnostics: [],
  };
}

function inScope(file: string, scope: readonly string[]): boolean {
  return scope.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

function splitEntity(entity: string): { module: string; symbol: string } | null {
  const dot = entity.lastIndexOf('.');
  if (dot <= 0 || dot === entity.length - 1) return null;
  return { module: entity.slice(0, dot), symbol: entity.slice(dot + 1) };
}

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
