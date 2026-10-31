-- V1__identity_tenancy.sql — WP3-21 tenancy tables with row-level security.
--
-- Reviewed, versioned migration source. The hosted supervisor applies it with
-- a trusted migrator (expand/contract while old+new hosts overlap); application
-- code never runs DDL. Every row carries its owning tenant, and every policy
-- reads the per-connection `app.current_tenant` setting. When the setting is
-- absent the comparison yields NULL and no row is visible (fail closed).
-- Tables are owned by the migrator role; the application role `app_user` has
-- NOBYPASSRLS so policies apply to every application query, including pooled
-- connections. Pool checkout MUST `SET app.current_tenant` and release MUST
-- `RESET app.current_tenant` — proven by `tests/native/identity-rls.test.ts`.

-- Idempotent for disposable probe databases; the hosted migrator records
-- applied versions in its own ledger and never replays V1 on hosted data.
DROP TABLE IF EXISTS repository_grants;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS tenants;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY
);

CREATE TABLE memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer', 'operator')),
  grant_version INTEGER NOT NULL DEFAULT 0 CHECK (grant_version >= 0),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id)
);

CREATE TABLE repository_grants (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  repository_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects (id),
  PRIMARY KEY (tenant_id, repository_id)
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE repository_grants ENABLE ROW LEVEL SECURITY;

-- One policy per table: a row is visible only to its own tenant connection.
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.current_tenant', true));
CREATE POLICY tenant_isolation ON memberships
  USING (tenant_id = current_setting('app.current_tenant', true));
CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = current_setting('app.current_tenant', true));
CREATE POLICY tenant_isolation ON repository_grants
  USING (tenant_id = current_setting('app.current_tenant', true));

-- Application role: least privilege, cannot bypass RLS, cannot run DDL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOBYPASSRLS LOGIN PASSWORD 'app-probe-only';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON repository_grants TO app_user;
