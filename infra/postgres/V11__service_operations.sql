-- V11 — service operations deploy path (WP3-26, FR3-34/35/36).
--
-- Mirrors the self-creating operations tables so a fresh deploy carries
-- them with RLS and grants from the start. All statements are idempotent
-- with the code-created tables (IF NOT EXISTS / DROP IF EXISTS).
-- Global ops tables carry no tenant rows, so they take grants without a
-- tenant RLS policy; tenant-scoped tables take the standard isolation policy.

CREATE TABLE IF NOT EXISTS ops_drain (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  draining BOOLEAN NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON ops_drain TO app_user;

CREATE TABLE IF NOT EXISTS ops_quarantine (
  worker_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON ops_quarantine TO app_user;

CREATE TABLE IF NOT EXISTS ops_outages (
  component TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  probe_receipt TEXT
);
GRANT SELECT, INSERT, UPDATE ON ops_outages TO app_user;

CREATE TABLE IF NOT EXISTS deletion_fences (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  scope TEXT NOT NULL,
  fenced_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, scope)
);
ALTER TABLE deletion_fences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON deletion_fences;
CREATE POLICY tenant_isolation ON deletion_fences
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON deletion_fences TO app_user;

CREATE TABLE IF NOT EXISTS deletion_tombstones (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  tombstoned_at TIMESTAMPTZ NOT NULL,
  purge_after TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, subject_kind, subject_id)
);
ALTER TABLE deletion_tombstones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON deletion_tombstones;
CREATE POLICY tenant_isolation ON deletion_tombstones
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON deletion_tombstones TO app_user;
CREATE INDEX IF NOT EXISTS deletion_tombstones_purge ON deletion_tombstones (tenant_id, purge_after);

CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  kind TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  period_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_events;
CREATE POLICY tenant_isolation ON payment_events
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON payment_events TO app_user;
CREATE INDEX IF NOT EXISTS payment_events_tenant ON payment_events (tenant_id, kind);
