# 04 — Database Design

**Status:** Complete for Phase 0–1.
**Engine:** PostgreSQL 16.

> **Amended by `docs/08-decision-log.md`**, which is binding where it conflicts.
> The amendments are marked inline below: D1 (§3, GBP pence), D3 (§4,
> `is_handicap`), D4 (§4, `actual_runners`), D5 and D6 (§4, `horses`),
> D8 (§3, house wallet), D10 (§5 is Phase 1).

---

## 1. Non-negotiable rules

1. **Money is `BIGINT` minor units — GBP pence** (`docs/08` D1). Never `FLOAT`, never `REAL`, never `DOUBLE PRECISION`. `NUMERIC` only for odds and ratios.
2. **Balances are derived from the ledger.** No mutable `balance` column anywhere in Phase 0–1.
3. **The ledger is append-only.** No `UPDATE`, no `DELETE`. Corrections are compensating entries. Enforced by a `BEFORE UPDATE OR DELETE` trigger that raises.
4. **Raw provider payloads are persisted verbatim with a content hash** before normalisation. Determinism depends on this.
5. **All timestamps are `TIMESTAMPTZ`.** Racing spans time zones and DST transitions; naive timestamps will cause a wrong-day bug within the first year.

---

## 2. Identity

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT UNIQUE NOT NULL,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  display_name    TEXT NOT NULL,
  handle          CITEXT UNIQUE NOT NULL,
  password_hash   TEXT,                          -- NULL for OAuth-only
  role            TEXT NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user','admin')),
  base_currency   CHAR(3) NOT NULL DEFAULT 'GBP',  -- D1: display only, read by nothing in Phase 0
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','deleted')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE oauth_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,                    -- 'google' | 'apple'
  provider_uid  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,             -- store the hash, never the token
  user_agent    TEXT,
  ip_hash       TEXT,                             -- hashed; do not store raw IPs
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions (user_id, expires_at DESC);
```

---

## 3. Ledger — the core of the system

Double-entry. Every economic event writes ≥2 rows summing to exactly zero.

```sql
CREATE TABLE wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('user','house','void_pool')),
  currency    CHAR(3) NOT NULL DEFAULT 'GBP',     -- D1: accounting currency, always GBP
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_wallet_requires_user
    CHECK ((kind = 'user') = (user_id IS NOT NULL))
);
CREATE UNIQUE INDEX ON wallets (user_id) WHERE kind = 'user';
-- D8: exactly one house wallet, seeded by migration. It is the counterparty to
-- every user credit and may go arbitrarily negative.
CREATE UNIQUE INDEX ON wallets (kind) WHERE kind = 'house';

CREATE TABLE ledger_entries (
  id            BIGSERIAL PRIMARY KEY,
  txn_id        UUID NOT NULL,                    -- groups the balanced set
  wallet_id     UUID NOT NULL REFERENCES wallets(id),
  amount_minor  BIGINT NOT NULL,                  -- signed; + credit, - debit
  entry_type    TEXT NOT NULL CHECK (entry_type IN (
                   'OPENING_BALANCE','STAKE','RETURN','REFUND',
                   'REVERSAL','ADJUSTMENT','BANKROLL_RESET')),
  ref_type      TEXT,                             -- 'bet' | 'settlement' | 'admin'
  ref_id        UUID,
  memo          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT amount_nonzero CHECK (amount_minor <> 0)
);

CREATE INDEX ON ledger_entries (wallet_id, created_at DESC);
CREATE INDEX ON ledger_entries (txn_id);
CREATE INDEX ON ledger_entries (ref_type, ref_id);
```

### 3.1 Enforced invariants

```sql
-- Append-only
CREATE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (attempted %)', TG_OP;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_mutate
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Every transaction balances. Checked at COMMIT, not per row.
CREATE FUNCTION assert_txn_balanced() RETURNS trigger AS $$
DECLARE s BIGINT;
BEGIN
  SELECT SUM(amount_minor) INTO s FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF s <> 0 THEN
    RAISE EXCEPTION 'unbalanced txn % (sum=%)', NEW.txn_id, s;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER txn_must_balance
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_txn_balanced();
```

The deferred constraint trigger is the important detail: it permits the multi-row insert within a transaction and validates at `COMMIT`. Without `DEFERRABLE INITIALLY DEFERRED`, the first row of any balanced pair fails.

**This design makes it structurally impossible to create virtual money from nothing.** Every user credit is a house debit. A daily reconciliation job asserting `SUM(amount_minor) = 0` across all wallets is a two-line query that catches an entire class of bug.

### 3.2 Balance

```sql
CREATE VIEW wallet_balances AS
SELECT wallet_id, SUM(amount_minor) AS balance_minor
FROM ledger_entries GROUP BY wallet_id;
```

`balance_minor` is GBP pence (D1). Every user starts at `10_000_000` — £100,000,
credited from the house wallet by `identity.register()` in the same transaction
that creates the user (D2, D8).

Sufficient to roughly 10⁶ entries per wallet. Beyond that, add a `wallet_balance_snapshots` table (checkpoint every 10,000 entries, sum forward from the last checkpoint). **Do not build this until profiling demands it.**

---

## 4. Racing catalogue

```sql
CREATE TABLE tracks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  surface      TEXT CHECK (surface IN ('turf','dirt','aw','sand','snow')),
  timezone     TEXT NOT NULL,                     -- IANA, e.g. 'Europe/London'
  UNIQUE (name, country_code)
);

CREATE TABLE horses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  -- D6: renamed from country_code. This is a breeding suffix ('IRE','USA',
  -- 'GER'), NOT a country. tracks.country_code IS a country; the two were
  -- identically named on adjacent tables and would eventually be joined.
  breeding_suffix CHAR(3),
  foaled_year     SMALLINT,
  sex             TEXT,
  sire            TEXT,
  dam             TEXT,
  -- D5: NULLS NOT DISTINCT. Two of the three key columns are nullable, and
  -- under the default NULLS DISTINCT a horse with no suffix or no foaling year
  -- would insert a duplicate row on every ingestion run.
  UNIQUE NULLS NOT DISTINCT (name, breeding_suffix, foaled_year)
);

CREATE TABLE people (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name     TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('jockey','trainer','owner')),
  UNIQUE (name, kind)
);

CREATE TABLE meetings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id    UUID NOT NULL REFERENCES tracks(id),
  date        DATE NOT NULL,
  going       TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','inprogress','completed','abandoned')),
  UNIQUE (track_id, date)
);

CREATE TABLE races (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id       UUID NOT NULL REFERENCES meetings(id),
  provider_ref     TEXT NOT NULL,
  provider_id      TEXT NOT NULL,
  name             TEXT NOT NULL,
  off_time         TIMESTAMPTZ NOT NULL,
  distance_yards   INTEGER,
  race_class       TEXT,
  race_type        TEXT CHECK (race_type IN ('flat','hurdle','chase','ntf','harness')),
  is_handicap      BOOLEAN NOT NULL,                  -- D3: NO DEFAULT. Drives each-way
                                                      -- place terms; a default would turn
                                                      -- "the feed did not say" into "no".
  age_band         TEXT,
  prize_minor      BIGINT,
  declared_runners SMALLINT,                          -- at declaration
  actual_runners   SMALLINT,                          -- after non-runners; drives place terms
  status           TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled','open','suspended','off',
                                       'result','void','abandoned','postponed')),
  result_version   INTEGER NOT NULL DEFAULT 0,        -- increments on stewards' amendment
  rule4_pence      SMALLINT NOT NULL DEFAULT 0
                     CHECK (rule4_pence BETWEEN 0 AND 90),
  -- D4: a race cannot reach 'result' without the starter count, because
  -- each-way settlement has no place-terms row to look up without it.
  CONSTRAINT races_result_requires_actual_runners
    CHECK (status <> 'result' OR actual_runners IS NOT NULL),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, provider_ref)
);
CREATE INDEX ON races (off_time);
CREATE INDEX ON races (status, off_time) WHERE status IN ('open','suspended','off');

CREATE TABLE runners (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id            UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  horse_id           UUID NOT NULL REFERENCES horses(id),
  jockey_id          UUID REFERENCES people(id),
  trainer_id         UUID REFERENCES people(id),
  cloth_number       SMALLINT NOT NULL,
  stall_draw         SMALLINT,
  weight_lb          SMALLINT,
  official_rating    SMALLINT,
  status             TEXT NOT NULL DEFAULT 'declared'
                       CHECK (status IN ('declared','non_runner','withdrawn','reserve')),
  withdrawn_at_odds  NUMERIC(10,3),               -- REQUIRED input for Rule 4
  starting_price     NUMERIC(10,3),
  finish_position    SMALLINT,
  dead_heat_count    SMALLINT NOT NULL DEFAULT 1, -- 1 = clean; 2 = two-way dead heat
  disqualified       BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (race_id, cloth_number)
);
CREATE INDEX ON runners (race_id, finish_position);
CREATE INDEX ON runners (horse_id);
```

**`is_handicap` and `actual_runners` are not decoration.** They are the two inputs that determine each-way place terms. If the provider does not supply them reliably, each-way betting cannot ship. See `05`, §4.

Both are now enforced rather than hoped for (D3, D4): `is_handicap` has no
default and must be stated on every insert, and `actual_runners` is constrained
to be present once a race has a result. The archive adapter rejects a racecard
that omits either, so the database is never the last line of defence.

---

## 5. Odds time series — **PHASE 1, NOT PHASE 0**

> **D10.** Phase 0 is historical replay; there is no live market to snapshot,
> and no Phase 0 module owns this table. Nothing in §5 is to be built during
> Phase 0. `catalog` takes ownership when a live provider arrives.

```sql
CREATE TABLE odds_snapshots (
  id            BIGSERIAL,
  runner_id     UUID NOT NULL,
  market_type   TEXT NOT NULL,
  price_decimal NUMERIC(10,3) NOT NULL,
  source        TEXT NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

-- Monthly partitions, created ahead by a scheduled job
CREATE TABLE odds_snapshots_2026_08 PARTITION OF odds_snapshots
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX ON odds_snapshots (runner_id, captured_at DESC);
```

This is the only table that grows without bound. Partition from day one, **when it is built in Phase 1** — retrofitting partitioning onto a large table is painful. Retention: keep full resolution 90 days, then downsample to open/high/low/close/SP per runner and drop the raw partition.

---

## 6. Bets

```sql
CREATE TABLE bets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  wallet_id         UUID NOT NULL REFERENCES wallets(id),
  idempotency_key   UUID NOT NULL,
  bet_type          TEXT NOT NULL CHECK (bet_type IN (
                      'WIN','PLACE','EACH_WAY','SHOW',
                      'EXACTA','QUINELLA','TRIFECTA','SUPERFECTA',
                      'DOUBLE','TREBLE','ACCUMULATOR')),
  unit_stake_minor  BIGINT NOT NULL CHECK (unit_stake_minor > 0),
  total_stake_minor BIGINT NOT NULL CHECK (total_stake_minor > 0),
  -- EACH_WAY: total = unit * 2. Accumulator: total = unit * combinations.
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                      'open','won','lost','void','partial','cancelled')),
  placed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at        TIMESTAMPTZ,
  return_minor      BIGINT NOT NULL DEFAULT 0,
  settled_version   INTEGER,                       -- races.result_version settled against
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX ON bets (user_id, placed_at DESC);
CREATE INDEX ON bets (status) WHERE status = 'open';

CREATE TABLE bet_legs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id         UUID NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  leg_index      SMALLINT NOT NULL,
  race_id        UUID NOT NULL REFERENCES races(id),
  runner_id      UUID NOT NULL REFERENCES runners(id),
  finish_slot    SMALLINT,                        -- exotics: required finishing position
  odds_taken     NUMERIC(10,3) NOT NULL,          -- frozen at placement
  odds_format    TEXT NOT NULL DEFAULT 'decimal',
  outcome        TEXT CHECK (outcome IN ('pending','won','placed','lost','void')),
  UNIQUE (bet_id, leg_index)
);
CREATE INDEX ON bet_legs (race_id) WHERE outcome = 'pending';
```

The partial index on `bet_legs (race_id) WHERE outcome = 'pending'` is the single most important index in the schema: it is the query the settlement worker runs for every finished race.

---

## 7. Settlement audit

```sql
CREATE TABLE settlements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id            UUID NOT NULL REFERENCES bets(id),
  race_id           UUID NOT NULL REFERENCES races(id),
  result_version    INTEGER NOT NULL,
  outcome           TEXT NOT NULL,
  return_minor      BIGINT NOT NULL,
  calculation       JSONB NOT NULL,   -- full working: inputs, rules applied, arithmetic
  payload_hash      TEXT NOT NULL,    -- sha256 of the source result payload
  is_reversal       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bet_id, result_version)
);

CREATE TABLE provider_payloads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,        -- 'racecard' | 'odds' | 'result'
  entity_ref   TEXT NOT NULL,
  body         JSONB NOT NULL,
  body_sha256  TEXT NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, kind, entity_ref, body_sha256)
);
```

**`settlements.calculation` is the feature that ends disputes.** It stores the complete derivation — place terms applied, Rule 4 deduction, dead-heat divisor, each intermediate value. When a user asks "why did I get £14.38?", the answer is rendered from stored data, not recomputed and not guessed. Every serious betting product has this; most simulators do not, which is why they feel untrustworthy.

**`UNIQUE (bet_id, result_version)` gives idempotent settlement for free.** Re-running the worker cannot double-pay.

---

## 8. Deferred to later phases

Not designed now, deliberately: `follows`, `leagues`, `league_members`, `challenges`, `comments`, `likes`, `notifications`, `feature_flags`, `roles`, `permissions`. Each is straightforward and each will be shaped by decisions not yet made. Designing them now produces schema that gets thrown away.

The one forward-compatibility guarantee that matters: **`users.id` is a stable UUID and every future social table foreign-keys to it.** Nothing else needs to be decided today.

## 9. Migration discipline

- Every migration is reversible or explicitly marked irreversible with justification.
- Backward-compatible for one release: expand → deploy → migrate data → contract.
- No `DROP COLUMN` in the same release that stops writing to it.
- Migrations run as a separate CI step before app deploy, so a failed migration blocks rather than half-deploys.
