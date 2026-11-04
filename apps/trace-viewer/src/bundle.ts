/**
 * Trace bundle contract for the read-only evidence audit UI.
 *
 * A bundle is a frozen, server-produced snapshot describing one run: the
 * event timeline, the causal hypothesis tree, trial receipts, and artifact
 * digests. The viewer never invents entries: `parseTraceBundle` rejects
 * malformed input with specific errors instead of rendering partial data
 * as if it were complete.
 *
 * All dynamic strings are rendered through `textContent` by the view layer,
 * so hostile bundle content cannot become markup (NEG3-21).
 */

export interface TraceEvent {
  readonly seq: number;
  readonly at: string;
  readonly kind: string;
  readonly title: string;
  readonly detail?: string;
  readonly status: 'ok' | 'warn' | 'fail' | 'info';
}

export interface HypothesisNode {
  readonly id: string;
  readonly status: string;
  readonly mechanism: string;
  readonly probe?: string;
  readonly result?: string;
  readonly children: readonly HypothesisNode[];
}

export interface TrialReceipt {
  readonly id: string;
  readonly label: string;
  readonly status: 'pass' | 'warn' | 'pending' | 'fail';
  readonly detail?: string;
}

export interface ArtifactDigest {
  readonly name: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly access: string;
  readonly href?: string;
}

export interface TraceLabels {
  readonly origin: string;
  readonly executionMode: string;
  readonly proposalMode: string;
}

export interface TraceBundle {
  readonly version: 1;
  readonly runId: string;
  readonly bundle: string;
  readonly labels: TraceLabels;
  readonly events: readonly TraceEvent[];
  readonly hypotheses: readonly HypothesisNode[];
  readonly trials: readonly TrialReceipt[];
  readonly artifacts: readonly ArtifactDigest[];
}

export type ParseTraceBundleResult =
  | { readonly ok: true; readonly bundle: TraceBundle }
  | { readonly ok: false; readonly errors: readonly string[] };

const MAX_EVENTS = 5000;
const MAX_HYPOTHESES = 500;
const MAX_HYPOTHESIS_DEPTH = 8;
const MAX_TRIALS = 500;
const MAX_ARTIFACTS = 500;
const MAX_STRING = 8000;

const EVENT_STATUSES = new Set(['ok', 'warn', 'fail', 'info']);
const TRIAL_STATUSES = new Set(['pass', 'warn', 'pending', 'fail']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_STRING) return null;
  return trimmed;
}

function cleanOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cleaned = cleanString(value);
  return cleaned ?? undefined;
}

function cleanInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

class Collector {
  readonly errors: string[] = [];

  /** Record an error and mark the bundle invalid. Never throws on bad data. */
  reject(path: string, why: string): null {
    this.errors.push(`${path}: ${why}`);
    return null;
  }
}

function parseLabels(value: unknown, errors: Collector): TraceLabels | null {
  if (!isRecord(value)) return errors.reject('labels', 'must be an object');
  const origin = cleanString(value['origin']);
  const executionMode = cleanString(value['executionMode']);
  const proposalMode = cleanString(value['proposalMode']);
  if (origin === null) return errors.reject('labels.origin', 'must be a non-empty string');
  if (executionMode === null) return errors.reject('labels.executionMode', 'must be a non-empty string');
  if (proposalMode === null) return errors.reject('labels.proposalMode', 'must be a non-empty string');
  return { origin, executionMode, proposalMode };
}

function parseEvent(value: unknown, index: number, errors: Collector): TraceEvent | null {
  const path = `events[${index}]`;
  if (!isRecord(value)) return errors.reject(path, 'must be an object');
  const seq = cleanInt(value['seq']);
  const at = cleanString(value['at']);
  const kind = cleanString(value['kind']);
  const title = cleanString(value['title']);
  const statusRaw = cleanString(value['status']);
  if (seq === null) return errors.reject(`${path}.seq`, 'must be an integer >= 0');
  if (at === null) return errors.reject(`${path}.at`, 'must be a non-empty string');
  if (kind === null) return errors.reject(`${path}.kind`, 'must be a non-empty string');
  if (title === null) return errors.reject(`${path}.title`, 'must be a non-empty string');
  if (statusRaw === null || !EVENT_STATUSES.has(statusRaw)) {
    return errors.reject(`${path}.status`, 'must be one of ok, warn, fail, info');
  }
  const status = statusRaw as TraceEvent['status'];
  const detail = cleanOptionalString(value['detail']);
  return detail === undefined
    ? { seq, at, kind, title, status }
    : { seq, at, kind, title, status, detail };
}

function parseHypothesis(
  value: unknown,
  path: string,
  depth: number,
  errors: Collector,
  seen: { count: number },
): HypothesisNode | null {
  if (!isRecord(value)) return errors.reject(path, 'must be an object');
  if (depth > MAX_HYPOTHESIS_DEPTH) {
    return errors.reject(path, `exceeds max hypothesis depth of ${MAX_HYPOTHESIS_DEPTH}`);
  }
  seen.count += 1;
  if (seen.count > MAX_HYPOTHESES) {
    return errors.reject(path, `exceeds max hypothesis count of ${MAX_HYPOTHESES}`);
  }
  const id = cleanString(value['id']);
  const status = cleanString(value['status']);
  const mechanism = cleanString(value['mechanism']);
  if (id === null) return errors.reject(`${path}.id`, 'must be a non-empty string');
  if (status === null) return errors.reject(`${path}.status`, 'must be a non-empty string');
  if (mechanism === null) return errors.reject(`${path}.mechanism`, 'must be a non-empty string');
  const probe = cleanOptionalString(value['probe']);
  const result = cleanOptionalString(value['result']);
  const childrenRaw = value['children'];
  const children: HypothesisNode[] = [];
  if (childrenRaw !== undefined) {
    if (!Array.isArray(childrenRaw)) return errors.reject(`${path}.children`, 'must be an array');
    for (let index = 0; index < childrenRaw.length; index += 1) {
      const child = parseHypothesis(childrenRaw[index], `${path}.children[${index}]`, depth + 1, errors, seen);
      if (child === null) return null;
      children.push(child);
    }
  }
  const node: HypothesisNode = { id, status, mechanism, children };
  return {
    ...node,
    ...(probe === undefined ? {} : { probe }),
    ...(result === undefined ? {} : { result }),
  };
}

function parseTrial(value: unknown, index: number, errors: Collector): TrialReceipt | null {
  const path = `trials[${index}]`;
  if (!isRecord(value)) return errors.reject(path, 'must be an object');
  const id = cleanString(value['id']);
  const label = cleanString(value['label']);
  const statusRaw = cleanString(value['status']);
  if (id === null) return errors.reject(`${path}.id`, 'must be a non-empty string');
  if (label === null) return errors.reject(`${path}.label`, 'must be a non-empty string');
  if (statusRaw === null || !TRIAL_STATUSES.has(statusRaw)) {
    return errors.reject(`${path}.status`, 'must be one of pass, warn, pending, fail');
  }
  const status = statusRaw as TrialReceipt['status'];
  const detail = cleanOptionalString(value['detail']);
  return detail === undefined ? { id, label, status } : { id, label, status, detail };
}

function parseArtifact(value: unknown, index: number, errors: Collector): ArtifactDigest | null {
  const path = `artifacts[${index}]`;
  if (!isRecord(value)) return errors.reject(path, 'must be an object');
  const name = cleanString(value['name']);
  const sha256 = cleanString(value['sha256']);
  const sizeBytes = cleanInt(value['sizeBytes']);
  const access = cleanString(value['access']);
  if (name === null) return errors.reject(`${path}.name`, 'must be a non-empty string');
  if (sha256 === null) return errors.reject(`${path}.sha256`, 'must be a non-empty string');
  if (sizeBytes === null) return errors.reject(`${path}.sizeBytes`, 'must be an integer >= 0');
  if (access === null) return errors.reject(`${path}.access`, 'must be a non-empty string');
  const hrefRaw = cleanOptionalString(value['href']);
  if (hrefRaw !== undefined && !hrefRaw.startsWith('/')) {
    return errors.reject(`${path}.href`, 'must be a same-origin path starting with /');
  }
  return hrefRaw === undefined
    ? { name, sha256, sizeBytes, access }
    : { name, sha256, sizeBytes, access, href: hrefRaw };
}

function parseArray<T>(
  value: unknown,
  path: string,
  max: number,
  errors: Collector,
  parseItem: (item: unknown, index: number, errors: Collector) => T | null,
): readonly T[] | null {
  if (!Array.isArray(value)) {
    return errors.reject(path, 'must be an array');
  }
  if (value.length > max) {
    return errors.reject(path, `exceeds max length of ${max}`);
  }
  const items: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = parseItem(value[index], index, errors);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

/**
 * Validate an unknown payload as a trace bundle. Returns every error found
 * so callers can report exactly what is wrong instead of a bare "invalid".
 */
export function parseTraceBundle(payload: unknown): ParseTraceBundleResult {
  const errors = new Collector();
  if (!isRecord(payload)) {
    return { ok: false, errors: ['bundle: must be an object'] };
  }
  if (payload['version'] !== 1) {
    errors.reject('version', 'must be 1');
  }
  const runId = cleanString(payload['runId']);
  if (runId === null) errors.reject('runId', 'must be a non-empty string');
  const bundle = cleanString(payload['bundle']);
  if (bundle === null) errors.reject('bundle', 'must be a non-empty string');
  const labels = parseLabels(payload['labels'], errors);
  const events = parseArray(payload['events'], 'events', MAX_EVENTS, errors, parseEvent);
  const seen = { count: 0 };
  const hypothesesRaw = payload['hypotheses'];
  let hypotheses: readonly HypothesisNode[] | null = null;
  if (!Array.isArray(hypothesesRaw)) {
    errors.reject('hypotheses', 'must be an array');
  } else if (hypothesesRaw.length > MAX_HYPOTHESES) {
    errors.reject('hypotheses', `exceeds max length of ${MAX_HYPOTHESES}`);
  } else {
    const items: HypothesisNode[] = [];
    let failed = false;
    for (let index = 0; index < hypothesesRaw.length; index += 1) {
      const node = parseHypothesis(hypothesesRaw[index], `hypotheses[${index}]`, 1, errors, seen);
      if (node === null) {
        failed = true;
        break;
      }
      items.push(node);
    }
    hypotheses = failed ? null : items;
  }
  const trials = parseArray(payload['trials'], 'trials', MAX_TRIALS, errors, parseTrial);
  const artifacts = parseArray(payload['artifacts'], 'artifacts', MAX_ARTIFACTS, errors, parseArtifact);

  if (
    errors.errors.length > 0 ||
    runId === null ||
    bundle === null ||
    labels === null ||
    events === null ||
    hypotheses === null ||
    trials === null ||
    artifacts === null
  ) {
    return { ok: false, errors: errors.errors };
  }
  return {
    ok: true,
    bundle: { version: 1, runId, bundle, labels, events, hypotheses, trials, artifacts },
  };
}
