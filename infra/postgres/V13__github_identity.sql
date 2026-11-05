-- V13__github_identity.sql — WP3-22/WP3-28 GitHub sign-in identities and links.
--
-- Depends on V1 (tenants, memberships) and V5 (email_users, list_user_tenants).
-- GitHub identities are pre-tenant like email users, so the same pattern
-- applies: no direct table access for app_user, every read/write through an
-- exact-match SECURITY DEFINER function with bound parameters.
--
-- Linking rule (FR3-38): a verified GitHub email that matches an existing
-- password account does NOT auto-link. The application checks the link
-- first, then refuses the collision with a link path — this migration only
-- stores links the application explicitly made. GitHub-only accounts carry
-- an unusable password marker (never a real hash) in email_users.
--
-- Probe-style: additive only, safe to apply after V1+V2+V5 on a disposable
-- database. The hosted migrator records applied versions in its own ledger.

-- GitHub user id -> local user. The numeric provider id is the link key;
-- the login is display only (logins can be renamed on GitHub).
CREATE TABLE IF NOT EXISTS github_identities (
  github_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES email_users (id),
  login TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL
);
REVOKE ALL ON github_identities FROM PUBLIC, app_user;

-- Exact-id link lookup for the OAuth callback (pre-auth by necessity).
CREATE OR REPLACE FUNCTION lookup_github_link(p_github_id TEXT)
RETURNS TABLE (user_id TEXT, login TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT user_id, login FROM github_identities WHERE github_id = p_github_id;
$$;

-- Exact-user link listing for the Account page (server-derived user only).
CREATE OR REPLACE FUNCTION list_github_links(p_user TEXT)
RETURNS TABLE (github_id TEXT, login TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT github_id, login FROM github_identities WHERE user_id = p_user ORDER BY github_id;
$$;

-- Register a verified GitHub profile: email user (verified immediately —
-- GitHub proved the address), identity link, personal tenant, owner
-- membership — atomically. Each insert maps its own collision so the
-- caller can distinguish email/link/tenant races.
CREATE OR REPLACE FUNCTION register_github_user(
  p_user TEXT, p_email TEXT, p_hash TEXT, p_github_id TEXT, p_login TEXT, p_tenant TEXT, p_now TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO email_users (id, email, password_hash, verified_at, created_at)
    VALUES (p_user, p_email, p_hash, p_now, p_now);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_email' USING ERRCODE = 'P0001';
  END;
  BEGIN
    INSERT INTO github_identities (github_id, user_id, login, linked_at)
    VALUES (p_github_id, p_user, p_login, p_now);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_github' USING ERRCODE = 'P0001';
  END;
  BEGIN
    INSERT INTO tenants (id) VALUES (p_tenant);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_tenant' USING ERRCODE = 'P0001';
  END;
  INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES (p_tenant, p_user, 'owner', 0);
END;
$$;

-- Link an additional GitHub identity to an authenticated user. The caller
-- authenticated both sides (session at start, GitHub profile at callback).
CREATE OR REPLACE FUNCTION link_github_identity(
  p_user TEXT, p_github_id TEXT, p_login TEXT, p_now TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM email_users WHERE id = p_user) THEN
    RAISE EXCEPTION 'unknown_email_user' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO github_identities (github_id, user_id, login, linked_at)
    VALUES (p_github_id, p_user, p_login, p_now);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_github' USING ERRCODE = 'P0001';
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_github_link(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION list_github_links(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION register_github_user(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO app_user;
GRANT EXECUTE ON FUNCTION link_github_identity(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO app_user;
