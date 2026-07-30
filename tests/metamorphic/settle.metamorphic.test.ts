import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  lookupRule4Band,
  settle,
  type Rational,
  type SettlementBet,
  type SettlementRace,
  type SettlementRunner,
} from "@/modules/settlement";

/**
 * Layer 2 of docs/08 D20 — properties that hold WITHOUT knowing the answer.
 *
 * Written before settle() existed. The IMPORT NAMES were adapted to the
 * interface S9 chose, exactly as tests/metamorphic/README.md said to do; not
 * one property was weakened to fit the implementation. Property 6 in fact
 * forced a change to settle(): it rounded the each-way SUM, and docs/05 §3.3
 * says total = win_part.return + place_part.return, so each part now rounds
 * its own computation.
 *
 * Read "what they cannot catch" in the README before treating green here as
 * correctness. None of these would have caught the ten-row band error.
 */

const stakeArb = fc.bigInt({ min: 1n, max: 1_000_000n });
const oddsArb = fc.double({ min: 1.01, max: 500, noNaN: true, noDefaultInfinity: true });
const runnersArb = fc.integer({ min: 2, max: 24 });
const positionArb = fc.integer({ min: 1, max: 24 });
const rule4Arb = fc.integer({ min: 0, max: 90 });

const fractionArb = fc.record({
  num: fc.integer({ min: 1, max: 200 }),
  den: fc.integer({ min: 1, max: 200 }),
});

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

function bet(s: Scenario, over: Partial<SettlementBet> = {}): SettlementBet {
  const base: SettlementBet = {
    type: "WIN",
    unitStakeMinor: s.stake,
    totalStakeMinor: s.stake,
    oddsTaken: s.odds,
  };
  return { ...base, ...over };
}

function race(s: Scenario, over: Partial<SettlementRace> = {}): SettlementRace {
  return {
    status: "RESULT",
    actualRunners: s.runners,
    isHandicap: s.isHandicap,
    announcedRule4Pence: s.rule4Pence,
    withdrawals: [],
    ...over,
  };
}

function runner(s: Scenario, over: Partial<SettlementRunner> = {}): SettlementRunner {
  return {
    status: "DECLARED",
    finishPosition: s.position,
    deadHeatCount: 1,
    disqualified: false,
    ...over,
  };
}

/** Settled return, or a hard failure — a review is never expected here. */
function ret(b: SettlementBet, r: SettlementRace, ru: SettlementRunner): bigint {
  return settled(b, r, ru).returnMinor;
}

/** Settled outcome, or a hard failure — a review is never expected here. */
function settled(b: SettlementBet, r: SettlementRace, ru: SettlementRunner) {
  const o = settle(b, r, ru);
  if (o.kind !== "SETTLED") {
    throw new Error(`unexpected review: ${o.reason} — ${o.detail}`);
  }
  return o;
}

/** Exact rational equality by cross multiplication. No division, no float. */
function rationalsEqual(a: Rational, b: Rational): boolean {
  return a.num * b.den === b.num * a.den;
}

/** a x k, as an exact rational. */
function scaleRational(a: Rational, k: bigint): Rational {
  return { num: a.num * k, den: a.den };
}

/** The half-up rounding the engine is required to perform (docs/08 D23). */
function expectedHalfUp(r: Rational): bigint {
  const q = r.num / r.den;
  const rem = r.num % r.den;
  return rem * 2n >= r.den ? q + 1n : q;
}

/** Sum of every part's exact pre-rounding return. */
function exactTotal(o: ReturnType<typeof settled>): Rational {
  return {
    num: BigInt(o.calculation.rounding.exactNumerator),
    den: BigInt(o.calculation.rounding.exactDenominator),
  };
}


describe("1. scaling the stake by k scales the return by exactly k", () => {
  /**
   * docs/08 D23 — split into two exact properties rather than given a
   * tolerance. The rounding error scales with k, so a fixed +/-1 penny band
   * would either still fail at large k or be loose enough to hide the bug it
   * exists to catch.
   */
  it("1a. the PRE-ROUNDING exact value scales exactly, with no tolerance", () => {
    fc.assert(
      fc.property(scenarioArb, fc.bigInt({ min: 2n, max: 1000n }), (s, k) => {
        const single = exactTotal(settled(bet(s), race(s), runner(s)));
        const scaled = exactTotal(
          settled(
            bet(s, { unitStakeMinor: s.stake * k, totalStakeMinor: s.stake * k }),
            race(s),
            runner(s),
          ),
        );
        // Cross-multiplied rational equality. Exact — this is where an
        // arithmetic error shows up, undisguised by rounding.
        expect(
          rationalsEqual(scaled, scaleRational(single, k)),
          `${scaled.num}/${scaled.den} !== ${k} x ${single.num}/${single.den}`,
        ).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("1b. every part's rounded figure is the half-up rounding of its exact value", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        for (const type of ["WIN", "PLACE", "EACH_WAY"] as const) {
          const unit = s.stake;
          const o = settled(
            bet(s, {
              type,
              unitStakeMinor: unit,
              totalStakeMinor: type === "EACH_WAY" ? unit * 2n : unit,
            }),
            race(s),
            runner(s),
          );
          let summed = 0n;
          for (const part of o.calculation.parts) {
            const expected = expectedHalfUp(part.partReturn);
            expect(BigInt(part.partReturnMinor)).toBe(expected);
            summed += expected;
          }
          // docs/05 §3.3: the bet's return is the sum of its parts' returns.
          expect(o.returnMinor).toBe(summed);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe("2. a winner always also places when at least one place is paid", () => {
  it("never returns zero on the place part of a winning bet", () => {
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => s.runners >= 5),
        (s) => {
          const won = { ...s, position: 1 };
          expect(
            ret(bet(won, { type: "PLACE" }), race(won), runner(won)),
          ).toBeGreaterThan(0n);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("3. an n-way dead heat returns exactly 1/n of the clean return", () => {
  it("3a. exact, pre-rounding: tied x n equals clean", () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 2, max: 4 }), (base, n) => {
        const s = { ...base, position: 1, rule4Pence: 0 };
        const b = bet(s);
        const clean = exactTotal(settled(b, race(s), runner(s)));
        const tied = exactTotal(
          settled(b, race(s), runner(s, { deadHeatCount: n })),
        );
        // No need to make the stake divisible by n any more: the exact value
        // carries the division as a denominator instead of losing it.
        expect(
          rationalsEqual(scaleRational(tied, BigInt(n)), clean),
          `${n} x ${tied.num}/${tied.den} !== ${clean.num}/${clean.den}`,
        ).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("3b. the divisor touches the stake, never the odds", () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 2, max: 4 }), (base, n) => {
        const s = { ...base, position: 1, rule4Pence: 0 };
        const o = settled(bet(s), race(s), runner(s, { deadHeatCount: n }));
        const win = o.calculation.parts.find((p) => p.part === "WIN");
        expect(win?.deadHeatTied).toBe(n);
        // effectiveStake = stake x share / n. The odds appear only in winnings.
        expect(win?.effectiveStake.den).toBe(BigInt(n));
      }),
      { numRuns: 500 },
    );
  });
});

describe("4. a Rule 4 deduction never increases the return, never below stake", () => {
  it("keeps the stake whole", () => {
    fc.assert(
      fc.property(
        scenarioArb.filter((s) => s.rule4Pence > 0),
        (s) => {
          const won = { ...s, position: 1 };
          const withR4 = ret(bet(won), race(won), runner(won));
          const without = ret(
            bet(won),
            race(won, { announcedRule4Pence: 0 }),
            runner(won),
          );
          // docs/08 D23: "never increases", not "strictly reduces". At a 1p
          // stake both figures round equal, and that is correct behaviour.
          expect(withR4).toBeLessThanOrEqual(without);
          // docs/05 §5.2 rule 1: the deduction hits winnings only.
          expect(withR4).toBeGreaterThanOrEqual(s.stake);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("5. a shorter withdrawn price never yields a smaller deduction", () => {
  /**
   * The property that LOOKS like it would have caught the ten-row band error
   * and would not have: that table was uniformly shifted, so it stayed
   * monotonic. See the README.
   */
  it("is monotonic across the fractional ladder", () => {
    fc.assert(
      fc.property(fractionArb, fractionArb, (a, b) => {
        // Cross multiplication, never division — docs/08 D14.
        fc.pre(a.num * b.den < b.num * a.den);
        const la = lookupRule4Band(a);
        const lb = lookupRule4Band(b);
        // Scoped to where the function is DEFINED, not weakened: the published
        // scale covers rungs of the ladder, and a price between two bands has
        // no deduction to be monotonic about. It refuses (docs/08 D22), and
        // settle() turns that into NEEDS_REVIEW rather than guessing.
        fc.pre(la.ok && lb.ok);
        if (!la.ok || !lb.ok) return;
        expect(la.band.deduction).toBeGreaterThanOrEqual(lb.band.deduction);
      }),
      { numRuns: 1000 },
    );
  });
});

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
          race(s),
          runner(s),
        );
        const win = ret(bet(s, { type: "WIN" }), race(s), runner(s));
        const place = ret(bet(s, { type: "PLACE" }), race(s), runner(s));
        // If Rule 4 were applied to the win part only, this fails for every
        // scenario with a deduction and a placed runner (docs/08 D16).
        expect(ew).toBe(win + place);
      }),
      { numRuns: 500 },
    );
  });
});

describe("7. a void bet returns exactly the total stake", () => {
  it("refunds in full regardless of odds, deduction or field size", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        expect(
          ret(bet(s), race(s, { status: "VOID" }), runner(s)),
        ).toBe(s.stake);
        expect(
          ret(bet(s), race(s), runner(s, { status: "NON_RUNNER" })),
        ).toBe(s.stake);
      }),
      { numRuns: 500 },
    );
  });
});

describe("8. higher odds never decrease a winner's return", () => {
  it("holds for any pair of prices distinguishable at ODDS_SCALE", () => {
    fc.assert(
      fc.property(scenarioArb, oddsArb, oddsArb, (base, lo, hi) => {
        // docs/08 D23: below ODDS_SCALE's 1e-6 resolution the two prices ARE
        // the same price, and asserting otherwise tests the scale constant.
        fc.pre(hi - lo > 1e-6);
        // Big enough stake that the difference survives rounding to the penny.
        const s = { ...base, position: 1, stake: 100_000n };
        const low = ret(bet(s, { oddsTaken: lo }), race(s), runner(s));
        const high = ret(bet(s, { oddsTaken: hi }), race(s), runner(s));
        expect(high).toBeGreaterThanOrEqual(low);
      }),
      { numRuns: 500 },
    );
  });
});

describe("9. settling twice equals settling once", () => {
  it("is a pure function of its inputs", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const b = bet(s);
        const r = race(s);
        const ru = runner(s);
        // Deep equality, not just the return: the calculation object is
        // persisted and shown to users, so it has to be stable too.
        expect(settle(b, r, ru)).toEqual(settle(b, r, ru));
      }),
      { numRuns: 500 },
    );
  });
});
