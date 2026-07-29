# 08 — Decision Log

Decisions that resolve ambiguities found during the S1–S6 run. Each entry is
binding on all later sessions. Where a decision contradicts docs 01–07, **this
document wins** and the older doc is to be amended in the same session that
implements the change.

---

## D1 — Money unit is **GBP pence**. Single currency, Phase 0.

**Status:** decided. Supersedes `docs/04` §3 (`currency DEFAULT 'USD'`) and the
"USD base" line in `CLAUDE.md`.

The specification contradicted itself: the ledger said USD cents, the opening
balance said £100,000, and every Rule 4 value in `docs/05` §5 is quoted in
**pence per pound**. That contradiction was a defect in the spec, not in the
implementation, and it must be resolved before a single golden vector is
written — it changes every expected return.

**Resolution:**
- `ledger_entries.amount_minor` is **pence**. Base unit, no exceptions.
- `wallets.currency` defaults to `'GBP'`.
- Phase 0 has **no currency conversion at all**. Not in accounting, not in
  display.
- `users.base_currency` is **dropped in Phase 0** and re-added in Phase 2.
  Keeping it as a `NOT NULL DEFAULT 'GBP'` column that nothing reads was the
  original wording, but a column with a default is written on every insert, so
  "read by nothing" is not a property the schema enforces — it is a promise
  someone eventually breaks. A column that does not exist cannot be read.
- Multi-currency display returns in Phase 2, as a presentation layer over a
  pence ledger, and re-adds the column then. It never touches accounting.

> **Implementation status:** the pence ledger, the `'GBP'` default and the
> removal of USD from every doc are done (commit `cb59933`, `1cf948a`).
> **Dropping `users.base_currency` is NOT yet applied** — the column still
> exists. It needs a migration plus the field removed from
> `src/modules/identity/schema.ts`. Until that lands, this bullet describes an
> intent, not the schema.

**Rationale.** Every rule in the settlement domain — Rule 4 deductions, each-way
fractions, place terms — is expressed in the vocabulary of British bookmaking.
Phase 0 is UK & Ireland only. Running a USD ledger underneath a GBP rule set
means a conversion sits in the money path from day one, and conversions in the
money path are how rounding bugs enter a system that is otherwise bigint-clean.

---

## D2 — Opening balance is £100,000 = `10_000_000n` pence.

**Status:** decided. Confirms `docs/02` P0-02 over the original brief's
$1,000,000.

A seven-figure bankroll makes stake sizing meaningless: at £1,000,000 a £10 bet
is 0.001% of the roll, so drawdown, Kelly fractions and risk-of-ruin all become
unreadable. The analytics are the product; a bankroll that renders them
decorative defeats it. £100,000 is already generous.

**Revisit trigger:** if users report the balance feels constraining, raise it.
Not before.

---

## D3 — `races.is_handicap` loses its default.

**Status:** decided. Amends `docs/04` §4.

`NOT NULL DEFAULT FALSE` on a settlement input is a silent-wrong-answer
generator: a feed that omits handicap status produces a non-handicap race, which
pays a different number of places at some field sizes, and nothing ever reports
it.

**Resolution:** `is_handicap BOOLEAN NOT NULL` with **no default**. Every insert
states it explicitly. The archive adapter's existing rejection of cards that
omit it is correct and stays.

This was caught during S4. Good catch — it is exactly the class of bug that
never surfaces in testing and surfaces in production as a disputed payout.

---

## D4 — `actual_runners` CHECK constraint: approved.

`CHECK (status <> 'result' OR actual_runners IS NOT NULL)` is retained.

The reasoning given was right: nullable while the race is open is correct
because the value is genuinely unknown then; null at `status = 'result'` is a
settlement-time crash waiting to happen. Constrain the state where it matters,
not the state where it doesn't.

---

## D5 — `horses` unique constraint `NULLS NOT DISTINCT`: approved.

Correct fix for a real defect in `docs/04` §4. Two of three key columns are
nullable; under default Postgres semantics ingestion would insert a duplicate
horse on every run and idempotency would be a fiction.

## D6 — Rename `horses.country_code` to `horses.breeding_suffix`.

`CHAR(2)` on `tracks` is an ISO country. `CHAR(3)` on `horses` is a breeding
suffix (`IRE`, `USA`, `GER`). Same name, different meaning, adjacent tables —
someone will join on them eventually. Rename removes the trap.

**Scope: the whole path, not just the column.** Renaming only the database
column would have left `HorseRef.countryCode` in the canonical domain model and
`horse.countryCode` in the archive JSON, sitting next to a genuine
`meeting.countryCode` — the same trap, one layer up, with the ingest mapper
quietly translating between the two names. The rename therefore covers:

| Layer | Before | After |
|---|---|---|
| `horses` column | `country_code CHAR(3)` | `breeding_suffix CHAR(3)` |
| unique constraint | `horses_name_country_code_foaled_year_key` | `horses_name_breeding_suffix_foaled_year_key` |
| domain model (`providers/types.ts`) | `HorseRef.countryCode` | `HorseRef.breedingSuffix` |
| **archive JSON** (`horse.*`) | `"countryCode"` | `"breedingSuffix"` |
| racecard read model | `horseCountryCode` | `horseBreedingSuffix` |

`tracks.country_code` and `Meeting.countryCode` are unchanged — those are real
ISO-3166-1 alpha-2 countries.

The archive format was changed rather than mapped because O2 is still open: no
real day files exist yet, so this was the cheapest moment it will ever be. Any
draft day files written before this decision use the old `countryCode` key and
will be rejected.

---

## D7 — Adopt Zod.

**Status:** decided. Confirms `docs/03` §3.

The hand-written `parse.ts` was the right call under a "no unapproved
dependencies" instruction, and the instruction was mine. Zod is now approved.
Every provider payload and every API boundary validates through it.

Hand-written validators drift from the types they validate. The money path
cannot afford that.

---

## D8 — Wallet creation and opening balance belong to registration.

**Status:** decided. Fixes a gap: no session in `SESSIONS.md` created a user's
wallet, so P0-02 was specified and never assigned.

`identity.register()` becomes transactional:
1. insert user
2. `wallet.createWallet(userId)`
3. `wallet.postTransaction()` — `OPENING_BALANCE`, `+10_000_000n` to the user
   wallet, `-10_000_000n` from the house wallet

All three in one transaction. A user without a wallet must not be representable.

> **Implementation status — atomicity is NOT yet guaranteed.** `register()` is
> written as `tx ? run(tx) : getDb().transaction(run)`: it opens a transaction
> only when no executor is passed, and otherwise assumes the caller already has
> one open. Drizzle's `Database` and its transaction handle are structurally
> similar enough that passing a plain `db` type-checks and silently runs every
> statement in autocommit.
>
> A probe run on 2026-07-29 confirmed the consequence: with `getHouseWallet()`
> made to fail — which happens *after* the user and wallet inserts — an
> orphaned user row and wallet survived, with no opening balance. That is
> exactly the state D8 says must not be representable.
>
> The suite does not catch this. `rolls the whole registration back if any part
> of it fails` provokes a duplicate-email failure, which occurs on the *first*
> statement, so there is nothing to roll back either way.
>
> Fixing it is a decision, not a typo: either narrow the parameter to a
> transaction handle so a plain `db` cannot be passed, or always open a
> transaction and rely on drizzle's nested `.transaction()` emitting a
> SAVEPOINT when one is already open. **S11 must not build on the current
> behaviour.**

The house wallet is seeded by migration and may go arbitrarily negative — there
is no book to balance and no real liability.

**There is exactly one, enforced by a partial unique index:**

```sql
CREATE UNIQUE INDEX wallets_house_singleton_key
  ON wallets (kind) WHERE kind = 'house';
```

Without it `getHouseWallet()` has no deterministic answer — it would be
selecting one row from an unbounded set, and which one it got would depend on
physical row order. The index is what lets the lookup be a plain `WHERE kind =
'house'` with no `ORDER BY` and no ambiguity.

**The migration fails loudly on a database that already has duplicates.** This
is deliberate. Creating the index on such a database raises
`duplicate key value ... Key (kind)=(house) is duplicated` and the migration
aborts, leaving the database untouched. It does not pick a winner and it does
not delete the losers: house wallets are referenced by `ledger_entries`, the
ledger is append-only, and no automated rule can decide which balance history
was the real one. A human resolves it with compensating entries.

This is not hypothetical — it happened during the S1–S6 test database, which
had accumulated several `kind='house'` wallets from tests that used `house` as
a throwaway counterparty. The fix there was to recreate a disposable test
database. On a database with real history, it would not be.

---

## D9 — HTTP layer folds into S11.

**Status:** decided. Fixes a second gap: S3 built the identity *service* and
nothing calls it; no session created routes or session cookies.

S11 (bet placement) already needs an authenticated request context, so it
absorbs: session cookie handling (HttpOnly, Secure, SameSite=Lax), the auth
middleware, and the register/login/logout routes.

---

## D10 — `odds_snapshots` deferred to Phase 1.

Correct to have skipped it. Phase 0 is historical replay; there is no live
market to snapshot. `catalog` owns it when it arrives. `docs/04` §5 is a
Phase 1 specification, not a Phase 0 one, and should be labelled as such.

## D11 — Enumerations confirmed.

`RegionCode = 'GB' | 'IE'` and `MarketType = 'WIN' | 'PLACE' | 'EACH_WAY'` for
Phase 0. `docs/01` §4.2 named both types without enumerating them. Extend only
when a session explicitly requires it.

---

## D12 — The archive fixtures under `__fixtures__/` stay non-racing.

Invented placeholder data, named so it cannot be mistaken for real results, with
a README saying so, is exactly right. It tests that fields land in the correct
columns. It tests nothing about settlement, and it must never be moved,
renamed, or promoted into `tests/golden/`.

---

## D13 — `settle()` is graded by mutation score, not coverage alone.

**Status:** decided. Amends `docs/05` §8.

"100% branch coverage" was the bar and it is not sufficient. The append-only
trigger tests had coverage and asserted nothing — they ran against an empty
table, where a row-level trigger never fires. An audit of all 73 tests found six
more in the same class.

**Resolution:** the bar for `src/modules/settlement/` becomes branch coverage
**and** a Stryker mutation score of ≥ 90%, with every survivor recorded in
`tests/mutation-survivors.md` as either a missing golden vector or a justified
equivalent mutant. A survivor with no entry fails the gate whatever the score.

Rationale for 90 rather than 100 or 80, and the mechanics, are in `docs/05`
§8.0.1. Stryker is installed in S9, not before — there is nothing to mutate yet.

The Phase 0 gate in `SESSIONS.md` gains this alongside the 200 golden vectors.

---

## Still open — not decidable by an agent

| # | Item | Blocks |
|---|---|---|
| O1 | `tests/golden/races.json` — assembled by hand from real results | S8, S9, and every gate after |
| O2 | One month of GB/IE archive day files under `ARCHIVE_ROOT` | S6 ingest run |
| O3 | Written confirmation from the data provider that a paper-trading platform is permitted under their terms | Phase 1 |
| O4 | Rule 4 and place-terms tables verified against an authoritative source, `VERIFY:` comments filled | S8 |

O1 and O4 are the ones that determine whether this product is correct. Neither
can be delegated, and no amount of tooling substitutes for them.
