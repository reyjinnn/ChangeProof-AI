import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import {
  ChangeProofError,
  IdSchema,
  InstantSchema,
  NonEmptyStringSchema,
  type SecretBrokerPort,
} from '../../core/index.js';

/**
 * Provider webhook handling (WP3-32, FR3-45).
 *
 * GitLab signs nothing but shares a secret token: verification compares the
 * presented header against the broker-held value in constant time, and any
 * mismatch, unknown ref, or empty value fails closed. Bitbucket Cloud offers
 * no webhook secret, so its events are triggers only — the caller must
 * re-read exact state over the authenticated API before any effect; the
 * event body is never authority (NEG3-39).
 */

export async function verifyGitLabWebhook(input: {
  secrets: SecretBrokerPort;
  credentialRef: string;
  presented: string;
}): Promise<'verified'> {
  const ref = IdSchema.parse(input.credentialRef);
  const presented = NonEmptyStringSchema.parse(input.presented);
  const expected = await input.secrets.readCredential(ref);
  const left = Buffer.from(presented, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new ChangeProofError('GitLab webhook secret does not match; event is refused.');
  }
  return 'verified';
}

/** Bitbucket Cloud webhooks carry no verifiable secret: trigger-only, always reconcile. */
export function bitbucketWebhookAuth(): 'trigger-only' {
  return 'trigger-only';
}

export interface ProvidersDbResult {
  readonly rows: unknown[];
  readonly rowCount: number | null;
}

export interface ProvidersDbClient {
  query(text: string, params?: readonly unknown[]): Promise<ProvidersDbResult>;
  release(): void;
}

export interface ProvidersDb {
  query(text: string, params?: readonly unknown[]): Promise<ProvidersDbResult>;
  connect(): Promise<ProvidersDbClient>;
}

const ProviderEventRowSchema = z.object({
  provider: z.string(),
  event_uuid: z.string(),
  outcome: z.string(),
});

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = (error as Record<string, unknown>)['code'];
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export type ProviderEventOutcome = 'reconciled' | 'duplicate' | 'trigger_only';

export interface ProviderEventStore {
  recordEvent(input: {
    tenantId: string;
    provider: 'github' | 'gitlab' | 'bitbucket';
    eventUuid: string;
    verified: boolean;
    nowIso: string;
  }): Promise<{ outcome: ProviderEventOutcome; duplicate: boolean }>;
}

export function createProviderEventStore(db: ProvidersDb): ProviderEventStore {
  return {
    async recordEvent(input): Promise<{ outcome: ProviderEventOutcome; duplicate: boolean }> {
      const tenantId = IdSchema.parse(input.tenantId);
      const provider = z.enum(['github', 'gitlab', 'bitbucket']).parse(input.provider);
      const eventUuid = NonEmptyStringSchema.parse(input.eventUuid);
      const nowIso = InstantSchema.parse(input.nowIso);
      const outcome: ProviderEventOutcome = input.verified ? 'reconciled' : 'trigger_only';
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        try {
          await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
          await client.query('SAVEPOINT provider_event_guard');
          try {
            await client.query(
              `INSERT INTO provider_events (provider, event_uuid, tenant_id, verified, outcome, received_at)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [provider, eventUuid, tenantId, input.verified, outcome, nowIso],
            );
            await client.query('RELEASE SAVEPOINT provider_event_guard');
            await client.query('COMMIT');
            return { outcome, duplicate: false };
          } catch (error) {
            if (errorCode(error) !== '23505') {
              throw error;
            }
            await client.query('ROLLBACK TO SAVEPOINT provider_event_guard');
            const existing = await client.query(
              `SELECT provider, event_uuid, outcome FROM provider_events
               WHERE provider = $1 AND event_uuid = $2`,
              [provider, eventUuid],
            );
            const row = existing.rows[0];
            await client.query('COMMIT');
            if (row === undefined) {
              throw new ChangeProofError('Provider event raced; retry against current state.');
            }
            const parsed = ProviderEventRowSchema.parse(row);
            if (parsed.outcome !== 'reconciled' && parsed.outcome !== 'duplicate' && parsed.outcome !== 'trigger_only') {
              throw new ChangeProofError('Provider event holds an unknown outcome; refusing.');
            }
            return { outcome: 'duplicate', duplicate: true };
          }
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } finally {
        client.release();
      }
    },
  };
}
