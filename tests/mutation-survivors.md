# Mutation survivors — `src/modules/settlement/`

Run: `pnpm mutation` · Stryker 9.6.1 · scoped per `stryker.config.json`
Last measured: 2026-07-30

## Score

| File | Score | Killed | Survived |
|---|---|---|---|
| `rules/fraction.ts` | **100.00%** | 21 | 0 |
| `rules/placeTerms.ts` | 86.42% | 70 | 10 |
| `rules/rule4.ts` | 73.98% | 91 | 32 |
| `settle.ts` | 77.48% | 351 | 99 |
| **All files** | **78.61%** | **533** | **141** |

**The `docs/05` §8 gate is ≥90%. It is NOT met.** `stryker.config.json` sets
`thresholds.break: 90`, so `pnpm mutation` exits 1 today. That is deliberate —
the gate should fail while it is unmet.

### History

| When | Score | What changed |
|---|---|---|
| first run | 49.85% | Stryker installed. `settle.ts` at 34.4%. |
| after `settle.test.ts` | **78.61%** | 52 tests asserting the calculation object. `settle.ts` 34.4% → 77.5%. |

The first run is the interesting number. The engine already passed 29
third-party vectors and 11 metamorphic properties, and **half its mutants
still survived** — because every one of those tests asserts only the final
figure. `docs/04` §7 calls the calculation object "the feature that ends
disputes" and S14 renders it directly, and nothing constrained its contents.
Stryker found that before any human did. That is the argument for `docs/08`
D13 in one measurement.

## Survivors by mutator

| Mutator | Count | Share |
|---|---|---|
| StringLiteral | 77 | 55% |
| ConditionalExpression | 30 | 21% |
| EqualityOperator | 16 | 11% |
| BooleanLiteral | 4 | 3% |
| ArrayDeclaration | 4 | 3% |
| LogicalOperator | 3 | 2% |
| ArithmeticOperator | 3 | 2% |
| ObjectLiteral | 2 | 1% |

## Review status — INCOMPLETE

`docs/08` D13 requires **every** survivor individually reviewed and recorded as
either a missing vector or a justified equivalent mutant. That review is **not
finished**: 141 survivors are categorised below by cluster, not one by one.
Recording the aggregate and saying so is the honest position; claiming the
review is done would be the exact failure D13 exists to prevent.

### Cluster A — prose in `rulesApplied` and error messages (~77, all StringLiteral)

`settle.ts` L66–L102 and `rule4.ts` L316, L333–336 are `RangeError` text,
refusal `reason` text, and the human-readable `rulesApplied` entries.

**Mostly equivalent for money**: mutating the wording of a refusal reason
changes no payout. **But not entirely** — these strings are the settlement
detail view (S14) and the review queue. A mutant that empties a refusal reason
ships a blank explanation to a user asking why they were not paid.

**Verdict: not equivalent, genuinely under-tested.** They need assertions on
the *content* of the explanation, not just its presence. Several already have
them (`toMatch(/VOID, full refund/)`); most do not.

### Cluster B — branch conditions (30 ConditionalExpression + 16 EqualityOperator)

The ones that matter. `rule4.ts` L322–323 is the band-boundary comparison —
`fromExclusive` handling and the `>=` vs `>` at a band edge. `placeTerms.ts`
L137/L143 is the row-matching loop.

**Verdict: real gaps.** A surviving `>=` → `>` at a band boundary means a price
sitting exactly on a published bound is unconstrained, and the boundaries are
precisely where `docs/05` says the bugs live. `rule4.test.ts` asserts all 35
published bounds, so some of these are likely mutants on *unreachable*
combinations — but that has to be checked mutant by mutant, and has not been.

### Cluster C — `ArrayDeclaration`, `ObjectLiteral`, `BooleanLiteral` (10)

`bands: []` → `["Stryker was here"]` survives when no withdrawal exists.
`cappedAt90: false` survives where the cap is untested for that path.

**Verdict: under-tested, cheap to fix.** Assert the empty cases explicitly
rather than only the populated ones.

## What to do next

1. Assert `rulesApplied` content and refusal `reason` content per branch —
   kills most of cluster A and improves the user-facing explanation at the
   same time.
2. Walk cluster B mutant by mutant. Each is either a missing boundary case or
   provably unreachable; record which, per D13.
3. Re-run and record the new score here.

Until then the Phase 0 gate criterion "mutation score ≥90%, every survivor
recorded" is **unmet on both halves**.
