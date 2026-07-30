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

> **Implementation status: fully applied.** The pence ledger, the `'GBP'`
> default and the removal of USD from every doc landed in `cb59933` / `1cf948a`.
> `users.base_currency` was dropped by migration `0009_sparkling_siren.sql` in
> `27c41fb`; the column no longer exists.

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

> **Implementation status: applied.** `register()` previously took
> `tx?: Executor`, a union including a plain `Database`, so passing `db`
> type-checked while running every statement in autocommit — and a probe
> confirmed an orphaned user and wallet survived a failure after the wallet
> insert.
>
> The parameter is now `Transaction`. `PgTransaction` carries `rollback`,
> `setTransaction`, `schema` and `nestedIndex`, which `Database` lacks, so
> passing `db` is a compile error (`TS2345`) rather than a convention. Omitting
> the argument opens a transaction.
>
> The test that claimed to cover this provoked a duplicate-email failure, which
> lands on the first statement — nothing to roll back either way. It now removes
> the house wallet so `getHouseWallet()` fails *after* both inserts, and was
> proven by reverting the signature: one orphaned user row, test fails.
> (commit `27c41fb`)

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

## D14 — Rule 4's input is a fractional price, not a decimal one.

Resolves O5.

Rule 4 bands are published fractionally because the deduction is set from the
bookmaker's announced board price, which lives on the fractional ladder by
construction. Storing a decimal and converting inverts the domain and creates
gaps that do not exist in the rule.

The 3.25 contradiction is the evidence: four sources put 9/4 at 30p, one puts
decimal 3.25 at 25p. 9/4 IS 3.25. That divergence was manufactured by
conversion, not found in the rule.

Resolution:
- Add runners.withdrawn_at_fraction as two integer columns (numerator,
  denominator). This is the sole input to the Rule 4 lookup.
- runners.withdrawn_at_odds (decimal) is retained for display and analytics
  and is never read by settle().
- The band table is stored fractionally and compared with integer arithmetic
  on numerator/denominator. No float, no decimal, anywhere in the lookup.
- If a feed supplies only a decimal: snap to the standard fractional ladder
  only on an exact match. On anything else, DO NOT GUESS — refuse to
  auto-settle, flag the race for review, and record why.

That last rule follows the pattern already built: capabilities.deadHeatFlags
false refuses rather than flattening. Rule 4 does the same. Silently closing a
gap upward is exactly what produced the ten-row error this session found.

---

## D15 — Round once, at the end. The disputed fixture stays disputed.

.claude/rules/money.md is unchanged: one rounding, at the end of the
computation. The three-way dead-heat fixture that expects £23.31 via an
intermediate £3.33 is kept, marked expectedDisputed: true, and excluded from
the pass/fail gate while remaining visible in the report.

Bookmakers round intermediate stakes because they settle in physical pennies.
A paper platform has no such constraint and self-consistency matters more.
Revisit only when a primary bookmaker source is reachable.

---

## D16 — Rule 4 applies to both parts of an each-way bet. (Resolves O7)

An each-way bet is two bets. Rule 4 reduces the winnings of any winning bet
struck at pre-withdrawal prices. The place part is such a bet, so its winnings
are reduced too — at the same pence-in-the-pound rate, applied to the place
part's own winnings after the place fraction, never to returned stake.

docs/05 §3.3 is silent on this and must say it explicitly. Order stays as
.claude/rules/money.md: place fraction first, then dead-heat divisor, then
Rule 4, then round once.

---

## D17 — Early withdrawal voids; late withdrawal deducts. (Resolves O8)

If the market reformed after a withdrawal, bets struck afterwards carry no
deduction. This needs a withdrawal timestamp the archive may not supply.

Follow D14's pattern rather than inventing one:
- runners.status already distinguishes non_runner from withdrawn.
- A withdrawn runner carrying a fraction or an announced deduction is a late
  withdrawal: Rule 4 applies.
- A withdrawn runner with neither is ambiguous. REFUSE to auto-settle the
  race, flag it, record why. Do not assume either way.
- non_runner remains a straight void with no deduction.

---

## D18 — Enhanced place terms are opt-in per race. (Resolves O9)

Marquee races carry commercially enhanced terms that are not rule changes.

- races gains enhanced_places and enhanced_fraction, both nullable.
- Null means standard terms from the docs/05 §4 table.
- Both set means those terms apply verbatim.
- One set without the other is a constraint violation.
- Any historical race that ran under an enhanced offer is EXCLUDED from
  tests/golden/ unless the real terms are recorded on the fixture.

---

## D19 — Adopt the four-source reading at evens. Flag it. (O6 stays open)

Four unanimous secondary sources beat one dissenting secondary source and my
own unsourced table. The evens band takes the four-source value.

But three readings existed, and the disagreement is not resolved — only
decided. docs/05 §5.1 marks this row HIGHEST RISK with all three candidate
values recorded inline. It is the single row that most needs a primary source,
and O6 stays open until one is read.

---

## D20 — £0 data plan: archive-only, metamorphic verification.

Budget is £0 and the project is a public portfolio piece. That rules out
Betfair (delayed key is personal-use only; India excluded from licence
applications) and The Racing API (paid). O3 is closed — there is no provider
to seek ToS confirmation from. Phase 1 live data is deferred indefinitely.

Data source: free historical results datasets. Ingest, do not redistribute;
check and record the dataset licence in docs/sources/.

What the archive supports: WIN, PLACE, EACH_WAY on clean races, dead heats,
field-size boundaries, handicap vs non-handicap.
What it does not: non-runners, withdrawals, Rule 4. Those stay covered by the
27 published third-party vectors only, and any archive race is settled with
rule4 = 0 by construction.

Verification strategy replaces hand-computed golden vectors with three layers:
1. The 27 published vectors — third-party computed, genuine grading.
2. Metamorphic properties — relationships that hold without knowing the answer.
3. Differential implementation — two independent settle() written blind.

Accepted residual risk, recorded deliberately: a systematic error present in
both implementations and consistent across all inputs would pass all three
layers. Absolute correctness on archive races is unverified.

---

## D21 — Low-confidence bands are settled, but marked.

Rule 4 rows 1-9 (90p down to 50p) carry 6/6 table consensus and zero
third-party computed confirmation. They move the most money and are the least
independently verified. Rows 17 and 19 are the same, at lower exposure.

Refusing to settle them would leave bets permanently open with no admin panel
to clear them — worse than settling. So:

- settle() proceeds normally.
- The calculation object carries evidenceConfidence: 'consensus-only' with the
  band's source count and computed count, for any band with zero computed
  confirmation.
- The settlement detail view states it in words: "This deduction rate is
  supported by six published sources but has no independent worked example."

The engine tells the user what it knows and what it doesn't. That is the same
principle as never rendering stale odds as live.

---

## D22 — The hooks were never enforcing. Two faults, both fixed; one unverified.

Resolves O11.

`README.md` describes the two guard scripts as rules that "apply regardless of
what the model decides", because a `PreToolUse` hook exiting 2 blocks the tool
call outright. Neither has ever done that.

**Fault A — a design error in the hook configuration.** `guard-money-path.sh`
was registered on **PostToolUse**, which runs AFTER the write lands. Exit 2
there rejects a tool call whose effect is already on disk, so it could never
have blocked anything. Proved: a file containing `.toFixed(` was written into
`src/modules/settlement/` and the write stood.

It is now **PreToolUse**, and reads the PROPOSED content out of the tool
payload rather than the file on disk — `tool_input.content` for Write,
`tool_input.new_string` for Edit, and every `tool_input.edits[].new_string` for
MultiEdit. Verified by hand across nine payload shapes: it blocks a float in
each of the three tool shapes including a MultiEdit whose *second* edit is the
dirty one, and allows clean code, code outside the money path, a malformed
payload, and a payload with nothing proposed.

**Fault B — the same script would also have missed a MultiEdit entirely**, and
it read the file off disk, which means it could only ever have judged what was
already written.

**Registration is still unverified.** A `SessionStart` canary now appends to
`/tmp/paperhorse-hooks.log`. It can only fire at the start of a session, so it
will stay silent for the rest of this one — silence today is "not yet
observed", not proof of failure. `./scripts/verify-hooks.sh` reports the state
and runs both guards directly.

**Until the canary fires, the enforcement layer is ADVISORY, and `CLAUDE.md`
and `README.md` say so** rather than claiming a guarantee the project does not
have. If the next session starts and the log is still empty, the hooks are not
registered and no script fix will help — that is a harness question, answered
by `/hooks` in an interactive session.

The wider lesson is the one this project keeps relearning: a check nobody has
watched fail is not a check. The guards joined the append-only trigger tests,
the six vacuous tests and the inert commit gate on that list.

---

## D23 — Split the rounding-sensitive properties. Do not widen tolerance.

Metamorphic properties 1, 3, 4 and 8 failed against a correct settle(). They
were property defects, not engine defects: each asserted an exactness that no
penny-rounding ledger can provide.

**Tolerance widening was proposed and REJECTED.** The error on properties 1 and
3 scales with k — double the stake and you double the opportunity for the
rounded result to drift from k x the single result. A fixed +/-1 penny band is
therefore either wrong (too tight at large k, so it still fails) or useless
(loose enough to pass, and loose enough to hide a real rounding bug). A
property that can absorb the bug it exists to catch is worse than no property.

**Resolution — split each into two properties, both exact:**

- Properties 1 and 3 assert linearity on the PRE-ROUNDING exact value, which
  settle() already exposes as an integer numerator/denominator pair on every
  part (`calculation.parts[].partReturn`) and on the total
  (`calculation.rounding.exactNumerator` / `exactDenominator`). Rationals
  compare by cross multiplication, so this is exact with no tolerance at all.
- A separate property asserts that the rounded figure is the correct half-up
  rounding of that exact value. Also exact.

Together they are STRICTLY STRONGER than the originals: the first catches an
arithmetic error, the second catches a rounding error, and neither can mask
the other. The original single property conflated them and could be satisfied
by an implementation that got both slightly wrong in opposite directions.

- Property 4: "strictly reduces" -> "never increases", plus never below stake.
  At a 1p stake both figures round equal, and that is correct behaviour.
- Property 8: "strictly increases" -> "never decreases", plus a guard that the
  two prices differ by more than ODDS_SCALE's 1e-6 resolution. Below that
  resolution the two prices are the same price, and asserting otherwise tests
  the scale constant rather than the engine.

---

## Still open — not decidable by an agent

| # | Item | Blocks |
|---|---|---|
| ~~O1~~ | ~~`tests/golden/races.json` — assembled by hand from real results~~ — **superseded by D20**, which replaces hand-computed golden vectors with three layers: the published third-party vectors, metamorphic properties, and differential implementation. Layer 4 (table consensus) was added later. `races.json` is no longer a blocker for S8, S9 or the Phase 0 gate; assembling one later remains the strongest available hardening. | — |
| O2 | One month of GB/IE archive day files under `ARCHIVE_ROOT` | S6 ingest run |
| ~~O10~~ | ~~`guard-commit.sh` gates on the retired `races.json`~~ — **fixed.** It now gates on `tests/golden/published.json` and runs `pnpm test:settlement`, which was broadened to cover `src/modules/settlement`, `tests/golden` and `tests/consensus`. Verified: exit 2 with the failing vector named when a vector is broken, exit 0 when green. | — |
| ~~O11~~ | ~~Neither hook fires~~ — **resolved by D22** as far as the scripts go: the money-path guard moved to `PreToolUse` and now inspects proposed content. **Registration remains unverified** until the `SessionStart` canary fires; run `./scripts/verify-hooks.sh` at the start of the next session. | all |
| ~~O3~~ | ~~Written ToS confirmation from the data provider~~ — **closed by D20.** There is no paid provider, so there is nobody to ask. Replaced by the obligation to record the free dataset's licence in `docs/sources/`. | — |
| O4 | Rule 4 and place-terms tables verified against an authoritative source, `VERIFY:` comments filled | S8 |
| ~~O5~~ | ~~Decimal-to-fractional Rule 4 mapping~~ — **resolved by D14.** The mapping is abolished rather than defined: the fraction is stored and is the sole lookup input. | — |
| O6 | **The evens band — HIGHEST RISK row in the table.** Three readings exist: 45p (four unanimous sources, adopted by D19), 50p (the old unsourced `docs/05`), 55p (one source cited by `docs/09` §3.3). D19 **decides** the value; it does not **resolve** the disagreement. Stays open until a primary source is read. | S8 |
| ~~O7~~ | ~~Rule 4 on the place part of an each-way bet~~ — **resolved by D16.** It applies to both parts. | — |
| ~~O8~~ | ~~Early withdrawal: void or deduct~~ — **resolved by D17.** Decided by what the row carries, and ambiguity refuses rather than assumes. | — |
| ~~O9~~ | ~~Enhanced place terms~~ — **resolved by D18.** Opt-in per race, both columns or neither, excluded from `tests/golden/` unless the real terms are recorded. | — |

O4 is the one that determines whether the rule tables are correct. It cannot be
delegated, and no amount of tooling substitutes for it — four verification
layers measure agreement and self-consistency, not truth.

O1 was the other, and D20 superseded it: the graders are now third-party
published returns rather than hand-computed ones.

**Update 2026-07-29.** An attempt to close O4 by fetching bookmakers' published
rules found that all sixteen block automated fetches
(`docs/sources/BLOCKED-bookmakers.txt`). What it did establish, from four
agreeing third-party sources, is that `docs/05` §5.1 was **wrong from "Evens"
upward** — a missing band shifted ten consecutive rows one rung too severe. The
table is corrected and the evidence is in `docs/sources/`, but the source class
is guides rather than bookmakers, so **O4 stays open**. O5 was raised by that
work and is resolved by D14.
