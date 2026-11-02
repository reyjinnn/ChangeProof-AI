import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

import { z } from 'zod';

import { ChangeProofError } from '../core/index.js';
import type { PublicSiteComposition } from '../orchestrator/index.js';
import { HttpRouteError } from './context.js';
import { sendFail, sendOk } from './respond.js';
import { handleAuthApi, isAuthPath, type AuthDeps } from './routes-auth.js';
import { handleApi, type ApiContext } from './routes.js';
import { handleRunsApi, isRunsPath, type RunsDeps } from './routes-runs.js';
import {
  handleNotificationsApi,
  isNotificationsPath,
  type NotificationsDeps,
} from './routes-notifications.js';
import { handleTeamworkApi, isTeamworkPath, type TeamworkDeps } from './routes-teamwork.js';

/**
 * Thin HTTP slice (T-42, WP3-27/25).
 *
 * Serves JSON from existing orchestrator wiring plus the built dashboard
 * as static files. Adds no grant, verdict, or persistence behavior of its
 * own: every API answer comes from the composed leaf module, and every
 * outgoing public DTO passes `assertPublicSafe` again (NEG3-21).
 */

export interface HttpOptions {
  readonly publicSite: PublicSiteComposition;
  readonly manifestPath: string;
  /** Built dashboard directory; absent in API-only tests with an explicit code. */
  readonly distDir?: string;
  readonly maxBodyBytes?: number;
  /** Account services; absent without a database (auth paths answer 503). */
  readonly auth?: AuthDeps;
  /** Run-journey services; absent without a database (runs paths answer 503). */
  readonly runs?: RunsDeps;
  /** Notification services; absent without a database (notifications paths answer 503). */
  readonly notifications?: NotificationsDeps;
  /** Teamwork services; absent without a database (teamwork paths answer 503). */
  readonly teamwork?: TeamworkDeps;
}

export interface HttpHandle {
  readonly server: Server;
  readonly close: () => Promise<void>;
}

const TEXT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.ico', 'image/x-icon'],
]);

function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        // Drain the rest so the socket stays usable for the 413 answer;
        // destroying here would reset the connection before it is sent.
        request.removeAllListeners('data');
        request.resume();
        reject(new ChangeProofError(`Request body exceeds the ${maxBytes}-byte limit; refusing to buffer it.`));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    request.on('error', (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error instanceof Error ? error : new Error('Request stream failed.'));
      }
    });
  });
}

/** Mutations need the UI marker header plus a same-origin request. */
function assertSameOrigin(request: IncomingMessage): void {
  if ((request.headers['x-requested-with'] ?? '') !== 'ChangeProofUI') {
    throw new ChangeProofError('Mutation refused: the ChangeProofUI request marker is missing (CSRF layer).');
  }
  const origin = request.headers.origin;
  if (origin !== undefined) {
    const host = request.headers.host ?? '';
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ChangeProofError('Mutation refused: the Origin header is unreadable.');
    }
    if (originHost !== host) {
      throw new ChangeProofError('Mutation refused: cross-origin mutations are not accepted.');
    }
  }
}

/** Resolve a static path inside distDir; traversal fails closed. */
function resolveStatic(distDir: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new ChangeProofError('Refusing a static path with unreadable escapes.');
  }
  const relative = decoded.replace(/^\/+/, '');
  const resolved = normalize(join(distDir, relative === '' ? 'index.html' : relative));
  const root = normalize(distDir + sep);
  if (resolved !== normalize(distDir) && !resolved.startsWith(root)) return undefined;
  return resolved;
}

async function serveStatic(response: ServerResponse, distDir: string | undefined, pathname: string): Promise<void> {
  if (distDir === undefined) {
    sendFail(response, 404, 'ui_not_built', 'The dashboard has not been built; run the UI build first.');
    return;
  }
  const file = resolveStatic(distDir, pathname);
  if (file === undefined) {
    sendFail(response, 400, 'bad_path', 'Refusing a static path that escapes the dashboard directory.');
    return;
  }
  const candidates = file.endsWith(sep) ? [`${file}index.html`] : [file];
  // Extensionless app paths fall back to the shell; unknown files 404.
  if (extname(file) === '' && !file.endsWith(sep)) candidates.push(join(distDir, 'index.html'));
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(candidate);
      response.writeHead(200, {
        'Content-Type': TEXT_TYPES.get(extname(candidate)) ?? 'application/octet-stream',
        'Content-Length': bytes.length,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
      });
      response.end(bytes);
      return;
    } catch {
      // Try the next candidate, then fall through to 404.
    }
  }
  sendFail(response, 404, 'not_found', `No dashboard asset at "${pathname}".`);
}

export function createHttpServer(options: HttpOptions): HttpHandle {
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  const manifest = options.publicSite.loadManifestFile(options.manifestPath);
  const ctx: ApiContext = { publicSite: options.publicSite, manifest };

  const server: Server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      process.stderr.write(`http: unhandled handler error: ${error instanceof Error ? error.message : String(error)}\n`);
      if (!response.headersSent) sendFail(response, 500, 'internal', 'An unexpected error occurred.');
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url === undefined || request.method === undefined) {
      sendFail(response, 400, 'bad_request', 'Request has no URL or method.');
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch {
      sendFail(response, 400, 'bad_request', 'Request URL is unreadable.');
      return;
    }
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        sendOk(response, { status: 'ok', service: 'changeproof', contentVersion: manifest.contentVersion });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'DELETE' && request.method !== 'PATCH') {
          sendFail(response, 405, 'method_not_allowed', `Method ${request.method} is not accepted here.`);
          return;
        }
        if (request.method !== 'GET') {
          assertSameOrigin(request);
        }
        const rawBody = request.method === 'GET' ? '' : await readBody(request, maxBodyBytes);
        if (isAuthPath(url.pathname)) {
          await handleAuthApi(options.auth, request, response, request.method, url, rawBody);
          return;
        }
        if (isRunsPath(url.pathname)) {
          await handleRunsApi(options.runs, request, response, request.method, url, rawBody);
          return;
        }
        if (isNotificationsPath(url.pathname)) {
          await handleNotificationsApi(options.notifications, request, response, request.method, url, rawBody);
          return;
        }
        if (isTeamworkPath(url.pathname)) {
          await handleTeamworkApi(options.teamwork, request, response, request.method, url, rawBody);
          return;
        }
        handleApi(ctx, response, request.method, url);
        return;
      }
      if (request.method !== 'GET') {
        sendFail(response, 405, 'method_not_allowed', `Method ${request.method} is not accepted here.`);
        return;
      }
      await serveStatic(response, options.distDir, url.pathname);
    } catch (error) {
      if (error instanceof HttpRouteError) {
        sendFail(response, error.status, error.code, error.message);
        return;
      }
      if (error instanceof z.ZodError) {
        sendFail(response, 400, 'bad_request', `Request is invalid: ${error.issues[0]?.message ?? 'unreadable input'}.`);
        return;
      }
      if (error instanceof ChangeProofError) {
        const message = error.message;
        // A boundary refusal means the server's own content is tainted: 500, never a guest-facing 400.
        if (error.name === 'PublicBoundaryError') {
          process.stderr.write(`http: public boundary refused: ${message}\n`);
          sendFail(response, 500, 'internal', 'An unexpected error occurred.');
        } else if (message.includes('CSRF') || message.includes('cross-origin') || message.includes('marker')) {
          sendFail(response, 403, 'csrf_required', message);
        } else if (message.includes('exceeds')) {
          sendFail(response, 413, 'body_too_large', message);
        } else if (error.name === 'PublicContentNotFoundError') {
          sendFail(response, 404, 'not_found', message);
        } else {
          sendFail(response, 400, 'bad_request', message);
        }
        return;
      }
      process.stderr.write(`http: handler failed: ${error instanceof Error ? error.message : String(error)}\n`);
      sendFail(response, 500, 'internal', 'An unexpected error occurred.');
    }
  }

  return {
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}
