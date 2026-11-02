-- V3__jobs.sql — WP3-23 durable dispatcher: runs, jobs, fenced leases, outbox, checkpoints.
--
-- Depends on V1 (tenants, app_user) and V2 (is_tenant_fenced). All tables are
-- tenant-scoped with RLS on app.current_tenant like V1; the store binds the
-- tenant with SET LOCAL inside a transaction and uses bound parameters only.
--
-- Durability rules enforced here, not hoped for in code:
-- - runs: UNIQUE (tenant_id, idempotency_key) — a replayed admission returns
--   the existing run; duplicate physical work is impossible by constraint.
-- - job_leases: one row per job; epoch grows on every re-claim (a stale owner
--   can never match it again); version is the CAS counter (every mutation
--   names the version it read). candidate_digest is immutable once set: resume
--   preserves candidate identity, and a changed candidate is a new job.
-- - outbox: effect_id is globally unique — one logical effect per identity.
-- - checkpoints: UNIQUE (job_id, version) chained to the lease CAS version,
--   so two concurrent writers cannot both win.
--
-- Probe-style: additive only, safe to apply after V1+V2 on a disposable database.
-- The hosted migrator records applied versions in its own ledger.

-- Admitted runs: idempotency keyed, reservation owned by usage (WP3-24).
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  idempotency_key TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON runs;
CREATE POLICY tenant_isolation ON runs
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON runs TO app_user;

-- Durable queue: exactly one row per job; the row IS the queue (no memory state).
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  run_id TEXT NOT NULL REFERENCES runs (id),
  state TEXT NOT NULL CHECK (state IN ('queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON jobs;
CREATE POLICY tenant_isolation ON jobs
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON jobs TO app_user;
CREATE INDEX IF NOT EXISTS jobs_claim_order ON jobs (tenant_id, state, created_at, id);

-- Current fencing state per job (JobLease contract, plus the assigned guest).
CREATE TABLE IF NOT EXISTS job_leases (
  job_id TEXT PRIMARY KEY REFERENCES jobs (id),
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  version INTEGER NOT NULL CHECK (version >= 0),
  owner_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  image_digest TEXT NOT NULL,
  candidate_digest TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'expired', 'revoked', 'completed')),
  retry_count INTEGER NOT NULL CHECK (retry_count >= 0),
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  grant_version INTEGER NOT NULL CHECK (grant_version >= 0)
);
ALTER TABLE job_leases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON job_leases;
CREATE POLICY tenant_isolation ON job_leases
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON job_leases TO app_user;
CREATE INDEX IF NOT EXISTS job_leases_expiry ON job_leases (tenant_id, state, expires_at);

-- Transactional outbox: effects are durable before any external action.
CREATE TABLE IF NOT EXISTS outbox (
  effect_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  job_id TEXT NOT NULL REFERENCES jobs (id),
  kind TEXT NOT NULL CHECK (kind IN ('result', 'usage', 'publication', 'notification')),
  payload_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'dispatched', 'done')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outbox;
CREATE POLICY tenant_isolation ON outbox
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON outbox TO app_user;
CREATE INDEX IF NOT EXISTS outbox_dispatch_order ON outbox (tenant_id, state, created_at);

-- Fenced progress writes, chained to the lease CAS version.
CREATE TABLE IF NOT EXISTS checkpoints (
  job_id TEXT NOT NULL REFERENCES jobs (id),
  version INTEGER NOT NULL CHECK (version >= 0),
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  state_ref TEXT NOT NULL,
  written_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (job_id, version)
);
ALTER TABLE checkpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON checkpoints;
CREATE POLICY tenant_isolation ON checkpoints
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON checkpoints TO app_user;
