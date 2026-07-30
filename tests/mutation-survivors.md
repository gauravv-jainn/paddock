# Mutation gates — `src/modules/settlement/`

**Two gates, per `docs/08` D24.** One number hid two different problems: most
survivors were prose, but the ones that mattered were payout-deciding branch
conditions, and a single percentage let the second hide behind the first.

| Gate | Scope | Bar | Command |
|---|---|---|---|
| **A** | arithmetic + branch mutants | **100%, no waivers** | `pnpm mutation:a` |
| **B** | StringLiteral + Regex | snapshots, not a score | `pnpm mutation:b` |

Stryker 9.6.1 · scoped to `src/modules/settlement/` · measured 2026-07-30

## Result

| Gate | Score | Killed | Survived | No coverage |
|---|---|---|---|---|
| **A** | **100.00%** | 709 | **0** | 0 |
| **B** | **100.00%** | 234 | **0** | 0 |

Per file, both gates:

| File | Gate A | Gate B |
|---|---|---|
| `rules/fraction.ts` | 100.00% | 100.00% |
| `rules/placeTerms.ts` | 100.00% | 100.00% |
| `rules/rule4.ts` | 100.00% | 100.00% |
| `read.ts` | 100.00% | n/a — no string literals |
| `schema.ts` | 100.00% | 100.00% |
| `settle.ts` | 100.00% | 100.00% |
| `settleRace.ts` | 100.00% | 100.00% |

**`docs/08` D13 is satisfied without waivers: there are no survivors to
record.** That is the only honest way to close it — the requirement is that
every survivor is individually reviewed and classified, and an empty set is the
one case where that is trivially complete.

### History

| When | Gate A | What changed |
|---|---|---|
| first run (combined) | 49.85% | Stryker installed. `settle.ts` at 34.4%. |
| after `settle.test.ts` | 78.61% | 52 tests asserting the calculation object. |
| gates split (D24) | 87.38% | Gate A isolated. 64 survivors, 59 in `settle.ts`. |
| after S12 worker tests | 95.24% | `settleRace.ts` reached 96%. |
| **Step 9** | **100.00%** | Below. |

The first run is still the interesting number. The engine already passed 29
third-party vectors and 11 metamorphic properties, and **half its mutants
survived** — because every one of those tests asserted only the final figure.
`docs/04` §7 calls the calculation object "the feature that ends disputes" and
S14 renders it directly; nothing constrained its contents. Stryker found that
before any human did.

---

## What closing Gate A actually required

Four of the last survivors were not missing tests. They were **code that could
not be wrong**, which a mutation gate correctly refuses to accept.

### 1. Two rule-table guards that the row order made unreachable

`lookupRule4Band` checks `fromExclusive` on row 19 ("over 14/1"). `lookupPlaceTerms`
checks `actualRunners < row.minRunners`. Against the shipped tables, **neither
can ever fire**: row 18 ("10/1 - 14/1") is checked before row 19, and the
place-terms rows ascend contiguously from 1. Nothing could distinguish either
guard from its own absence.

Both guards exist to make the lookup **order-independent**. That is a real
property worth having — `docs/08` records a ten-row *ordering* error in this
very table — but it was an untested assumption.

Fix: both lookups now take the table as a defaulted parameter, and the tests
search a **reversed** table and assert an identical answer for every published
bound. The guards are exercised for real, and order-independence is now a
verified property rather than a hope. Production never passes the parameter.

### 2. A dead null-check in `resolveRule4`

`bands.length > 0 ? "computed-confirmed" : null` — `bands` is provably
non-empty at that point, because the `withdrawn.length === 0` early return
above means the loop ran at least once. Removed. A branch that reads as a
safety check while being unreachable is worse than no check: it implies a case
that cannot happen.

### 3. A dead `isReversal` flag in `creditReturn`

Reversals post their own compensating entries in `reversePriorSettlement` and
never route through `creditReturn`, so its negative arm was unreachable code
pretending to be a safeguard. Parameter removed.

### 4. Guards genuinely unreachable through the public path

`roundHalfUp`'s non-positive-denominator check, and the runner-status and
withdrawal-fraction guards in the row mappers, cannot be reached through
`settle()` or `settleRace()` — the database's CHECK constraints forbid the rows
that would trigger them. They are worth keeping: each prevents a *silent*
failure (a division by zero producing a nonsense payout; a `status: undefined`
comparing false against every literal and settling a withdrawn horse as a
normal runner).

Fix: `roundHalfUp`, `toSettlementRace` and `toSettlementRunner` are exported and
tested directly. An untested guard is a guess about behaviour nobody has run.

### 5. A real drift risk the gate exposed

`schema.ts`'s constraint declarations had no test at all — the drizzle literal
only feeds `drizzle-kit generate`, while the constraints that exist come from
the applied migration. The declaration could have lost the idempotence unique
index and every test would have stayed green, because the database still had
the one an earlier migration created. `schema.db.test.ts` now asserts both
halves and that they agree, including the two foreign keys migration 0014 adds
by hand.

---

## Gate B — snapshots, deliberately not a score

`docs/08` D24 says Gate B is constrained by snapshot assertions rather than by a
percentage, and the reason matters: **a score target on wording rewards
asserting that strings are non-empty**, which pins nothing and reads as
coverage. That is the exact failure mode D13 exists to prevent, one level up.

`tests/snapshots/explanations.test.ts` pins the full `rulesApplied` array, the
refusal reason and detail, and every programmer-error message, across 28
scenarios — clean win, clean loss, non-runner, reserve, three race-level void
states, disqualification, each-way placed in both handicap and non-handicap,
unplaced, outside the places, no-places fields, two- and three-way dead heats,
announced and band-table Rule 4, the 90p cap, enhanced terms, and all three
refusals.

Every one of those strings is rendered on the settlement detail screen. A
reworded explanation is not a bug, but it **is** a change to what the product
tells a user about their money. A snapshot makes changing one a deliberate act
in front of a reviewer rather than a side effect.

Adding the snapshots took Gate B from 86.32% to 97.44% on its own. The last six
were closed with ordinary assertions that were worth having regardless — the
Rule 4 `source` label, the disputed-band string, the place part's three outcome
labels, the error type's `name`, and two refusal `detail` messages that named
nothing a log reader could act on.

**The score is reported for information. The gate is the snapshots.**

## Running them

```bash
pnpm mutation:a   # breaks below 100
pnpm mutation:b   # reports; not score-gated
```

`pnpm verify` runs both. `pnpm verify:fast` skips them.
