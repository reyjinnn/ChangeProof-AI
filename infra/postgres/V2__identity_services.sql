-- V2__identity_services.sql — WP3-21 session/grant/invite/lifecycle services.
--
-- Extends V1 (tenants/memberships/projects/repository_grants, all RLS-scoped).
-- Pre-auth objects (sessions, invitations, tombstones) are reachable only by
-- exact match through SECURITY DEFINER functions: the application role has no
-- direct table access to them, so a confused-deputy query can never dump them.
-- Tenant-scoped objects (lifecycle_records) use RLS on app.current_tenant like V1.
-- The store sets the tenant with SET LOCAL inside a transaction (auto-reset,
-- no pool leak possible) and calls the functions below with bound parameters.
--
-- Probe-style: additive only, safe to apply after V1 on a disposable database.
-- The hosted migrator records applied versions in its own ledger.

-- Sessions: opaque 256-bit ids, exact-match lookup only (pre-auth: the server
-- must find the session before it knows the tenant).
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  user_id TEXT NOT NULL,
  grant_version_at_issue INTEGER NOT NULL CHECK (grant_version_at_issue >= 0),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL
);
REVOKE ALL ON sessions FROM PUBLIC, app_user;

-- Invitations: single-use, expiring; only the token hash is stored, never the token.
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer', 'operator')),
  invited_by TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NULL,
  accepted_user TEXT NULL,
  revoked_at TIMESTAMPTZ NULL
);
REVOKE ALL ON invitations FROM PUBLIC, app_user;

-- Deletion fence: a tombstoned tenant admits nothing new (AGENTS.md §10).
CREATE TABLE IF NOT EXISTS tenant_tombstones (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants (id),
  reason TEXT NOT NULL,
  fenced_at TIMESTAMPTZ NOT NULL,
  deleted_by TEXT NOT NULL
);
REVOKE ALL ON tenant_tombstones FROM PUBLIC, app_user;

-- Retention/deletion state per artifact (DataLifecycleRecord).
CREATE TABLE IF NOT EXISTS lifecycle_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  artifact_id TEXT NOT NULL,
  retention_version TEXT NOT NULL,
  categories TEXT[] NOT NULL,
  locations TEXT[] NOT NULL,
  fence_id TEXT NULL,
  tombstone_id TEXT NULL,
  purge_progress TEXT NOT NULL CHECK (purge_progress IN ('not_started', 'in_progress', 'complete', 'failed')),
  backup_expiry TIMESTAMPTZ NULL,
  audit_minimum_until TIMESTAMPTZ NULL,
  completion_evidence_refs TEXT[] NOT NULL DEFAULT '{}'
);
ALTER TABLE lifecycle_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lifecycle_records;
CREATE POLICY tenant_isolation ON lifecycle_records
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON lifecycle_records TO app_user;

-- Tenant creation with the empty-identity guard (T-14 forward constraint:
-- '' must never become a tenant id, or '' tenant context stops failing closed).
CREATE OR REPLACE FUNCTION create_tenant(p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_id IS NULL OR btrim(p_id) = '' THEN
    RAISE EXCEPTION 'invalid_tenant' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO tenants (id) VALUES (p_id);
END;
$$;

CREATE OR REPLACE FUNCTION is_tenant_fenced(p_tenant TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM tenant_tombstones WHERE tenant_id = p_tenant) $$;

-- One row per lookup, or nothing. No listing, no wildcard.
CREATE OR REPLACE FUNCTION lookup_session(p_id TEXT)
RETURNS sessions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT * FROM sessions WHERE id = p_id $$;

CREATE OR REPLACE FUNCTION create_session(
  p_id TEXT, p_tenant TEXT, p_user TEXT, p_issued TIMESTAMPTZ, p_expires TIMESTAMPTZ
) RETURNS sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  membership memberships%ROWTYPE;
  tombstone tenant_tombstones%ROWTYPE;
  created sessions%ROWTYPE;
BEGIN
  SELECT * INTO tombstone FROM tenant_tombstones WHERE tenant_id = p_tenant;
  IF FOUND THEN
    RAISE EXCEPTION 'tenant_fenced' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO membership FROM memberships WHERE tenant_id = p_tenant AND user_id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_membership' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO sessions (id, tenant_id, user_id, grant_version_at_issue, issued_at, expires_at)
  VALUES (p_id, p_tenant, p_user, membership.grant_version, p_issued, p_expires)
  RETURNING * INTO created;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_session(p_id TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ UPDATE sessions SET revoked_at = now() WHERE id = p_id AND revoked_at IS NULL $$;

CREATE OR REPLACE FUNCTION revoke_user_sessions(p_tenant TEXT, p_user TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ UPDATE sessions SET revoked_at = now()
   WHERE tenant_id = p_tenant AND user_id = p_user AND revoked_at IS NULL $$;

CREATE OR REPLACE FUNCTION create_invitation(
  p_id TEXT, p_tenant TEXT, p_role TEXT, p_by TEXT, p_hash TEXT,
  p_issued TIMESTAMPTZ, p_expires TIMESTAMPTZ
) RETURNS invitations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inviter memberships%ROWTYPE;
  tombstone tenant_tombstones%ROWTYPE;
  created invitations%ROWTYPE;
BEGIN
  SELECT * INTO tombstone FROM tenant_tombstones WHERE tenant_id = p_tenant;
  IF FOUND THEN
    RAISE EXCEPTION 'tenant_fenced' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO inviter FROM memberships WHERE tenant_id = p_tenant AND user_id = p_by;
  IF NOT FOUND OR (inviter.role NOT IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'invite_not_authorized' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO invitations (id, tenant_id, role, invited_by, token_hash, issued_at, expires_at)
  VALUES (p_id, p_tenant, p_role, p_by, p_hash, p_issued, p_expires)
  RETURNING * INTO created;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION lookup_invitation(p_hash TEXT)
RETURNS invitations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT * FROM invitations WHERE token_hash = p_hash $$;

-- Atomic single-use accept: exactly one caller wins; replay loses the CAS.
CREATE OR REPLACE FUNCTION accept_invitation(p_hash TEXT, p_user TEXT, p_now TIMESTAMPTZ)
RETURNS memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  invite invitations%ROWTYPE;
  existing memberships%ROWTYPE;
  created memberships%ROWTYPE;
BEGIN
  SELECT * INTO invite FROM invitations WHERE token_hash = p_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_invitation' USING ERRCODE = 'P0001';
  END IF;
  IF invite.accepted_at IS NOT NULL OR invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation_spent' USING ERRCODE = 'P0001';
  END IF;
  IF invite.expires_at <= p_now THEN
    RAISE EXCEPTION 'invitation_expired' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM tenant_tombstones WHERE tenant_id = invite.tenant_id;
  IF FOUND THEN
    RAISE EXCEPTION 'tenant_fenced' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO existing FROM memberships
  WHERE tenant_id = invite.tenant_id AND user_id = p_user;
  IF FOUND THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE = 'P0001';
  END IF;
  UPDATE invitations
  SET accepted_at = p_now, accepted_user = p_user
  WHERE token_hash = p_hash AND accepted_at IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_spent' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO memberships (tenant_id, user_id, role, grant_version)
  VALUES (invite.tenant_id, p_user, invite.role, 0)
  RETURNING * INTO created;
  RETURN created;
END;
$$;

-- Atomic tenant deletion fence: tombstone + session revocation + lifecycle seed.
CREATE OR REPLACE FUNCTION fence_tenant(
  p_tenant TEXT, p_by TEXT, p_reason TEXT, p_now TIMESTAMPTZ, p_lifecycle_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor memberships%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM memberships WHERE tenant_id = p_tenant AND user_id = p_by;
  IF NOT FOUND OR actor.role <> 'owner' THEN
    RAISE EXCEPTION 'delete_not_authorized' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO tenant_tombstones (tenant_id, reason, fenced_at, deleted_by)
  VALUES (p_tenant, p_reason, p_now, p_by)
  ON CONFLICT (tenant_id) DO NOTHING;
  UPDATE sessions SET revoked_at = p_now
  WHERE tenant_id = p_tenant AND revoked_at IS NULL;
  INSERT INTO lifecycle_records
    (id, tenant_id, artifact_id, retention_version, categories, locations,
     tombstone_id, purge_progress)
  VALUES (p_lifecycle_id, p_tenant, p_tenant, 'tenant-deletion-v1',
          ARRAY['tenant-data'], ARRAY['postgres'], p_tenant, 'not_started')
  ON CONFLICT (id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION create_tenant(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION is_tenant_fenced(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION lookup_session(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION create_session(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;
GRANT EXECUTE ON FUNCTION revoke_session(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION revoke_user_sessions(TEXT, TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION create_invitation(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;
GRANT EXECUTE ON FUNCTION lookup_invitation(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION accept_invitation(TEXT, TEXT, TIMESTAMPTZ) TO app_user;
GRANT EXECUTE ON FUNCTION fence_tenant(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO app_user;
