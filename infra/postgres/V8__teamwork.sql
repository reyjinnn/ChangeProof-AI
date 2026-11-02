-- V8__teamwork.sql — WP3-30 support tickets, access grants, operator actions,
-- discussion threads, and sharing.
--
-- Depends on V1 (tenants, memberships, projects, repository_grants, app_user),
-- V3 (job_leases, for fenced operator actions), and V6 (lifecycle_runs, for
-- run-linked threads and access scope). Tenant tables carry RLS on
-- app.current_tenant; operator_incidents is platform-wide by design (status
-- without customer source) and carries no tenant column.
--
-- Durability rules enforced here, not hoped for in code:
-- - support_grants: one row per approval — a request is never itself a grant
--   (NEG3-34); expiry and revocation are checked at every use.
-- - support_access_log: append-only (no UPDATE/DELETE grant for app_user) —
--   every support-scoped read leaves a row.
-- - operator_actions: UNIQUE (target_job_id, action_id) with the fenced lease
--   epoch recorded — a stale operator action cannot double-apply.
-- - comments: versioned with comment_history — edits keep prior bodies;
--   candidate revisions mark rows outdated, never move them (NEG3-35).
-- - shares: UNIQUE (thread_id, shared_with) — sharing is idempotent and
--   explicitly revocable.
--
-- Probe-style: additive only, safe to apply after V1 on a disposable database.

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  reporter_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bug', 'question', 'incident', 'access')),
  summary TEXT NOT NULL,
  context TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'resolved', 'closed')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON support_tickets;
CREATE POLICY tenant_isolation ON support_tickets
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON support_tickets TO app_user;

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  requester_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('run', 'project', 'repository', 'evidence')),
  resource_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON access_requests;
CREATE POLICY tenant_isolation ON access_requests
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON access_requests TO app_user;

CREATE TABLE IF NOT EXISTS support_grants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES access_requests (id),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE support_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON support_grants;
CREATE POLICY tenant_isolation ON support_grants
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON support_grants TO app_user;

CREATE TABLE IF NOT EXISTS support_access_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  user_id TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES support_grants (id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE support_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON support_access_log;
CREATE POLICY tenant_isolation ON support_access_log
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON support_access_log TO app_user;

CREATE TABLE IF NOT EXISTS operator_incidents (
  id TEXT PRIMARY KEY,
  component TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'mitigating', 'resolved')),
  summary TEXT NOT NULL,
  queue_impact TEXT,
  model_impact TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON operator_incidents TO app_user;

CREATE TABLE IF NOT EXISTS operator_actions (
  action_id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants (id),
  target_job_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('drain', 'quarantine', 'inspect')),
  lease_epoch INTEGER NOT NULL,
  reason TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (target_job_id, action_id)
);
ALTER TABLE operator_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON operator_actions;
CREATE POLICY tenant_isolation ON operator_actions
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON operator_actions TO app_user;

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  run_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  candidate_digest TEXT NOT NULL,
  artifact_ref TEXT,
  diff_location TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('internal', 'reviewer')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  audience_history JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON threads;
CREATE POLICY tenant_isolation ON threads
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON threads TO app_user;

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads (id),
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  outdated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  edited_at TIMESTAMPTZ
);
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON comments;
CREATE POLICY tenant_isolation ON comments
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON comments TO app_user;

CREATE TABLE IF NOT EXISTS comment_history (
  comment_id TEXT NOT NULL REFERENCES comments (id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (comment_id, version)
);
ALTER TABLE comment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON comment_history;
CREATE POLICY tenant_isolation ON comment_history
  USING (
    comment_id IN (SELECT id FROM comments WHERE tenant_id = current_setting('app.current_tenant', true))
  )
  WITH CHECK (
    comment_id IN (SELECT id FROM comments WHERE tenant_id = current_setting('app.current_tenant', true))
  );
GRANT SELECT, INSERT ON comment_history TO app_user;

CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads (id),
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  shared_with TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (thread_id, shared_with)
);
ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shares;
CREATE POLICY tenant_isolation ON shares
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON shares TO app_user;
GRANT USAGE, SELECT ON SEQUENCE support_access_log_id_seq TO app_user;
