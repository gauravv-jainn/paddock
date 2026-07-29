# SESSIONS — Phase 0

Fourteen sessions. Run them in order. **One per Claude Code session**, `/clear`
between each, commit after each.

The prompts below are copy-paste ready. Every one ends with an assumptions
request — that is where the bugs are, every time.

---

## Before session 1

```bash
cd "/Users/gj/Documents/Claude - builds/PaperHorse"
git init
claude
```

In the session, run `/context` and confirm `CLAUDE.md` and both files under
`.claude/rules/` appear under **Memory files**. If they don't, nothing below
matters — fix that first.

Then run `/hooks` and confirm the two guard scripts are registered.

---

## Week 1 — foundations

### S1 — Scaffold

```
Set up the project skeleton per docs/03-system-architecture.md §3.

Next.js App Router, TypeScript strict with noUncheckedIndexedAccess,
Drizzle + Postgres, Vitest, ESLint, and the exact pnpm scripts listed
in CLAUDE.md so those commands are real rather than aspirational.

DO NOT create any modules, routes, components, or database schema.
DO NOT add dependencies beyond what the above requires.

DELIVERABLE: a repo where `pnpm typecheck` and `pnpm test` both pass on
an empty suite, plus a list of every assumption you had to make.
```

### S2 — Ledger *(plan mode)*

```
Implement the wallet module per docs/04-database-design.md §3.

Include: the schema, both triggers (append-only enforcement and the
DEFERRABLE INITIALLY DEFERRED balance assertion), the wallet_balances view,
and a service interface exposing createWallet, postTransaction, getBalance.

Add a property-based test using fast-check asserting that for any sequence
of postTransaction calls, the sum of amount_minor across all wallets is
exactly 0n.

DO NOT touch bets, races, or auth. DO NOT add a balance column.

End with your assumptions.
```

### S3 — Auth

```
Email + password auth with server-side sessions per
docs/04-database-design.md §2. Session tokens hashed at rest, never stored raw.

DO NOT implement OAuth, passkeys, 2FA, email verification, or password reset.
Those are Phase 1.

End with your assumptions.
```

---

## Week 2 — data

### S4 — Catalogue schema *(plan mode)*

```
Implement the racing catalogue tables per docs/04-database-design.md §4.

Note that races.actual_runners and races.is_handicap are load-bearing inputs
to settlement, not optional metadata. If the schema makes it possible for
either to be null at settlement time, say so.

End with your assumptions.
```

### S5 — Provider port + archive adapter

```
Implement the RacingDataProvider port per docs/01-data-and-api-research.md §4,
plus a single 'archive' adapter that reads local historical JSON.

The capabilities object is a runtime value the betting engine will read, not
documentation. Wire it so that a false capability actually disables the
corresponding behaviour.

DO NOT implement a second adapter, caching, retries, rate limiting, or a
circuit breaker. Those come in Phase 1 when there is a second provider to
abstract over.

End with your assumptions.
```

### S6 — Ingestion + racecard read model

```
Ingest one month of historical UK/IRE meetings into the catalogue via the
archive adapter. Build the racecard read model and a plain unstyled page
listing meetings, races, and runners.

No CSS beyond browser defaults. No components library. No design work.

End with your assumptions.
```

---

## Week 3 — the only week that matters

### S7 — Golden vectors *(do this yourself)*

Not a Claude Code session. See `tests/golden/README.md`.

Assemble `tests/golden/races.json` from real historical results, sourced
independently. Start with the four hand-computed cases in that file.

**Do not skip this. Do not delegate it.** Everything after this point is
graded against it, and a grader the model wrote is not a grader.

### S8 — Rule tables

```
Implement the place-terms and Rule 4 tables per
docs/05-betting-and-settlement-engine.md §4 and §5, as plain versioned data
in src/modules/settlement/rules/ — not as conditionals scattered through
settlement code.

Every entry carries a VERIFY: comment naming its source and the date checked.

Where you are not certain of a value, flag it explicitly rather than
guessing. I would rather have five flagged uncertainties than one silent
wrong number.

End with your assumptions.
```

### S9 — settle() *(plan mode — the most important session in the project)*

```
Implement settle() per docs/05-betting-and-settlement-engine.md §3-§6 for
WIN, PLACE and EACH_WAY only.

Pure function: no I/O, no database, no Date.now(), no randomness.
bigint minor units throughout.
Order of operations exactly as specified in .claude/rules/money.md.
Returns a calculation object recording every input and every rule applied.

Tests: table-driven, run against tests/golden/published.json (docs/08 D20
supersedes races.json, which was never assembled).
Target 100% branch coverage on settle(), and a >=90% Stryker mutation score
over src/modules/settlement/ with every survivor recorded. See docs/05 §8.

DO NOT touch the database. DO NOT add bet types beyond the three named.
DO NOT handle multiples or exotics.

DELIVERABLE: settle.ts, settle.test.ts, a coverage report, and your assumptions.
```

### S10 — Fix the failures

There will be failures. That is the fixtures working. Feed them back **one at
a time** with `/explain-failure`:

```
/explain-failure Vector 2024-06-19-ascot-1530, EW on #7: expected 3000, got 3600
```

The explanation matters more than the fix. If it can't name the rule, the fix
is a patch over a misunderstanding and something else will break later.

---

## Week 4 — making it usable

### S11 — Bet placement *(plan mode)*

```
Implement the bet placement transaction per docs/03-system-architecture.md §4.

SERIALIZABLE isolation, idempotency key with a unique index, odds re-fetch
with tolerance check, balance computed from the ledger, stake debited via
postTransaction.

Reject rather than clamp on insufficient balance.

End with your assumptions.
```

### S12 — Settlement worker

```
Implement the settlement pipeline per docs/03-system-architecture.md §5.

BullMQ job on the worker process. Idempotent on (bet_id, result_version).
Persists the raw payload and its sha256 before normalising.
Writes settlement rows and ledger entries in one transaction.

Include the re-settlement path: when result_version increments, compute the
delta and write compensating entries. Never mutate a prior settlement.

End with your assumptions.
```

### S13 — Analytics

```
Implement the Phase 0 analytics per docs/02-product-requirements.md P0-08:
P&L, ROI, strike rate, average odds, equity curve.

All computed from the ledger and bets tables. No new tables.
ROI is (returns − stakes) / stakes, reported with the sample size alongside
it — a 200% ROI on four bets is noise and the UI must not present it as a
result.

End with your assumptions.
```

### S14 — UI

```
Build the Phase 0 UI: meeting list, racecard, bet slip, bet history with
settlement detail, analytics view.

Plain and well-typeset. System font stack, generous spacing, a single accent
colour. No glass, no blur, no motion, no component library, no design tokens.

The settlement detail view renders settlements.calculation directly — the
user must be able to see exactly why they received a given amount without
anything being recomputed.

End with your assumptions.
```

---

## After every session

```
/scope-check
/verify
git add -A && git commit -m "S<n>: <what>"
```

If `/scope-check` is not clean, deal with it before committing. Scope creep
compounds; a stray abstraction in week 2 is three files to unpick in week 6.

---

## The Phase 0 gate

Do not start Phase 1 until all five are true:

- [ ] All non-disputed vectors in tests/golden/published.json settle correctly,
      zero errors (docs/08 D20 replaced the 200 hand-computed vectors)
- [ ] Mutation score over `src/modules/settlement/` is >=90%, every survivor
      recorded in `tests/mutation-survivors.md`
- [ ] Ledger sums to zero across every wallet at every point in history
- [ ] Property tests pass, including settlement idempotence
- [ ] Five real users, twenty bets each, no settlement dispute
- [ ] **Honest answer: is this interesting?**

If the last one is no, stop. Four weeks and £0 to learn something true is a
good outcome. Building a beautiful interface over a product nobody wants for
six more months is not.

---

## Two things no agent can do for you

1. **Email the data provider.** Ask whether a paper-trading platform with no
   real money is permitted under their terms. `docs/01` §2.2 explains why this
   is not optional.
2. **Verify the Rule 4 and place-terms tables** against an authoritative
   source and fill in the `VERIFY:` comments.

Both are cheap this week and expensive in month three.
