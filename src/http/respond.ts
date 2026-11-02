import type { ServerResponse } from 'node:http';

/** Shared JSON responders: imported by the server and the route table alike. */

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  response.end(text);
}

export function sendOk(response: ServerResponse, data: unknown): void {
  sendJson(response, 200, { ok: true, data });
}

export function sendCreated(response: ServerResponse, data: unknown): void {
  sendJson(response, 201, { ok: true, data });
}

/** Authenticated byte download: digest-named, never sniffed, never inline. */
export function sendBytes(response: ServerResponse, bytes: Uint8Array, digest: string): void {
  response.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': bytes.length,
    'Content-Disposition': `attachment; filename="${digest}.bin"`,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  response.end(bytes);
}

export function sendFail(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  sendJson(response, status, { ok: false, error: { code, message }, ...(extra ?? {}) });
}
