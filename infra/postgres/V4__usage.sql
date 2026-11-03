-- V4__usage.sql — WP3-24 atomic reservations, append-only ledger, settlement.
--
-- Depends on V1 (tenants, app_user) and V2 (is_tenant_fenced). All tables are
-- tenant-scoped with RLS on app.current_tenant like V1; the store binds the
-- tenant with SET LOCAL inside a transaction and uses bound parameters only.
--
-- Accounting rules enforced here, not hoped for in code:
-- - entitlements: one current row per tenant (superseded_at IS NULL); the
--   store locks it FOR UPDATE so concurrent admissions serialize instead of
--   racing past the cap. There is deliberately no default cap: admission
--   without an operator-set entitlement fails closed.
-- - reservations: one row per admitted reservation; consume/release/settle
--   lock it FOR UPDATE so racing burns cannot overspend the hold.
-- - usage_ledger: effect_id is globally unique (a retried event returns the
--   stored outcome, never a second debit) and the application role has NO
--   UPDATE/DELETE grant — cumulative consumption is append-only and cannot
--   move backwards by retry, resume, cancel, or rollover.
--
-- Probe-style: additive only, safe to apply after V1+V2 on a disposable database.
-- The hosted migrator records applied versions in its own ledger.

-- Operator-set versioned entitlements; exactly one current row per tenant.
CREATE TABLE IF NOT EXISTS entitlements (
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  period_id TEXT NOT NULL,
  cap_amount DOUBLE PRECISION NOT NULL CHECK (cap_amount >= 0),
  rate_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  superseded_at TIMESTAMPTZ NULL,
  PRIMARY KEY (tenant_id, period_id)
);
ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON entitlements;
CREATE POLICY tenant_isolation ON entitlements
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON entitlements TO app_user;
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_current_unique
  ON entitlements (tenant_id) WHERE superseded_at IS NULL;

-- Admitted reservation holds; closed by release (cancel) or settle only.
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  run_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'settled', 'released')),
  created_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NULL
);
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reservations;
CREATE POLICY tenant_isolation ON reservations
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON reservations TO app_user;
CREATE INDEX IF NOT EXISTS reservations_active_hold ON reservations (tenant_id, state);

-- Append-only idempotent usage events (UsageLedgerEntry contract).
CREATE TABLE IF NOT EXISTS usage_ledger (
  effect_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  run_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL REFERENCES reservations (id),
  provider TEXT NOT NULL,
  measured_units DOUBLE PRECISION NOT NULL CHECK (measured_units >= 0),
  unit_name TEXT NOT NULL,
  rate_version TEXT NOT NULL,
  period_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('reserve', 'consume', 'settle', 'reverse', 'release')),
  consumed_amount DOUBLE PRECISION NOT NULL CHECK (consumed_amount >= 0),
  reserved_amount DOUBLE PRECISION NOT NULL CHECK (reserved_amount >= 0),
  provider_receipt_ref TEXT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON usage_ledger;
CREATE POLICY tenant_isolation ON usage_ledger
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
-- Append-only: no UPDATE, no DELETE. History never moves backwards.
GRANT SELECT, INSERT ON usage_ledger TO app_user;
CREATE INDEX IF NOT EXISTS usage_ledger_reservation_order
  ON usage_ledger (reservation_id, occurred_at DESC, effect_id DESC);
