# 05 — Betting & Settlement Engine

**Status:** Complete.
**This is the most important document in the set.** Everything else is replaceable; this is the product.

⚠️ **Verification required.** The rule tables in §3–§5 reflect standard UK/Irish bookmaking practice, but they vary by bookmaker, by jurisdiction, and over time. Every table below must be verified against a current authoritative source before implementation and re-verified annually. Treat them as a correct *structure* with values requiring confirmation, not as ground truth.

---

## 1. Why this is the hard part

The brief allocates roughly one line to settlement and four thousand words to appearance. The ratio is inverted.

A user who places a £10 each-way bet at 8/1 in a 14-runner handicap where one horse was withdrawn at 2/1 and two horses dead-heat for third expects a specific number. If the platform returns a different number, the product is broken in a way that no interface quality compensates for. This document specifies that number.

**Design constraint:** settlement is a **pure function**.

```ts
function settle(bet: Bet, result: RaceResult, rules: RuleSet): SettlementOutcome
```

No I/O. No clock. No randomness. Same inputs → same output, forever. This is what makes it testable against 200,000 historical races, and what makes re-settlement after a stewards' amendment safe.

---

## 2. Bet types tiered by data requirement

Do not implement by ambition. Implement by what the data supports.

| Tier | Bet types | Data required | Phase |
|---|---|---|---|
| **T1** | Win, Place, Each-Way | Finishing order, non-runners, field size, handicap flag | 0 |
| **T2** | Show (US), Doubles, Trebles, Accumulators | T1 across multiple races | 2 |
| **T3** | Exacta, Quinella, Forecast, Reverse Forecast | Exact finishing order, top 2 | 2 |
| **T4** | Trifecta, Superfecta, Tricast | Exact order, top 3–4 | 2 |
| **T5** | Pick 3/4/5/6, Daily Double, Placepot | Multi-race pools, carryover rules | 3+ |

**T3–T5 have a pricing problem the brief does not address.** These are **pool (pari-mutuel)** bets in most jurisdictions — the dividend is determined by the actual money pool, not by fixed odds. Real dividends are not available in any affordable feed.

Two options:
1. **Virtual pool.** Compute dividends from the platform's own users' stakes. Honest, self-consistent, and interesting as a mechanic — but the dividend will not match reality, and this must be labelled in the UI.
2. **Computed fixed odds.** Derive an approximate price from individual runner odds (e.g. Harville formula for exact-order probability). Approximate, and systematically wrong for favourites.

**Recommendation:** virtual pool, clearly labelled. Fabricating a "real" dividend violates the brief's own honesty principle.

---

## 3. Tier 1 settlement rules

### 3.1 Win

```
if runner.disqualified              → LOST
if runner.status = non_runner       → VOID, refund full stake
if runner.finish_position = 1:
    return = stake × odds_taken × rule4_multiplier ÷ dead_heat_divisor
else                                → LOST
```

### 3.2 Place

Depends entirely on the **place terms** table (§4). A "place" is a top-N finish where N is a function of field size and race type.

```
if runner.status = non_runner       → VOID
place_count = placeTerms(actual_runners, is_handicap, race_type).places
if place_count = 0                  → VOID (field too small for place betting)
if runner.finish_position ≤ place_count:
    return = stake × ((odds_taken − 1) × place_fraction + 1)
             × rule4_multiplier ÷ dead_heat_divisor
else                                → LOST
```

**Note the odds arithmetic.** Place odds are a fraction of the **win part** of the price, not of the whole decimal price. At 9.0 decimal (8/1) with 1/5 terms: `(9.0 − 1) × 0.2 + 1 = 2.6`, not `9.0 × 0.2 = 1.8`. Getting this wrong is the single most common settlement bug in amateur implementations.

### 3.3 Each-Way

An each-way bet is **two independent bets** of equal stake: one Win, one Place. Total outlay is `2 × unit_stake`.

```
win_part   = settleWin(bet, result)
place_part = settlePlace(bet, result)
total_return = win_part.return + place_part.return

status:
  both won             → WON
  place only           → PARTIAL   (won the place, lost the win)
  both lost            → LOST
  either void          → PARTIAL or VOID as appropriate
```

**Model each-way as two `bet_legs` rows in the schema, not as a special case in the settlement code.** This keeps `settle()` small and makes the audit trail self-explanatory.

---

## 4. Each-way place terms — the table that must be verified

Standard UK/Irish terms. **These are the values to confirm before implementation.**

| Runners | Race type | Places paid | Fraction of odds |
|---|---|---|---|
| 1–4 | any | 0 (win only) | — |
| 5–7 | any | 2 | 1/4 |
| 8+ | non-handicap | 3 | 1/5 |
| 8–11 | handicap | 3 | 1/5 |
| 12–15 | handicap | 3 | 1/4 |
| 16+ | handicap | 4 | 1/4 |

```ts
interface PlaceTerms { places: number; fraction: number }

export function placeTerms(
  runners: number,
  isHandicap: boolean,
): PlaceTerms {
  if (runners <= 4)  return { places: 0, fraction: 0 };
  if (runners <= 7)  return { places: 2, fraction: 0.25 };
  if (!isHandicap)   return { places: 3, fraction: 0.20 };
  if (runners <= 11) return { places: 3, fraction: 0.20 };
  if (runners <= 15) return { places: 3, fraction: 0.25 };
  return { places: 4, fraction: 0.25 };
}
```

### 4.1 The critical subtlety: which runner count?

Place terms are determined by the **number of runners that actually start**, not the number declared. If a 16-runner handicap has one non-runner, it becomes 15 runners → **4 places drops to 3 places**.

**Consequence:** a bet placed when the field showed 16 runners settles on 3-place terms if a horse is withdrawn. The user who backed a horse that finished 4th loses, having placed the bet believing 4 places would be paid. This is correct bookmaking behaviour and it will generate support complaints. `settlements.calculation` must explain it explicitly in the UI: *"Place terms reduced from 4 to 3 — field reduced to 15 runners."*

**Implementation rule:** always compute place terms from `races.actual_runners` at settlement time, never cache the terms at placement time.

---

## 5. Rule 4 deductions

When a horse is withdrawn after the market has formed but before the race, remaining runners' true chances increase. Fixed-odds bets already struck at the old price are reduced by a deduction based on the withdrawn horse's price at withdrawal.

### 5.1 The table (Tattersalls Rule 4 — verify before use)

| Odds of withdrawn horse (decimal) | Deduction (pence per £1) |
|---|---|
| ≤ 1.11 | 90p |
| 1.12 – 1.18 | 85p |
| 1.19 – 1.25 | 80p |
| 1.26 – 1.30 | 75p |
| 1.31 – 1.40 | 70p |
| 1.41 – 1.53 | 65p |
| 1.54 – 1.62 | 60p |
| 1.63 – 1.80 | 55p |
| 1.81 – 2.20 | 50p |
| 2.21 – 2.50 | 45p |
| 2.51 – 2.75 | 40p |
| 2.76 – 3.25 | 35p |
| 3.26 – 4.00 | 30p |
| 4.01 – 5.00 | 25p |
| 5.01 – 6.00 | 20p |
| 6.01 – 7.00 | 15p |
| 7.01 – 10.00 | 10p |
| 10.01 – 15.00 | 5p |
| > 15.00 | 0p |

### 5.2 Application

```ts
/** Applied to WINNINGS ONLY, never to the returned stake. */
function applyRule4(
  stakeMinor: bigint,
  oddsDecimal: number,
  deductionPence: number,
): bigint {
  const grossWinnings = BigInt(Math.round(Number(stakeMinor) * (oddsDecimal - 1)));
  const retained = BigInt(100 - deductionPence);
  const netWinnings = (grossWinnings * retained) / 100n;   // integer division
  return netWinnings + stakeMinor;                          // stake never deducted
}
```

**Three rules that are easy to get wrong:**
1. The deduction applies to **winnings**, not to total return, and never to the stake.
2. Multiple withdrawals **accumulate**, capped at 90p in the £ total.
3. Bets placed **after** the withdrawal, at the new price, are **not** subject to the deduction. This requires comparing `bets.placed_at` against the withdrawal timestamp — so the withdrawal timestamp must be persisted, not just the flag.

---

## 6. Dead heats

Two or more horses finish inseparable. The stake is proportionally reduced.

```
divisor = number of horses dead-heating for that position
          ÷ number of available positions at that place

Standard case: 2 horses dead-heat for 1st → divisor = 2
               stake is halved; the halved stake is settled at full odds;
               the other half is lost.

return = (stake ÷ divisor) × odds   [+ apply Rule 4 if applicable]
```

**Worked example.** £10 win at 5.0 decimal, two-way dead heat for 1st:
```
effective stake = £10 ÷ 2 = £5
return          = £5 × 5.0 = £25
profit          = £25 − £10 = £15   (not £40)
```

### 6.1 Dead heats interacting with place terms

The genuinely difficult case. Three horses dead-heat for 3rd in a race paying 3 places. There is one place remaining (positions 1 and 2 are taken) shared between three horses.

```
divisor = horses_dead_heating ÷ places_remaining_at_that_position
        = 3 ÷ 1 = 3
```

Each backer receives one third of their stake settled at place terms.

```ts
function deadHeatDivisor(
  horsesTied: number,
  positionsAvailable: number,
): number {
  return horsesTied / Math.max(positionsAvailable, 1);
}
```

`positionsAvailable = placesPaid − (position − 1)`, floored at 0.

**Test vectors required:** dead heat for 1st (2-way, 3-way), dead heat for last paid place with 2 and 3 horses, dead heat combined with a Rule 4 deduction, dead heat on the win part of an each-way bet where the place part is unaffected.

---

## 7. Voids, refunds and reversals

| Event | Outcome |
|---|---|
| Non-runner (single bet) | VOID, full stake refunded |
| Non-runner (leg of a multiple) | That leg voided at odds 1.0; remaining legs settle. A 4-fold becomes a treble. |
| Race abandoned | All bets VOID, full refund |
| Race postponed | Bets stand if run same day; VOID if not — a configurable `RuleSet` parameter, not a hardcoded constant |
| Meeting abandoned mid-card | Completed races settle; remaining VOID |
| Disqualification (post-race) | Result amended, `result_version` increments, re-settlement runs |
| Stewards' enquiry pending | Race held in `UNDER_REVIEW`; **do not settle** |

### 7.1 Re-settlement

```
on result_version increment:
  1. load prior settlements for the race at version N
  2. compute new settlements at version N+1
  3. for each bet: delta = new_return − old_return
  4. write compensating ledger entries for the delta
  5. write settlement row with is_reversal = true, preserving both
  6. notify affected users with a before/after explanation
```

**Never mutate a prior settlement.** Both states remain visible. A user who watched their balance change must be able to see exactly why. This is also what makes the double-entry ledger worth the extra complexity.

**Negative balance is permitted.** If a reversal takes a user below zero, allow it and surface it. Silently clamping to zero destroys the ledger invariant and hides a real event.

---

## 8. Testing strategy

> Amended by `docs/08-decision-log.md`. Branch coverage alone was the bar here
> and it was not sufficient — see §8.0.

**Bar: 100% branch coverage on `settle()` AND a Stryker mutation score of
≥ 90% over `src/modules/settlement/`, with every surviving mutant
individually reviewed. No exceptions, no waivers on either half.**

### 8.0 Why coverage alone is not the bar

Branch coverage measures which lines ran. It does not measure whether anything
would have noticed if they returned the wrong answer.

This is not a theoretical concern in this repository. Two tests named
`rejects an UPDATE on ledger_entries` and `rejects a DELETE on ledger_entries`
executed the trigger path, reported green, and asserted nothing: they ran
against an empty table, where a row-level `BEFORE` trigger never fires and the
statement trivially succeeds. A later audit found five more tests in the same
class — including a property test that generated only balanced transactions and
so held no matter what the code under test did, and a "crosses a British Summer
Time boundary" test that could not detect a local-time implementation because
the host machine has no DST.

Every one of those had coverage. A mutation score would have caught all of them,
because a mutation score asks the only question that matters: **if I break this,
does a test fail?**

`settle()` is the product. It gets the stronger bar.

### 8.0.1 The target, and why 90

| Bar | Verdict |
|---|---|
| 100% | Not reachable, and an unreachable bar gets waived. Equivalent mutants exist that no test can kill — reordering independent guard clauses, or `>=` vs `>` at a boundary that validated inputs cannot reach. |
| 80% | The common default, and too low here. Settlement has on the order of a dozen branches that each decide a payout; 20% surviving is two or three live rules that no vector constrains. |
| **90%** | High enough that a whole rule cannot go unconstrained, low enough to be honestly achievable, so nobody negotiates it down. |

**The number is not the real bar — the survivor review is.** Every surviving
mutant is one of exactly two things, and which one must be written down in
`tests/mutation-survivors.md`:

1. **A missing golden vector.** The mutant changes behaviour on some real race
   and no fixture covers that race. Fix by adding the vector, not by adding a
   test that asserts the current output.
2. **A genuinely equivalent mutant.** The mutant cannot change behaviour for any
   input the type system and validation permit. Record the argument.

A survivor with no entry is a failure regardless of the score.

### 8.0.2 Scope and mechanics

- Scope is `src/modules/settlement/` only — the rule tables and `settle()`.
  Running Stryker across the whole codebase is slow and would dilute the signal.
- The golden vectors in `tests/golden/` are the test set. A mutation score
  computed against self-authored tests measures self-consistency, which is the
  same mistake in a different costume.
- Stryker is **not yet installed**. It arrives with S9, when there is a
  `settle()` to mutate. Installing it earlier would mutate code that does not
  exist.
- CI runs it on changes touching `src/modules/settlement/`. It is too slow for
  every commit and too important to run only by hand.

### 8.1 Golden vectors
Assemble ≥200 historical races with known official settlements from the archive. Required composition:
- ≥10 races with dead heats (including at least one 3-way, and one for the final paid place)
- ≥10 races with Rule 4 deductions (including one with multiple withdrawals)
- ≥20 races with non-runners (including at least three that change the place-terms band)
- ≥5 races with post-race disqualifications
- ≥5 abandoned or voided races
- Field sizes spanning every band boundary: 4, 5, 7, 8, 11, 12, 15, 16 runners, handicap and non-handicap

Boundary races are where the bugs live. Test 15 and 16 runners, not 14 and 20.

### 8.2 Property-based tests

```
∀ bet, result:  settle(bet, result) is deterministic
∀ bet, result:  Σ(ledger entries) = 0
∀ bet, result:  return_minor ≥ 0
∀ bet, result:  bet.status = 'void' ⟹ return_minor = bet.total_stake_minor
∀ bet:          settle(bet, r) applied twice = applied once   (idempotence)
∀ race:         Σ(all user returns) ≤ Σ(all user stakes) + house_wallet_balance
```

### 8.3 Money arithmetic

All monetary computation in `BigInt` minor units. Rounding is **half-up, in the user's favour on ties**, applied once at the end of the computation and never at intermediate steps. Every rounding decision is recorded in `settlements.calculation`.

```ts
// WRONG — compounds error across steps
const a = round(stake * fraction);
const b = round(a * odds);

// RIGHT — one rounding, at the end
const exact = stakeMinor * BigInt(Math.round(fraction * odds * 1000));
const result = (exact + 500n) / 1000n;
```

---

## 9. Bet lifecycle state machine

```
                    ┌──────────┐
     place ───────► │   OPEN   │
                    └────┬─────┘
                         │
        ┌────────────────┼──────────────┬─────────────┐
        │                │              │             │
   user cancels     race result    non-runner    race abandoned
   (before          published      / withdrawn
    suspension)          │              │             │
        │                │              │             │
        ▼                ▼              ▼             ▼
   ┌──────────┐   ┌─────────────┐  ┌────────┐   ┌────────┐
   │CANCELLED │   │ WON/PARTIAL │  │  VOID  │   │  VOID  │
   │          │   │   /LOST     │  │        │   │        │
   └──────────┘   └──────┬──────┘  └────────┘   └────────┘
                         │
                  stewards' amendment
                         │
                         ▼
                  ┌─────────────┐
                  │ RE-SETTLED  │  (new settlement row, prior preserved)
                  └─────────────┘
```

**Cancellation rules.** A bet is cancellable only while `races.status = 'open'` and `now() < off_time − 60s`. Once the market suspends, the bet stands. Real books do not allow cancellation, and allowing it makes the analytics meaningless — users would cancel losers. Phase 0 should arguably disable cancellation entirely; a 30-second "undo" immediately after placement gives the same UX benefit without the integrity cost.

---

## 10. What this engine deliberately does not do

- **No fixed-odds pricing model.** Odds come from the provider. Building a pricing model is a different product.
- **No liability management.** There is no book to balance; the house wallet can go arbitrarily negative.
- **No bet limits or exposure caps.** No real risk exists.
- **No cash-out.** Requires live in-play pricing and a liability model. Phase 3 at the earliest, and only with real in-play data.
