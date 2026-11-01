-- sc3-baseline schema: minimal order workflow (fixture, not product authority).
-- Applied by tests/native/fixture-baseline.test.ts on a disposable database.
CREATE TABLE IF NOT EXISTS sc3_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('created', 'fulfilled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DELETE FROM sc3_orders;
