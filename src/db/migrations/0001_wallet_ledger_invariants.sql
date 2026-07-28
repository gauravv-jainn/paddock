-- Ledger invariants — docs/04 §3.1 and §3.2.
--
-- These cannot be expressed in the Drizzle schema, so they live here as
-- hand-written SQL. The two triggers are what make the append-only,
-- always-balanced ledger a property of the database rather than a property of
-- the application remembering to behave.

-- 1. Append-only. UPDATE and DELETE raise unconditionally.
--    Corrections are compensating entries, never mutations.
CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (attempted %)', TG_OP;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER ledger_no_mutate
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
--> statement-breakpoint

-- 2. Every transaction balances to exactly zero.
--    DEFERRABLE INITIALLY DEFERRED is load-bearing: the check runs at COMMIT,
--    not per row. Without it the first row of any balanced pair fails, because
--    at that instant the txn sums to a non-zero amount.
CREATE OR REPLACE FUNCTION assert_txn_balanced() RETURNS trigger AS $$
DECLARE s BIGINT;
BEGIN
  SELECT SUM(amount_minor) INTO s FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF s <> 0 THEN
    RAISE EXCEPTION 'unbalanced txn % (sum=%)', NEW.txn_id, s;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER txn_must_balance
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_txn_balanced();
--> statement-breakpoint

-- 3. Balance is derived. There is no balance column.
CREATE VIEW wallet_balances AS
SELECT wallet_id, SUM(amount_minor) AS balance_minor
FROM ledger_entries GROUP BY wallet_id;
