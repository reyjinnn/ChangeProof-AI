-- V7__engagement.sql — WP3-29 notifications and query support tables.
--
-- Depends on V1 (tenants, memberships, projects, repository_grants, app_user).
-- All tables are tenant-scoped with RLS on app.current_tenant; the stores bind
-- the tenant with SET LOCAL inside a transaction and use bound parameters only.
--
-- Durability rules enforced here, not hoped for in code:
-- - notifications: UNIQUE (tenant_id, event_id) — an at-least-once business
--   event creates at most one notification (NEG3-31); recipient rows carry the
--   project/repo/run linkage so lost grants exclude them at read time.
-- - notification_outbox: UNIQUE (tenant_id, event_id) — the notification row
--   and its outbox row commit atomically; channel workers claim by (state,
--   attempts) with a bounded retry cap.
-- - tenant_grant_epochs: one row per tenant, bumped whenever repository grants
--   change; query-cache keys bind (user, grant version, epoch) so a revoked
--   grant can never serve a stale cached hit (NEG3-32).
--
-- Probe-style: additive only, safe to apply after V1 on a disposable database.
--
-- Project search hits carry their creation time; the lifecycle store writes it
-- explicitly from injected time on every insert below.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('results', 'blockers', 'access', 'quota', 'cleanup')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deep_link TEXT,
  run_id TEXT,
  project_id TEXT,
  repository_id TEXT,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, event_id)
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notifications;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON notifications TO app_user;

CREATE TABLE IF NOT EXISTS notification_outbox (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  event_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in-app',
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, event_id)
);
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_outbox;
CREATE POLICY tenant_isolation ON notification_outbox
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON notification_outbox TO app_user;

CREATE TABLE IF NOT EXISTS notification_preferences (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  user_id TEXT NOT NULL,
  categories JSONB NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_preferences;
CREATE POLICY tenant_isolation ON notification_preferences
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO app_user;

CREATE TABLE IF NOT EXISTS tenant_grant_epochs (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants (id),
  epoch INTEGER NOT NULL DEFAULT 0 CHECK (epoch >= 0)
);
ALTER TABLE tenant_grant_epochs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_grant_epochs;
CREATE POLICY tenant_isolation ON tenant_grant_epochs
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON tenant_grant_epochs TO app_user;
