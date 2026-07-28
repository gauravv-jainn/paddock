---
paths:
  - "src/modules/settlement/**/*.ts"
  - "src/modules/wallet/**/*.ts"
  - "src/modules/betting/**/*.ts"
  - "tests/golden/**/*.ts"
---

# Money code rules

These rules apply to settlement, ledger, and bet placement code only.

## Arithmetic

- All monetary values are `bigint` in minor units (pence/cents). There is no
  exception to this.
- Never `Number()` a monetary bigint to do arithmetic and convert back.
- Round **once**, at the end of a computation, never at intermediate steps.
- Rounding is half-up, resolving ties in the user's favour.
- Odds are `number` (decimal form) and are inputs to multipliers only — they
  never hold money.

```ts
// WRONG — compounds rounding error
const a = Math.round(stake * fraction);
const b = Math.round(a * odds);

// RIGHT — scale to integers, one rounding
const scaled = BigInt(Math.round(fraction * odds * 1_000_000));
const result = (stakeMinor * scaled + 500_000n) / 1_000_000n;
```

## settle() is pure

```ts
function settle(bet: Bet, result: RaceResult, rules: RuleSet): SettlementOutcome
```

Forbidden inside `settle()` and anything it calls:
- database access
- network calls
- `Date.now()`, `new Date()`, `performance.now()`
- `Math.random()`
- reading environment variables
- logging with side effects

Everything time-dependent is passed in as part of `Bet` or `RuleSet`.

## Rule tables

The place-terms and Rule 4 tables live in `src/modules/settlement/rules/` as
plain data, versioned by effective date. They are **never** inlined as
conditionals scattered through the settlement code, and they are **never**
edited without a corresponding golden-vector test.

Rule tables carry a `VERIFY:` comment naming the authoritative source and the
date last checked. Do not silently change a value.

## Order of operations in settlement

This order is load-bearing. Do not reorder:

1. Check `runner.status` — non-runner → VOID, full refund, stop.
2. Check `disqualified` — → LOST, stop.
3. Compute place terms from `race.actual_runners` and `race.is_handicap`.
   Never from a value cached at bet placement time.
4. Determine outcome from `finish_position` against places paid.
5. Apply dead-heat divisor.
6. Apply Rule 4 to **winnings only** — never to the returned stake.
7. Round once.
8. Emit ledger entries.

## Required output

Every settlement returns a `calculation` object recording every input, every
rule applied, and every intermediate value. It is persisted to
`settlements.calculation`. A user must be able to see exactly why they received
a given amount without the number being recomputed.

## Testing

- 100% branch coverage on `settle()`. No waivers.
- Table-driven tests only. One row per scenario.
- Golden vectors in `tests/golden/` are the source of truth. Tests you write
  yourself do not count as verification of correctness — they count as
  verification of the code matching your own understanding, which may be wrong.
- Required boundary coverage: field sizes 4, 5, 7, 8, 11, 12, 15, 16 — both
  handicap and non-handicap.
- Required edge cases: 2-way and 3-way dead heats, dead heat for the final paid
  place, multiple Rule 4 withdrawals, non-runner that changes the place-terms
  band, bet placed after a withdrawal (Rule 4 must NOT apply).

## Ledger

- Append-only. Enforced by a database trigger — do not attempt to work around it.
- Every transaction writes ≥2 entries summing to exactly `0n`.
- `txn_id` groups the balanced set.
- Negative user balances are permitted after a reversal. Do not clamp to zero.
