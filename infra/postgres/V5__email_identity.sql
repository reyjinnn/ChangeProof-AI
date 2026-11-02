-- V5__email_identity.sql — WP3-28 email users, single-use challenges, rate limits.
--
-- Depends on V1 (tenants, memberships, app_user) and V2 (sessions fns). Email
-- identities are pre-tenant, so tenant RLS does not fit: all tables below
-- revoke direct access from app_user, and every read/write goes through an
-- exact-match SECURITY DEFINER function (the V2 pre-auth pattern). A
-- confused-deputy query can never dump users, hashes, or challenge rows.
--
-- Single-use is atomic in consume_email_challenge: the UPDATE matches only an
-- unused, unexpired row of the expected purpose, so a replayed token fails
-- even under concurrency. Unknown/used/expired/wrong-purpose tokens share one
-- error message — the token is no existence oracle.
--
-- Probe-style: additive only, safe to apply after V1+V2 on a disposable database.
-- The hosted migrator records applied versions in its own ledger.

-- Email users: only the scrypt hash persists, never the password.
CREATE TABLE IF NOT EXISTS email_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  verified_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL
);
REVOKE ALL ON email_users FROM PUBLIC, app_user;

-- Single-use challenges: only the token hash persists, never the token.
CREATE TABLE IF NOT EXISTS email_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES email_users (id),
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'claim_organization')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL
);
REVOKE ALL ON email_challenges FROM PUBLIC, app_user;

-- Rate-limit attempts keyed by user id or a hashed email for unknown users.
CREATE TABLE IF NOT EXISTS email_send_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_key TEXT NOT NULL,
  action TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL
);
REVOKE ALL ON email_send_attempts FROM PUBLIC, app_user;
CREATE INDEX IF NOT EXISTS email_attempts_window ON email_send_attempts (attempt_key, action, attempted_at);
CREATE INDEX IF NOT EXISTS email_attempts_prune ON email_send_attempts (attempted_at);

-- Registration with duplicate mapping (a race surfaces as duplicate_email).
CREATE OR REPLACE FUNCTION register_email_user(p_id TEXT, p_email TEXT, p_hash TEXT, p_now TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO email_users (id, email, password_hash, verified_at, created_at)
    VALUES (p_id, p_email, p_hash, NULL, p_now);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_email' USING ERRCODE = 'P0001';
  END;
END;
$$;

-- Exact-email lookup for login/registration (pre-auth by necessity).
CREATE OR REPLACE FUNCTION lookup_email_user(p_email TEXT)
RETURNS SETOF email_users
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT * FROM email_users WHERE email = p_email;
$$;

CREATE OR REPLACE FUNCTION verify_email_user(p_user TEXT, p_now TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE email_users SET verified_at = p_now WHERE id = p_user AND verified_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_email_user' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION set_password_hash(p_user TEXT, p_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE email_users SET password_hash = p_hash WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_email_user' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION store_email_challenge(
  p_hash TEXT, p_user TEXT, p_purpose TEXT, p_expires TIMESTAMPTZ, p_now TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO email_challenges (token_hash, user_id, purpose, expires_at, used_at, created_at)
  VALUES (p_hash, p_user, p_purpose, p_expires, NULL, p_now);
END;
$$;

-- Atomic single-use consume: exactly one caller wins; every other outcome is
-- one indistinguishable error (unknown, used, expired, or wrong purpose).
CREATE OR REPLACE FUNCTION consume_email_challenge(p_hash TEXT, p_purpose TEXT, p_now TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner TEXT;
BEGIN
  UPDATE email_challenges SET used_at = p_now
  WHERE token_hash = p_hash AND used_at IS NULL AND expires_at > p_now AND purpose = p_purpose
  RETURNING user_id INTO owner;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_challenge' USING ERRCODE = 'P0001';
  END IF;
  RETURN owner;
END;
$$;

-- Exact per-key rate limit: an advisory transaction lock serializes
-- concurrent checks for the same key, so racing callers cannot all pass.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT, p_action TEXT, p_max INTEGER, p_window_ms BIGINT, p_now TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recent INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_key || '|' || p_action));
  DELETE FROM email_send_attempts WHERE attempted_at < p_now - (p_window_ms || ' milliseconds')::interval;
  SELECT COUNT(*) INTO recent FROM email_send_attempts
  WHERE attempt_key = p_key AND action = p_action
    AND attempted_at > p_now - (p_window_ms || ' milliseconds')::interval;
  IF recent >= p_max THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO email_send_attempts (attempt_key, action, attempted_at) VALUES (p_key, p_action, p_now);
END;
$$;

-- Exact-user tenant listing for login (a user may own several tenants).
CREATE OR REPLACE FUNCTION list_user_tenants(p_user TEXT)
RETURNS SETOF TEXT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT tenant_id FROM memberships WHERE user_id = p_user ORDER BY tenant_id;
$$;

-- Exact-user session listing (id, tenant, issued, expires, revoked).
CREATE OR REPLACE FUNCTION list_user_sessions(p_user TEXT)
RETURNS TABLE (id TEXT, tenant_id TEXT, issued_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT id, tenant_id, issued_at, expires_at, revoked_at FROM sessions WHERE user_id = p_user ORDER BY issued_at;
$$;

-- Onboarding: consume a claim ticket and create the tenant + owner membership
-- atomically. The ticket alone is authority (it was issued in-band to the
-- verified address); replay, expiry, and wrong purpose share one error.
CREATE OR REPLACE FUNCTION claim_tenant_with_ticket(p_tenant TEXT, p_hash TEXT, p_now TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner TEXT;
BEGIN
  IF p_tenant IS NULL OR btrim(p_tenant) = '' THEN
    RAISE EXCEPTION 'invalid_tenant' USING ERRCODE = 'P0001';
  END IF;
  UPDATE email_challenges SET used_at = p_now
  WHERE token_hash = p_hash AND used_at IS NULL AND expires_at > p_now AND purpose = 'claim_organization'
  RETURNING user_id INTO owner;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_challenge' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO tenants (id) VALUES (p_tenant);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_tenant' USING ERRCODE = 'P0001';
  END;
  INSERT INTO memberships (tenant_id, user_id, role, grant_version) VALUES (p_tenant, owner, 'owner', 0);
  RETURN owner;
END;
$$;

GRANT EXECUTE ON FUNCTION register_email_user(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO app_user;
GRANT EXECUTE ON FUNCTION lookup_email_user(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION verify_email_user(TEXT, TIMESTAMPTZ) TO app_user;
GRANT EXECUTE ON FUNCTION set_password_hash(TEXT, TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION store_email_challenge(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;
GRANT EXECUTE ON FUNCTION consume_email_challenge(TEXT, TEXT, TIMESTAMPTZ) TO app_user;
GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, TEXT, INTEGER, BIGINT, TIMESTAMPTZ) TO app_user;
GRANT EXECUTE ON FUNCTION list_user_tenants(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION list_user_sessions(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION claim_tenant_with_ticket(TEXT, TEXT, TIMESTAMPTZ) TO app_user;
