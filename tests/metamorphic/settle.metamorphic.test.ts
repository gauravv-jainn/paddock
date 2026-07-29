import fc from "fast-check";
import { describe, expect, it } from "vitest";
// DOES NOT EXIST YET. See tests/metamorphic/README.md — this file is expected
// to fail to compile until S9 writes settle(). The import names below are the
// contract these properties assume; if S9 chooses different ones, change them
// here rather than weakening a property to fit.
import { settle, type Bet, type RaceResult, type RuleSet } from "@/modules/settlement";

/**
 * Layer 2 of docs/08 D20 — properties that hold WITHOUT knowing the answer.
 *
 * Written before settle() on purpose. A property invented after seeing an
 * implementation tends to describe that implementation rather than the domain.
 *
 * Read the "what they cannot catch" section of the README before treating a
 * green run here as correctness. It is not.
 */

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const stakeArb = fc.bigInt({ min: 1n, max: 1_000_000n });
const oddsArb = fc.double({ min: 1.01, max: 500, noNaN: true, noDefaultInfinity: true });
const runnersArb = fc.integer({ min: 2, max: 24 });
const positionArb = fc.integer({ min: 1, max: 24 });
const rule4Arb = fc.integer({ min: 0, max: 90 });

/** A fractional price as an integer pair — docs/08 D14. Never a decimal. */
const fractionArb = fc.record({
  num: fc.integer({ min: 1, max: 200 }),
  den: fc.integer({ min: 1, max: 200 }),
});

const RULES: RuleSet = {} as RuleSet;

interface Scenario {
  stake: bigint;
  odds: number;
  runners: number;
  isHandicap: boolean;
  position: number;
  rule4Pence: number;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  stake: stakeArb,
  odds: oddsArb,
  runners: runnersArb,
  isHandicap: fc.boolean(),
  position: positionArb,
  rule4Pence: rule4Arb,
});

function bet(s: Scenario, over: Partial<Bet> = {}): Bet {
  return {
    type: "WIN",
    totalStakeMinor: s.stake,
    unitStakeMinor: s.stake,
    oddsTaken: s.odds,
    ...over,
  } as Bet;
}

function result(s: Scenario, over: Partial<RaceResult> = {}): RaceResult {
  return {
    status: "RESULT",
    actualRunners: s.runners,
    isHandicap: s.isHandicap,
    rule4Pence: s.rule4Pence,
    positions: [{ runnerId: "1", position: s.position, deadHeatWith: [], disqualified: false }],
    nonRunners: [],
    ...over,
  } as RaceResult;
}

const ret = (b: Bet, r: RaceResult): bigint => settle(b, r, RULES).returnMinor;

// ---------------------------------------------------------------------------
// 1. Linearity
// ---------------------------------------------------------------------------

describe("1. scaling the stake by k scales the return by exactly k", () => {
  it("holds for any k", () => {
    fc.assert(
      fc.property(scenarioArb, fc.bigInt({ min: 2n, max: 1000n }), (s, k) => {
        const single = ret(bet(s), result(s));
        const scaled = ret(
          bet({ ...s, stake: s.stake * k }, { totalStakeMinor: s.stake * k }),
          result(s),
        );
        // Exact, not approximate. A per-part rounding would break this by a
        // penny and a penny per bet is a real defect in a ledger.
        expect(scaled).toBe(single * k);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. A winner places
// ---------------------------------------------------------------------------

describe("2. a winner always also places when at least one place is paid", () => {
  it("never returns zero on the place part of a winning each-way bet", () => {
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => s.runners >= 5),
        (s) => {
          const won = { ...s, position: 1 };
          const placeReturn = ret(bet(won, { type: "PLACE" }), result(won));
          expect(placeReturn).toBeGreaterThan(0n);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Dead heats divide the stake, not the odds
// ---------------------------------------------------------------------------

describe("3. an n-way dead heat returns exactly 1/n of the clean return", () => {
  it("divides the stake and leaves the odds alone", () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 2, max: 4 }), (base, n) => {
        const s = { ...base, position: 1, rule4Pence: 0 };
        // Stake divisible by n so the relationship is exact and the property
        // is not really testing the rounding rule.
        const stake = s.stake * BigInt(n);
        const clean = ret(
          bet({ ...s, stake }, { totalStakeMinor: stake }),
          result(s),
        );
        const tied = ret(
          bet({ ...s, stake }, { totalStakeMinor: stake }),
          result(s, {
            positions: [
              {
                runnerId: "1",
                position: 1,
                deadHeatWith: Array.from({ length: n - 1 }, (_, i) => String(i + 2)),
                disqualified: false,
              },
            ],
          } as Partial<RaceResult>),
        );
        expect(tied * BigInt(n)).toBe(clean);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Rule 4 reduces winnings, never the stake
// ---------------------------------------------------------------------------

describe("4. a Rule 4 deduction strictly reduces the return, never below the stake", () => {
  it("keeps the stake whole", () => {
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => s.rule4Pence > 0),
        (s) => {
          const won = { ...s, position: 1 };
          const withR4 = ret(bet(won), result(won));
          const without = ret(bet(won), result({ ...won, rule4Pence: 0 }));

          expect(withR4).toBeLessThan(without);
          // docs/05 §5.2 rule 1: the deduction hits winnings only.
          expect(withR4).toBeGreaterThanOrEqual(s.stake);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Monotonic bands
// ---------------------------------------------------------------------------

describe("5. a shorter withdrawn price never yields a smaller deduction", () => {
  /**
   * NOTE: this is the property that LOOKS like it would have caught the
   * ten-row band error in docs/05 §5.1, and would not have. That table was
   * uniformly shifted by one rung, so it stayed monotonic. See the README.
   */
  it("is monotonic across the fractional ladder", () => {
    fc.assert(
      fc.property(fractionArb, fractionArb, (a, b) => {
        // Cross multiplication, never division — docs/08 D14.
        const aShorter = a.num * b.den < b.num * a.den;
        fc.pre(aShorter);
        const dA = deductionFor(a);
        const dB = deductionFor(b);
        expect(dA).toBeGreaterThanOrEqual(dB);
      }),
      { numRuns: 1000 },
    );
  });
});

/** Provided by S8's rule tables; imported here so the property can be stated. */
declare function deductionFor(price: { num: number; den: number }): number;

// ---------------------------------------------------------------------------
// 6. Each-way is two bets — docs/08 D16
// ---------------------------------------------------------------------------

describe("6. each-way return equals the independent win and place parts", () => {
  it("holds with a Rule 4 deduction applied, which is where D16 bites", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const unit = s.stake;
        const ew = ret(
          bet(s, {
            type: "EACH_WAY",
            unitStakeMinor: unit,
            totalStakeMinor: unit * 2n,
          }),
          result(s),
        );
        const win = ret(bet(s, { type: "WIN", totalStakeMinor: unit }), result(s));
        const place = ret(bet(s, { type: "PLACE", totalStakeMinor: unit }), result(s));
        // If Rule 4 were applied to the win part only, this fails for every
        // scenario with rule4Pence > 0 and a placed runner.
        expect(ew).toBe(win + place);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Void
// ---------------------------------------------------------------------------

describe("7. a void bet returns exactly the total stake", () => {
  it("refunds in full regardless of odds, deduction or field size", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const voided = ret(
          bet(s),
          result(s, { status: "VOID" } as Partial<RaceResult>),
        );
        expect(voided).toBe(s.stake);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Odds monotonicity
// ---------------------------------------------------------------------------

describe("8. higher odds strictly increase a winner's return", () => {
  it("holds for any pair of prices", () => {
    fc.assert(
      fc.property(scenarioArb, oddsArb, oddsArb, (base, lo, hi) => {
        fc.pre(lo < hi);
        const s = { ...base, position: 1 };
        // Big enough stake that the difference survives rounding to the penny.
        const stake = 100_000n;
        const low = ret(bet({ ...s, odds: lo }, { totalStakeMinor: stake }), result(s));
        const high = ret(bet({ ...s, odds: hi }, { totalStakeMinor: stake }), result(s));
        expect(high).toBeGreaterThan(low);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Idempotence
// ---------------------------------------------------------------------------

describe("9. settling twice equals settling once", () => {
  it("is a pure function of its inputs", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const b = bet(s);
        const r = result(s);
        const first = settle(b, r, RULES);
        const second = settle(b, r, RULES);
        // Deep equality, not just the return: the calculation object is
        // persisted and shown to users, so it has to be stable too.
        expect(second).toEqual(first);
      }),
      { numRuns: 500 },
    );
  });
});
