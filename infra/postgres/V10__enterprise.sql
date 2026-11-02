-- V10__enterprise.sql — WP3-32 SAML/SCIM bindings and provider event dedup.
--
-- Depends on V1 (tenants, memberships). Rules enforced here:
-- - memberships.status suspends every grant derivation: deriveContext refuses
--   suspended members, so SCIM deprovision holds sessions, queued work, and
--   publication that re-check current grants (NEG3-38). Additive column only;
--   existing rows stay active.
-- - saml_assertions_used has a composite key: the same assertion id can never
--   authenticate twice, even across retries (NEG3-38 replay).
-- - scim_tokens stores hashes only; the bearer value is returned once at
--   creation and never persisted (FR3-44).
-- - scim_events is unique per (tenant, external id, version): a retried push
--   lands once, and older versions never overwrite newer ones (NEG3-38).
-- - provider_events is unique per (provider, event uuid): duplicate webhook
--   deliveries reconcile once (NEG3-39).
--
-- Probe-style: additive only, safe to apply after V1 on a disposable database.

ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended'));

CREATE TABLE IF NOT EXISTS saml_connections (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants (id),
  entity_id TEXT NOT NULL,
  idp_issuer TEXT NOT NULL,
  audience TEXT NOT NULL,
  acs_url TEXT NOT NULL,
  cert_pem TEXT NOT NULL,
  cert_fingerprint TEXT NOT NULL CHECK (cert_fingerprint ~ '^[0-9a-f]{64}$'),
  verified_domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE saml_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON saml_connections;
CREATE POLICY tenant_isolation ON saml_connections
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON saml_connections TO app_user;

CREATE TABLE IF NOT EXISTS saml_subject_links (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, subject)
);
ALTER TABLE saml_subject_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON saml_subject_links;
CREATE POLICY tenant_isolation ON saml_subject_links
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON saml_subject_links TO app_user;

CREATE TABLE IF NOT EXISTS saml_assertions_used (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  assertion_id TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, assertion_id)
);
ALTER TABLE saml_assertions_used ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON saml_assertions_used;
CREATE POLICY tenant_isolation ON saml_assertions_used
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON saml_assertions_used TO app_user;

CREATE TABLE IF NOT EXISTS scim_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  token_hash TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
ALTER TABLE scim_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scim_tokens;
CREATE POLICY tenant_isolation ON scim_tokens
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON scim_tokens TO app_user;

CREATE OR REPLACE FUNCTION lookup_scim_token(p_hash TEXT)
RETURNS SETOF scim_tokens
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT * FROM scim_tokens WHERE token_hash = p_hash AND status = 'active' $$;

GRANT EXECUTE ON FUNCTION lookup_scim_token(TEXT) TO app_user;

CREATE TABLE IF NOT EXISTS scim_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  external_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('provision', 'update', 'disable')),
  version INTEGER NOT NULL CHECK (version >= 1),
  email TEXT,
  groups JSONB NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'duplicate', 'superseded', 'refused')),
  applied_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, external_id, version)
);
ALTER TABLE scim_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scim_events;
CREATE POLICY tenant_isolation ON scim_events
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON scim_events TO app_user;

CREATE TABLE IF NOT EXISTS provider_events (
  provider TEXT NOT NULL CHECK (provider IN ('github', 'gitlab', 'bitbucket')),
  event_uuid TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  verified BOOLEAN NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('reconciled', 'duplicate', 'trigger_only')),
  received_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (provider, event_uuid)
);
ALTER TABLE provider_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON provider_events;
CREATE POLICY tenant_isolation ON provider_events
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON provider_events TO app_user;
