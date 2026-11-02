-- V6__lifecycle.sql — WP3-25 run lifecycle: draft revisions, runs, run events.
--
-- Depends on V1 (tenants, projects, repository_grants, app_user). All tables
-- are tenant-scoped with RLS on app.current_tenant like V1/V3; the store binds
-- the tenant with SET LOCAL inside a transaction and uses bound parameters
-- only. Grants stay in V1 tables: a repository effect is authorized only while
-- its repository_grants row exists, checked at effect time (NEG3-22).
--
-- Durability rules enforced here, not hoped for in code:
-- - draft_revisions: PRIMARY KEY (draft_id, revision) — revisions are
--   append-only; the store never UPDATEs a revision row.
-- - lifecycle_runs: UNIQUE (tenant_id, idempotency_key) — a replayed submit
--   returns the existing run; duplicate physical work is impossible by
--   constraint. version is the CAS counter for state transitions; submit
--   columns (draft ref, digest, repos) are never updated by the store.
-- - run_events: UNIQUE (run_id, seq) — one ordered history per run; the store
--   allocates seq under a row lock on the parent run.
--
-- Probe-style: additive only, safe to apply after V1 on a disposable database.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS name TEXT;

CREATE TABLE IF NOT EXISTS draft_revisions (
  draft_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  project_id TEXT NOT NULL REFERENCES projects (id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (draft_id, revision)
);
ALTER TABLE draft_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON draft_revisions;
CREATE POLICY tenant_isolation ON draft_revisions
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON draft_revisions TO app_user;

CREATE TABLE IF NOT EXISTS lifecycle_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  project_id TEXT NOT NULL REFERENCES projects (id),
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  job_id TEXT,
  reservation_id TEXT,
  submit_digest TEXT NOT NULL,
  submit JSONB NOT NULL,
  repository_ids JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (draft_id, draft_revision) REFERENCES draft_revisions (draft_id, revision)
);
ALTER TABLE lifecycle_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle_runs;
CREATE POLICY tenant_isolation ON lifecycle_runs
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON lifecycle_runs TO app_user;

CREATE TABLE IF NOT EXISTS run_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  run_id TEXT NOT NULL REFERENCES lifecycle_runs (id),
  seq INTEGER NOT NULL CHECK (seq > 0),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (run_id, seq)
);
ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON run_events;
CREATE POLICY tenant_isolation ON run_events
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON run_events TO app_user;
GRANT USAGE, SELECT ON SEQUENCE run_events_id_seq TO app_user;
