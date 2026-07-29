-- Decision log D8 (docs/08-decision-log.md).
--
-- Registration credits every new user £100,000 as a balanced pair: the user
-- wallet is credited and the house wallet is debited the same amount. So the
-- house wallet must exist before the first user registers, and there must be
-- exactly one of it for getHouseWallet() to have a deterministic answer.
--
-- The house wallet may go arbitrarily negative. There is no book to balance
-- and no real liability behind it — it exists so that virtual money is never
-- created from nothing, which is what keeps SUM(amount_minor) = 0 true across
-- the whole ledger at every point in history.

-- At most one row with kind='house'. The partial unique index is the reason
-- getHouseWallet() can select without an ORDER BY and still be deterministic.
CREATE UNIQUE INDEX wallets_house_singleton_key
  ON wallets (kind) WHERE kind = 'house';
--> statement-breakpoint

INSERT INTO wallets (kind, currency) VALUES ('house', 'GBP');
