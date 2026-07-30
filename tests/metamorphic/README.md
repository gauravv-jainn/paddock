# Metamorphic properties — layer 2 of `docs/08` D20

**Status: green, and part of the default gate.** These were written before
`settle()` existed and failed to compile until S9 landed — deliberately, so the
properties were fixed before the implementation and could not be quietly bent
to fit it. They now run in `pnpm test` and `pnpm test:settlement`.

They did their job. Property 6 forced a real change: `settle()` rounded the
each-way SUM, and `docs/05` §3.3 says the total is the sum of the parts'
returns, so each part now rounds its own computation. Property 5 forced
another: the band lookup threw for a price between two published bands, and
`docs/08` D22 turned that into a refusal.

Properties 1 and 3 are each SPLIT in two (`docs/08` D23) — one asserting exact
linearity on the pre-rounding rational, one asserting the rounding itself.
Tolerance widening was rejected: the error scales with k, so a fixed band
either still fails or hides the bug it exists to catch.

## What a metamorphic property is, and why it is here

Ordinary tests need a known answer. `docs/08` D20 accepts that the archive
cannot supply one — there are no hand-computed golden vectors for archive races.

A metamorphic property does not need the answer. It states a **relationship
between two runs**: double the stake and the return doubles, whatever the return
was. If `settle()` is wrong but *consistently* wrong, the relationship still
holds — which is precisely the limit recorded in D20's residual risk.

## The nine properties

| # | Property | Catches |
|---|---|---|
| 1 | scaling stake by k scales return by exactly k | non-linearity, fixed fees, rounding applied per-part |
| 2 | a winner always also places when places ≥ 1 | place logic that excludes the winner |
| 3 | an n-way dead heat returns exactly 1/n of the clean return | dividing the odds instead of the stake |
| 4 | a Rule 4 deduction strictly reduces return, never below stake | deduction applied to the stake; sign errors; >90p |
| 5 | a shorter withdrawn price never yields a smaller deduction | non-monotonic band table; inverted lookup |
| 6 | each-way return = independent win + place parts | D16 — Rule 4 applied to only one part |
| 7 | void always returns exactly the total stake | partial refunds on a void |
| 8 | higher odds_taken strictly increases a winner's return | odds ignored, or read as fractional |
| 9 | settling twice equals settling once | non-determinism; hidden clock or accumulator |

## What they cannot catch — read before trusting them

**None of the nine would have caught the ten-row Rule 4 band error** this
project found in `docs/05` §5.1, where every band from "Evens" upward was one
rung too severe.

Property 5 is the one that looks like it should. It does not: the erroneous
table was **uniformly shifted**, so it was still monotonic. Monotonicity is
exactly the property a systematic one-rung shift preserves.

Every other property is satisfied by any internally-consistent table, right or
wrong. That is the same blind spot as D20's layer 3 — two independent
implementations reading the *same* wrong table agree with each other perfectly.

**Only layer 1 catches a wrong band value**, because only layer 1 carries
numbers computed by someone else. Currently that is 5 of 19 bands. See the
session report and `docs/05` §5.1.
