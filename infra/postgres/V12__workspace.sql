-- V12__workspace.sql — WP3-25/21/24/29 workspace reads: project descriptions,
-- environment profiles, GitHub connections, telemetry corpus metadata.
--
-- Depends on V1 (tenants, app_user). Additive only: existing rows keep working,
-- and stores treat missing tables/columns as empty on reads while writes fail
-- closed naming this file (pre-V12 probe databases keep passing unchanged).
--
-- All tables are tenant-scoped with RLS on app.current_tenant like V1; every
-- store query also predicates tenant_id explicitly, so isolation holds even
-- where a table was self-created without policies (same rule as V11).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;

-- Environment profile revisions: each save appends a revision; reads take the
-- latest. Services, journal, boundary, and resources have no backend yet, so
-- reads report them as not-reported instead of inventing values.
CREATE TABLE IF NOT EXISTS environment_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  name TEXT NOT NULL,
  dataset TEXT NULL,
  migration TEXT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE environment_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON environment_profiles;
CREATE POLICY tenant_isolation ON environment_profiles
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON environment_profiles TO app_user;

-- GitHub connections: installation metadata only, never tokens. Rows appear
-- only through an authorized installation flow (WP3-22 owns it); until then
-- the honest answer is an empty list and revocation refuses unknown ids.
CREATE TABLE IF NOT EXISTS github_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  repository TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired', 'failed')),
  webhook_state TEXT NULL,
  last_delivery_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE github_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON github_connections;
CREATE POLICY tenant_isolation ON github_connections
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON github_connections TO app_user;

-- Telemetry corpus metadata: file facts only, never file bytes or secrets.
CREATE TABLE IF NOT EXISTS telemetry_corpus (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('log', 'trace', 'metric')),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  label TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE telemetry_corpus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telemetry_corpus;
CREATE POLICY tenant_isolation ON telemetry_corpus
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON telemetry_corpus TO app_user;
