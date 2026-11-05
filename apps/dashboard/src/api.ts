/* Typed HTTP client (T-42). Same-origin JSON against src/http; every
 * response narrows through the ApiEnvelope at runtime. Mutations carry
 * the X-Requested-With header the server requires (CSRF layer). */

import type { ApiEnvelope } from '../../../src/core/contracts/schemas/http.js';

export interface ApiFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly offline: boolean;
  /** Envelope extras beyond ok/error (e.g. the template apply gate). */
  readonly detail?: unknown;
}

export class ApiRequestError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiRequestError';
    this.failure = failure;
  }
}

function envelopeOf(value: unknown): ApiEnvelope | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if ('ok' in value && value.ok === true && 'data' in value) return value as ApiEnvelope;
  if ('ok' in value && value.ok === false && 'error' in value) {
    const error = value.error;
    if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error &&
        typeof error.code === 'string' && typeof error.message === 'string') return value as ApiEnvelope;
  }
  return undefined;
}

async function request<T>(path: string, init: RequestInit, extraHeaders: Record<string, string> = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: 'same-origin', headers });
  } catch {
    throw new ApiRequestError({
      status: 0,
      code: 'offline',
      message: 'The service cannot be reached. Check your connection and retry.',
      offline: true,
    });
  }
  const body: unknown = await response.json().catch(() => undefined);
  const envelope = envelopeOf(body);
  if (response.ok && envelope?.ok === true) return envelope.data as T;
  if (envelope?.ok === false) {
    const raw = body as Record<string, unknown>;
    const detail: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key !== 'ok' && key !== 'error') detail[key] = value;
    }
    throw new ApiRequestError({
      status: response.status,
      code: envelope.error.code,
      message: envelope.error.message,
      offline: false,
      ...(Object.keys(detail).length > 0 ? { detail } : {}),
    });
  }
  throw new ApiRequestError({
    status: response.status,
    code: response.ok ? 'bad_response' : 'request_failed',
    message:
      response.status === 401
        ? 'Login is required for this action.'
        : response.status === 403
          ? 'Your account is not authorized for this action.'
          : 'The service returned an unreadable response. Retry, and report it if it persists.',
    offline: false,
  });
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

/** Authenticated byte download (T-46): octet-stream on success, JSON envelope on failure. */
export async function apiGetBytes(path: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/octet-stream' },
    });
  } catch {
    throw new ApiRequestError({
      status: 0,
      code: 'offline',
      message: 'The service cannot be reached. Check your connection and retry.',
      offline: true,
    });
  }
  if (response.ok) return new Uint8Array(await response.arrayBuffer());
  const body: unknown = await response.json().catch(() => undefined);
  const envelope = envelopeOf(body);
  if (envelope?.ok === false) {
    throw new ApiRequestError({
      status: response.status,
      code: envelope.error.code,
      message: envelope.error.message,
      offline: false,
    });
  }
  throw new ApiRequestError({
    status: response.status,
    code: 'request_failed',
    message:
      response.status === 401
        ? 'Login is required for this action.'
        : response.status === 403
          ? 'Your account is not authorized for this action.'
          : 'The service returned an unreadable response. Retry, and report it if it persists.',
    offline: false,
  });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(
    path,
    { method: 'POST', body: JSON.stringify(body) },
    { 'Content-Type': 'application/json', 'X-Requested-With': 'ChangeProofUI' },
  );
}

export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(
    path,
    body === undefined ? { method: 'DELETE' } : { method: 'DELETE', body: JSON.stringify(body) },
    body === undefined
      ? { 'X-Requested-With': 'ChangeProofUI' }
      : { 'Content-Type': 'application/json', 'X-Requested-With': 'ChangeProofUI' },
  );
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(
    path,
    { method: 'PATCH', body: JSON.stringify(body) },
    { 'Content-Type': 'application/json', 'X-Requested-With': 'ChangeProofUI' },
  );
}
