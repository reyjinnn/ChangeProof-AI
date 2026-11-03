-- V9__distribution.sql — WP3-31 BYOK credential metadata.
--
-- Depends on V1 (tenants). One rule enforced here, not hoped for in code:
-- the table holds metadata only. There is deliberately NO key-material
-- column: values live in the secret broker and are read at call time
-- (NEG3-37). Revocation is terminal — no path sets status back to active —
-- and rotation versions only move forward.
--
-- Probe-style: additive only, safe to apply after V1 on a disposable database.

CREATE TABLE IF NOT EXISTS byok_credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  rotation_version INTEGER NOT NULL DEFAULT 1 CHECK (rotation_version >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
ALTER TABLE byok_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON byok_credentials;
CREATE POLICY tenant_isolation ON byok_credentials
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON byok_credentials TO app_user;
