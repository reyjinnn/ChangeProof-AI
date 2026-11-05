import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { z } from 'zod';

import { ChangeProofError, IdSchema, NonEmptyStringSchema, Sha256Schema } from '../core/index.js';
import type { LifecycleSessionPort } from '../core/ports/index.js';
import type {
  DistributionComposition,
  IdentityComposition,
  UsageComposition,
} from '../orchestrator/index.js';
import { actingContext, HttpRouteError, parseBody, pathSegment } from './context.js';
import { sendCreated, sendFail, sendOk } from './respond.js';

/**
 * Enterprise routes (T-49, WP3-24/31/32): usage balances, BYOK
 * credential metadata, SAML connections, and SCIM tokens.
 *
 * Thin JSON over the composed stores with the tenant always
 * server-derived from the session. Key material never crosses these
 * routes: BYOK moves fingerprints only (values onboard through the
 * CLI secrets file), and SCIM tokens display once at creation.
 * Payment webhooks, SCIM event application, and worker/ledger calls
 * stay off HTTP.
 */

export interface EnterpriseDeps {
  readonly session: LifecycleSessionPort;
  readonly usage: { store: UsageComposition['store'] };
  readonly byok: { store: DistributionComposition['byok']; secrets: DistributionComposition['secrets'] };
  readonly saml: { store: IdentityComposition['saml'] };
  readonly scim: { store: IdentityComposition['scim'] };
}

const ByokProvisionBody = z.strictObject({
  refId: IdSchema,
  provider: NonEmptyStringSchema,
  model: NonEmptyStringSchema,
  fingerprint: Sha256Schema,
});
const ByokRotateBody = z.strictObject({ newFingerprint: Sha256Schema });
const SamlProvisionBody = z.strictObject({
  entityId: NonEmptyStringSchema,
  idpIssuer: NonEmptyStringSchema,
  audience: NonEmptyStringSchema,
  acsUrl: NonEmptyStringSchema,
  certPem: NonEmptyStringSchema,
  verifiedDomain: NonEmptyStringSchema,
});
const SamlRotateBody = z.strictObject({ certPem: NonEmptyStringSchema });
const SamlLinkBody = z.strictObject({ subject: NonEmptyStringSchema, userId: IdSchema });
const LedgerQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(50) });

function queryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/** Store refusals map to status without leaking which tenant owns what. */
async function orMapped<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ChangeProofError) {
      if (error.message.includes('unknown') || error.message.includes('missing')) {
        throw new HttpRouteError(404, 'not_found', error.message);
      }
      if (
        error.message.includes('Only ') ||
        error.message.includes('owner or admin') ||
        error.message.includes('no tenant authority') ||
        error.message.includes('not authorized')
      ) {
        throw new HttpRouteError(403, 'forbidden', error.message);
      }
    }
    throw error;
  }
}

export function isEnterprisePath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/billing/') ||
    pathname === '/api/byok/credentials' ||
    pathname.startsWith('/api/byok/credentials/') ||
    pathname.startsWith('/api/enterprise/')
  );
}

export async function handleEnterpriseApi(
  deps: EnterpriseDeps | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  url: URL,
  rawBody: string,
): Promise<void> {
  if (deps === undefined) {
    sendFail(response, 503, 'enterprise_unavailable', 'Enterprise services need a database; the server was started without one.');
    return;
  }
  const { pathname } = url;
  const nowIso = new Date().toISOString();

  if (method === 'GET' && pathname === '/api/billing/balances') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const balances = await orMapped(deps.usage.store.readBalances({ tenantId: ctx.tenantId }));
    sendOk(response, balances);
    return;
  }
  if (method === 'GET' && pathname === '/api/billing/summary') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const balances = await orMapped(deps.usage.store.readBalances({ tenantId: ctx.tenantId }));
    sendOk(response, { used: balances.consumed, limit: balances.cap });
    return;
  }
  if (method === 'GET' && pathname === '/api/billing/ledger') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const query = LedgerQuery.parse(queryParams(url));
    const ledger = await orMapped(deps.usage.store.listLedger({ tenantId: ctx.tenantId, limit: query.limit }));
    sendOk(response, {
      items: ledger.entries.map((entry) => ({
        entryId: entry.entryId,
        kind: entry.kind,
        amount: entry.amount,
        detail: entry.runId,
      })),
    });
    return;
  }
  if (method === 'POST' && pathname === '/api/byok/credentials') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const body = parseBody(ByokProvisionBody, rawBody);
    const provisioned = await orMapped(
      deps.byok.store.provisionCredential({
        context: ctx,
        refId: body.refId,
        provider: body.provider,
        model: body.model,
        fingerprint: body.fingerprint,
        secrets: deps.byok.secrets,
        nowIso,
      }),
    );
    sendCreated(response, provisioned);
    return;
  }
  if (method === 'GET' && pathname.startsWith('/api/byok/credentials/')) {
    const ctx = await actingContext(deps.session, request, nowIso);
    const refId = pathSegment(pathname, 4, 'Credential ref');
    sendOk(response, await orMapped(deps.byok.store.getCredential({ context: ctx, refId })));
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/byok/credentials/') && pathname.endsWith('/rotate')) {
    const ctx = await actingContext(deps.session, request, nowIso);
    const refId = pathSegment(pathname, 4, 'Credential ref');
    const rotated = await orMapped(
      deps.byok.store.rotateCredential({
        context: ctx,
        refId,
        newFingerprint: parseBody(ByokRotateBody, rawBody).newFingerprint,
        secrets: deps.byok.secrets,
        nowIso,
      }),
    );
    sendOk(response, rotated);
    return;
  }
  if (method === 'POST' && pathname.startsWith('/api/byok/credentials/') && pathname.endsWith('/revoke')) {
    const ctx = await actingContext(deps.session, request, nowIso);
    const refId = pathSegment(pathname, 4, 'Credential ref');
    sendOk(response, await orMapped(deps.byok.store.revokeCredential({ context: ctx, refId, nowIso })));
    return;
  }
  if (method === 'GET' && pathname === '/api/enterprise/saml') {
    const ctx = await actingContext(deps.session, request, nowIso);
    sendOk(response, await orMapped(deps.saml.store.getConnection(ctx.tenantId)));
    return;
  }
  if (method === 'POST' && pathname === '/api/enterprise/saml') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const body = parseBody(SamlProvisionBody, rawBody);
    sendCreated(
      response,
      await orMapped(
        deps.saml.store.provisionConnection({
          actor: ctx,
          entityId: body.entityId,
          idpIssuer: body.idpIssuer,
          audience: body.audience,
          acsUrl: body.acsUrl,
          certPem: body.certPem,
          verifiedDomain: body.verifiedDomain,
          nowIso,
        }),
      ),
    );
    return;
  }
  if (method === 'POST' && pathname === '/api/enterprise/saml/rotate') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const rotated = await orMapped(
      deps.saml.store.rotateCertificate({ actor: ctx, certPem: parseBody(SamlRotateBody, rawBody).certPem, nowIso }),
    );
    sendOk(response, rotated);
    return;
  }
  if (method === 'POST' && pathname === '/api/enterprise/saml/disable') {
    const ctx = await actingContext(deps.session, request, nowIso);
    await orMapped(deps.saml.store.disableConnection({ actor: ctx, nowIso }));
    sendOk(response, { disabled: true });
    return;
  }
  if (method === 'POST' && pathname === '/api/enterprise/saml/link') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const body = parseBody(SamlLinkBody, rawBody);
    await orMapped(deps.saml.store.linkSubject({ actor: ctx, subject: body.subject, userId: body.userId, nowIso }));
    sendOk(response, { subject: body.subject, userId: body.userId });
    return;
  }
  if (method === 'POST' && pathname === '/api/enterprise/scim/tokens') {
    const ctx = await actingContext(deps.session, request, nowIso);
    const tokenId = `scim-${randomUUID()}`;
    sendCreated(response, await orMapped(deps.scim.store.createToken({ actor: ctx, tokenId, nowIso })));
    return;
  }
  if (
    method === 'POST' &&
    pathname.startsWith('/api/enterprise/scim/tokens/') &&
    pathname.endsWith('/revoke')
  ) {
    const ctx = await actingContext(deps.session, request, nowIso);
    const tokenId = pathSegment(pathname, 5, 'SCIM token');
    sendOk(response, await orMapped(deps.scim.store.revokeToken({ actor: ctx, tokenId, nowIso })));
    return;
  }
  sendFail(response, 404, 'unknown_endpoint', `No API endpoint at "${pathname}".`);
}
