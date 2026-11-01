import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import {
  ChangeProofError,
  IncidentEvidenceSchema,
  type IncidentEvidence,
  type TelemetryConnectorPort,
  type TelemetryPage,
  type TelemetryQuery,
  type TelemetryRecord,
} from '../../core/index.js';

/**
 * File telemetry connector + evidence normalizer (WP3-15, FR3-25.1-4).
 *
 * Reads JSONL records from one allowlisted directory: sources are relative
 * names that must resolve inside the root (traversal, absolute paths, and
 * symlink escapes are refused). Malformed lines count as dropped, oversized
 * files and over-limit queries fail closed, and every read carries a receipt
 * binding the exact query. `normalizeToEvidence` turns a page into validated
 * `IncidentEvidence` for `assessTelemetryQuality` — the only path from raw
 * telemetry to assessed facts. Backend-profile live connectors (FR3-25.5)
 * implement the same port once catalogued backends and authorized access exist.
 */

export interface FileConnectorOptions {
  readonly maxBytes?: number;
  readonly maxLimit?: number;
}

export interface EvidenceIdentities {
  readonly incidentId: string;
  readonly sourceIdentity: string;
  readonly deployIdentity: string;
  readonly configIdentity: string;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_LIMIT = 10_000;

function parseInstant(value: string, label: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new ChangeProofError(`${label} is unreadable; refusing to query.`);
  }
  return ms;
}

function recordFrom(value: unknown): TelemetryRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const fields = value as Record<string, unknown>;
  const eventAt = typeof fields['eventAt'] === 'string' ? fields['eventAt'] : '';
  const observedAt = typeof fields['observedAt'] === 'string' ? fields['observedAt'] : '';
  const record: {
    eventAt: string;
    observedAt: string;
    traceId?: string;
    operationId?: string;
    spanId?: string;
    fields: Readonly<Record<string, unknown>>;
  } = { eventAt, observedAt, fields };
  if (typeof fields['traceId'] === 'string') {
    record.traceId = fields['traceId'];
  }
  if (typeof fields['operationId'] === 'string') {
    record.operationId = fields['operationId'];
  }
  if (typeof fields['spanId'] === 'string') {
    record.spanId = fields['spanId'];
  }
  return record;
}

export function createFileTelemetryConnector(rootDir: string, options: FileConnectorOptions = {}): TelemetryConnectorPort {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLimit = options.maxLimit ?? DEFAULT_MAX_LIMIT;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new ChangeProofError('Connector maxBytes must be a positive integer.');
  }
  if (!Number.isInteger(maxLimit) || maxLimit <= 0) {
    throw new ChangeProofError('Connector maxLimit must be a positive integer.');
  }
  const root = resolve(rootDir);

  const readPage = (query: TelemetryQuery): TelemetryPage => {
    if (query.source.length === 0) {
      throw new ChangeProofError('Telemetry source is empty; refusing to read.');
    }
    if (isAbsolute(query.source) || query.source.split(/[\\/]/).includes('..')) {
      throw new ChangeProofError('Telemetry source escapes its scope; refusing to read.');
    }
    if (!Number.isInteger(query.limit) || query.limit <= 0 || query.limit > maxLimit) {
      throw new ChangeProofError(`Telemetry limit must be 1..${String(maxLimit)}; refusing to read.`);
    }
    const sinceMs = query.sinceIso === undefined ? null : parseInstant(query.sinceIso, 'Query sinceIso');
    const untilMs = query.untilIso === undefined ? null : parseInstant(query.untilIso, 'Query untilIso');

    const candidate = resolve(join(root, query.source));
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      throw new ChangeProofError('Telemetry source escapes its scope; refusing to read.');
    }
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      throw new ChangeProofError('Telemetry source is unknown; refusing to invent data.');
    }
    if (real !== root && !real.startsWith(`${root}${sep}`)) {
      throw new ChangeProofError('Telemetry source escapes its scope through a link; refusing to read.');
    }
    let size: number;
    try {
      size = statSync(real).size;
    } catch {
      throw new ChangeProofError('Telemetry source is unknown; refusing to invent data.');
    }
    if (size > maxBytes) {
      throw new ChangeProofError(
        `Telemetry source is ${String(size)} bytes over the ${String(maxBytes)}-byte cap; refusing to read.`,
      );
    }
    {
      const text = readFileSync(real, 'utf8');
      const records: TelemetryRecord[] = [];
      let dropped = 0;
      let truncated = false;
      for (const line of text.split('\n')) {
        if (line.trim().length === 0) {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line) as unknown;
        } catch {
          dropped += 1;
          continue;
        }
        const record = recordFrom(parsed);
        if (record === null) {
          dropped += 1;
          continue;
        }
        if (sinceMs !== null || untilMs !== null) {
          const at = Date.parse(record.observedAt);
          if (!Number.isFinite(at)) {
            dropped += 1;
            continue;
          }
          if ((sinceMs !== null && at < sinceMs) || (untilMs !== null && at > untilMs)) {
            continue;
          }
        }
        if (records.length >= query.limit) {
          truncated = true;
          break;
        }
        records.push(record);
      }
      const queryDigest = createHash('sha256')
        .update(
          JSON.stringify({
            source: query.source,
            sinceIso: query.sinceIso,
            untilIso: query.untilIso,
            limit: query.limit,
          }),
        )
        .digest('hex');
      const queryReceipt =
        `file:${query.source}:kept=${String(records.length)}:dropped=${String(dropped)}` +
        `:truncated=${truncated ? '1' : '0'}:q=${queryDigest}`;
      return { records, dropped, truncated, queryReceipt };
    }
  };

  return {
    backend: 'file-jsonl',

    query: (query: TelemetryQuery): Promise<TelemetryPage> => Promise.resolve().then(() => readPage(query)),
  };
}

export function normalizeToEvidence(page: TelemetryPage, identities: EvidenceIdentities): IncidentEvidence {
  const seen = { traceIds: new Set<string>(), operationIds: new Set<string>(), spanIds: new Set<string>() };
  const eventTimestamps: string[] = [];
  const observedTimestamps: string[] = [];
  for (const record of page.records) {
    if (record.traceId !== undefined && record.traceId.length > 0) {
      seen.traceIds.add(record.traceId);
    }
    if (record.operationId !== undefined && record.operationId.length > 0) {
      seen.operationIds.add(record.operationId);
    }
    if (record.spanId !== undefined && record.spanId.length > 0) {
      seen.spanIds.add(record.spanId);
    }
    if (record.eventAt.length > 0) {
      eventTimestamps.push(record.eventAt);
    }
    if (record.observedAt.length > 0) {
      observedTimestamps.push(record.observedAt);
    }
  }
  return IncidentEvidenceSchema.parse({
    schemaVersion: '1',
    incidentId: identities.incidentId,
    sourceIdentity: identities.sourceIdentity,
    deployIdentity: identities.deployIdentity,
    configIdentity: identities.configIdentity,
    operationIds: [...seen.operationIds],
    traceIds: [...seen.traceIds],
    spanIds: [...seen.spanIds],
    eventTimestamps,
    observedTimestamps,
    sampling: page.truncated || page.dropped > 0 ? 'partial' : 'none',
    droppedObservations: page.dropped,
    redactions: [],
    readScopeReceipts: [page.queryReceipt],
    rawRefs: [page.queryReceipt],
  });
}
