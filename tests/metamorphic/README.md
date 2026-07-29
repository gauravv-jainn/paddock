# Metamorphic properties — layer 2 of `docs/08` D20

**These do not compile, and that is the point.** They import `settle()` from
`@/modules/settlement`, which does not exist. They are written now so that the
properties are fixed *before* the implementation, and cannot be quietly bent to
fit whatever it turns out to do.

```bash
pnpm typecheck:metamorphic   # fails: Cannot find module '@/modules/settlement'
pnpm test:metamorphic        # fails the same way
```

They are excluded from `pnpm typecheck` and `pnpm test` so the repo's own gate
stays honest — a permanently-red gate is a gate nobody reads. The two commands
above are the S9 tripwire: when `settle()` lands, they go green or the
properties were wrong.

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
