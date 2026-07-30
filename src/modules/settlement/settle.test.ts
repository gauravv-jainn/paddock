import { describe, expect, it } from "vitest";
import { roundHalfUp, settle } from "./settle";
import type {
  SettlementBet,
  SettlementRace,
  SettlementRunner,
} from "./types";

/**
 * settle() unit tests, aimed squarely at the CALCULATION OBJECT.
 *
 * docs/04 §7 calls it "the feature that ends disputes" and S14 renders it
 * directly. The published vectors only ever assert the final number, so every
 * intermediate the user is shown was unconstrained until this file existed —
 * a gap Stryker made visible before any human did.
 */

const bet = (over: Partial<SettlementBet> = {}): SettlementBet => ({
  type: "WIN",
  unitStakeMinor: 1000n,
  totalStakeMinor: 1000n,
  oddsTaken: 5,
  ...over,
});

const race = (over: Partial<SettlementRace> = {}): SettlementRace => ({
  status: "RESULT",
  actualRunners: 10,
  isHandicap: false,
  announcedRule4Pence: 0,
  withdrawals: [],
  ...over,
});

const runner = (over: Partial<SettlementRunner> = {}): SettlementRunner => ({
  status: "DECLARED",
  finishPosition: 1,
  deadHeatCount: 1,
  disqualified: false,
  ...over,
});

function settled(b = bet(), r = race(), ru = runner()) {
  const o = settle(b, r, ru);
  if (o.kind !== "SETTLED") throw new Error(`review: ${o.reason} ${o.detail}`);
  return o;
}

function review(b = bet(), r = race(), ru = runner()) {
  const o = settle(b, r, ru);
  if (o.kind !== "NEEDS_REVIEW") throw new Error("expected NEEDS_REVIEW");
  return o;
}

describe("programmer error throws; business outcomes do not", () => {
  it.each([
    ["zero stake", { unitStakeMinor: 0n, totalStakeMinor: 0n }],
    ["negative stake", { unitStakeMinor: -1n, totalStakeMinor: -1n }],
    ["odds of exactly 1", { oddsTaken: 1 }],
    ["odds below 1", { oddsTaken: 0.5 }],
    ["non-finite odds", { oddsTaken: Number.POSITIVE_INFINITY }],
    ["EW total not twice unit", { type: "EACH_WAY" as const, totalStakeMinor: 1000n }],
    ["WIN total not equal to unit", { totalStakeMinor: 2000n }],
  ])("%s throws RangeError", (_label, over) => {
    expect(() => settle(bet(over), race(), runner())).toThrow(RangeError);
  });

  it("throws on an out-of-range announced deduction", () => {
    expect(() => settle(bet(), race({ announcedRule4Pence: 91 }), runner())).toThrow(
      RangeError,
    );
    expect(() => settle(bet(), race({ announcedRule4Pence: -1 }), runner())).toThrow(
      RangeError,
    );
  });
});

describe("step 1 — void paths refund the whole stake", () => {
  it.each(["NON_RUNNER", "RESERVE"] as const)("runner %s voids", (status) => {
    const o = settled(bet(), race(), runner({ status }));
    expect(o.status).toBe("VOID");
    expect(o.returnMinor).toBe(1000n);
    expect(o.calculation.rulesApplied[0]).toMatch(/VOID, full refund/);
  });

  it.each(["VOID", "ABANDONED", "POSTPONED"] as const)("race %s voids", (status) => {
    const o = settled(bet(), race({ status }), runner());
    expect(o.status).toBe("VOID");
    expect(o.returnMinor).toBe(1000n);
    expect(o.calculation.rulesApplied[0]).toMatch(/race.status/);
  });

  it("refunds an each-way bet's FULL outlay, not one unit", () => {
    const o = settled(
      bet({ type: "EACH_WAY", unitStakeMinor: 1000n, totalStakeMinor: 2000n }),
      race(),
      runner({ status: "NON_RUNNER" }),
    );
    expect(o.returnMinor).toBe(2000n);
  });

  it("voids even when the race owed a deduction", () => {
    const o = settled(
      bet(),
      race({ announcedRule4Pence: 40 }),
      runner({ status: "NON_RUNNER" }),
    );
    expect(o.returnMinor).toBe(1000n);
  });
});

describe("step 2 — disqualification", () => {
  it("loses, returns nothing, and says so", () => {
    const o = settled(bet(), race(), runner({ disqualified: true }));
    expect(o.status).toBe("LOST");
    expect(o.returnMinor).toBe(0n);
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/disqualified -> LOST/);
  });

  it("beats a winning finishing position", () => {
    const o = settled(bet(), race(), runner({ finishPosition: 1, disqualified: true }));
    expect(o.returnMinor).toBe(0n);
  });
});

describe("the calculation object records the WIN part in full", () => {
  const o = settled(bet({ oddsTaken: 5 }), race({ announcedRule4Pence: 20 }));
  const part = o.calculation.parts.find((p) => p.part === "WIN")!;

  it("records the stake, the effective stake and both winnings figures", () => {
    expect(part.stakeMinor).toBe(1000n);
    // No dead heat: effective stake is the whole stake.
    expect(part.effectiveStake.num / part.effectiveStake.den).toBe(1000n);
    // £10 at 5.0 wins £40 gross; 20p in the £ leaves £32.
    expect(part.grossWinnings.num / part.grossWinnings.den).toBe(4000n);
    expect(part.netWinnings.num / part.netWinnings.den).toBe(3200n);
    expect(part.partReturnMinor).toBe("4200");
    expect(part.outcome).toBe("won");
    expect(part.rule4Pence).toBe(20);
  });

  it("records the deduction and its provenance", () => {
    expect(o.calculation.rule4.applied).toBe(true);
    expect(o.calculation.rule4.totalPence).toBe(20);
    expect(o.calculation.rule4.source).toBe("announced");
    expect(o.calculation.rule4.cappedAt90).toBe(false);
  });

  it("records the exact pre-rounding value and the rounding mode", () => {
    expect(o.calculation.rounding.mode).toBe("half-up, ties in the user's favour");
    expect(BigInt(o.calculation.rounding.roundedMinor)).toBe(o.returnMinor);
    expect(BigInt(o.calculation.rounding.exactDenominator)).toBeGreaterThan(0n);
  });

  it("echoes back every input", () => {
    expect(o.calculation.betType).toBe("WIN");
    expect(o.calculation.oddsTaken).toBe(5);
    expect(o.calculation.totalStakeMinor).toBe("1000");
    expect(o.calculation.race.actualRunners).toBe(10);
    expect(o.calculation.race.isHandicap).toBe(false);
    expect(o.calculation.runner.finishPosition).toBe(1);
    expect(o.calculation.version).toBe(1);
  });
});

describe("the calculation object records the PLACE part in full", () => {
  it("records the terms actually used", () => {
    const o = settled(
      bet({ type: "PLACE" }),
      race({ actualRunners: 10, isHandicap: false }),
      runner({ finishPosition: 2 }),
    );
    const part = o.calculation.parts.find((p) => p.part === "PLACE")!;
    expect(part.placesPaid).toBe(3);
    expect(part.placeFractionDen).toBe(5);
    expect(part.placeTermsSource).toBe("standard");
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/3 place\(s\) at 1\/5/);
  });

  it("records enhanced terms as enhanced — docs/08 D18", () => {
    const o = settled(
      bet({ type: "PLACE" }),
      race({ actualRunners: 16, isHandicap: true, enhancedPlaces: 6, enhancedFractionDen: 5 }),
      runner({ finishPosition: 5 }),
    );
    const part = o.calculation.parts.find((p) => p.part === "PLACE")!;
    expect(part.placesPaid).toBe(6);
    expect(part.placeTermsSource).toBe("enhanced");
    expect(part.outcome).toBe("won");
  });

  it("carries the disputed handicap 12-15 note through for the UI", () => {
    const o = settled(
      bet({ type: "PLACE" }),
      race({ actualRunners: 13, isHandicap: true }),
      runner({ finishPosition: 2 }),
    );
    const part = o.calculation.parts.find((p) => p.part === "PLACE")!;
    expect(part.placeTermsDisputed).toMatch(/theracelab/);
  });

  it("voids the place part when the field pays no places", () => {
    const o = settled(
      bet({ type: "PLACE" }),
      race({ actualRunners: 4 }),
      runner({ finishPosition: 1 }),
    );
    expect(o.status).toBe("VOID");
    expect(o.returnMinor).toBe(1000n);
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/pays no places/);
  });

  it("uses the place fraction on the WIN part of the price, not the whole price", () => {
    // docs/05 §3.2: at 9.0 with 1/5 terms the multiplier is (9-1)/5+1 = 2.6,
    // NOT 9/5 = 1.8. The single most common amateur settlement bug.
    const o = settled(
      bet({ type: "PLACE", oddsTaken: 9 }),
      race({ actualRunners: 10 }),
      runner({ finishPosition: 2 }),
    );
    expect(o.returnMinor).toBe(2600n);
  });

  it("loses outside the paid places", () => {
    const o = settled(
      bet({ type: "PLACE" }),
      race({ actualRunners: 10 }),
      runner({ finishPosition: 4 }),
    );
    expect(o.status).toBe("LOST");
    expect(o.returnMinor).toBe(0n);
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/outside 3 paid -> lost/);
  });

  it("loses when the horse did not finish", () => {
    const o = settled(
      bet({ type: "PLACE" }),
      race(),
      runner({ finishPosition: null }),
    );
    expect(o.status).toBe("LOST");
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/unplaced\/DNF/);
  });
});

describe("each-way status is PARTIAL when only one half wins", () => {
  const ew = bet({ type: "EACH_WAY", unitStakeMinor: 1000n, totalStakeMinor: 2000n });

  it("WON when both halves win", () => {
    expect(settled(ew, race(), runner({ finishPosition: 1 })).status).toBe("WON");
  });

  it("PARTIAL when it places but does not win", () => {
    const o = settled(ew, race(), runner({ finishPosition: 2 }));
    expect(o.status).toBe("PARTIAL");
    expect(o.calculation.parts).toHaveLength(2);
    expect(o.calculation.parts.map((p) => p.outcome)).toEqual(["lost", "won"]);
  });

  it("LOST when both halves lose", () => {
    expect(settled(ew, race(), runner({ finishPosition: 9 })).status).toBe("LOST");
  });

  it("PARTIAL when the place half voids but the win half stands", () => {
    // 4 runners: no place market, so the place stake comes back while the win
    // half is settled on its merits.
    const o = settled(ew, race({ actualRunners: 4 }), runner({ finishPosition: 1 }));
    expect(o.status).toBe("PARTIAL");
  });
});

describe("step 5 — the dead-heat divisor", () => {
  it("halves the effective stake in a two-way dead heat for first", () => {
    const o = settled(bet({ oddsTaken: 5 }), race(), runner({ deadHeatCount: 2 }));
    const part = o.calculation.parts[0]!;
    expect(part.deadHeatTied).toBe(2);
    expect(part.effectiveStake.den).toBe(2n);
    // docs/05 §6 worked example: £10 at 5.0, two-way -> £25.
    expect(o.returnMinor).toBe(2500n);
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/2-way dead heat/);
  });

  it("does not reduce a clean winner", () => {
    const o = settled(bet({ oddsTaken: 5 }), race(), runner({ deadHeatCount: 1 }));
    expect(o.returnMinor).toBe(5000n);
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/no dead heat/);
  });

  it("divides by three for a three-way tie for the last paid place", () => {
    // docs/05 §6.1: 3 tied for 3rd of 3 places -> 1 position available -> 1/3.
    const o = settled(
      bet({ type: "PLACE", oddsTaken: 11 }),
      race({ actualRunners: 10 }),
      runner({ finishPosition: 3, deadHeatCount: 3 }),
    );
    const part = o.calculation.parts[0]!;
    expect(part.deadHeatPositionsAvailable).toBe(1);
    expect(part.effectiveStake.den).toBe(3n);
  });

  it("does NOT reduce when the tie fits inside the remaining places", () => {
    // 2 tied for 2nd with 3 places paid: positions 2 and 3 are both available,
    // so both backers are fully inside the places. docs/05 §6's "the stake is
    // proportionally reduced" does not bite here.
    const o = settled(
      bet({ type: "PLACE", oddsTaken: 11 }),
      race({ actualRunners: 10 }),
      runner({ finishPosition: 2, deadHeatCount: 2 }),
    );
    expect(o.returnMinor).toBe(3000n);
  });
});

describe("step 6 — Rule 4 from the band table", () => {
  it("looks the deduction up from the withdrawn price and records the band", () => {
    const o = settled(
      bet({ oddsTaken: 5 }),
      race({
        announcedRule4Pence: null,
        withdrawals: [{ fraction: { num: 2, den: 1 }, runnerStatus: "withdrawn" }],
      }),
    );
    expect(o.calculation.rule4.source).toBe("band-table");
    expect(o.calculation.rule4.totalPence).toBe(30);
    expect(o.calculation.rule4.bands[0]?.price).toBe("2/1");
    expect(o.calculation.rule4.bands[0]?.deduction).toBe(30);
  });

  it("accumulates multiple withdrawals — docs/05 §5.2 rule 2", () => {
    const o = settled(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [
          { fraction: { num: 3, den: 1 }, runnerStatus: "withdrawn" },
          { fraction: { num: 5, den: 1 }, runnerStatus: "withdrawn" },
        ],
      }),
    );
    // 25p + 15p added, not applied in sequence.
    expect(o.calculation.rule4.totalPence).toBe(40);
    expect(o.calculation.rule4.bands).toHaveLength(2);
  });

  it("caps the total at 90p and records that it capped", () => {
    const short = { num: 1, den: 9 } as const; // 90p each
    const o = settled(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [
          { fraction: short, runnerStatus: "withdrawn" },
          { fraction: short, runnerStatus: "withdrawn" },
        ],
      }),
    );
    expect(o.calculation.rule4.totalPence).toBe(90);
    expect(o.calculation.rule4.cappedAt90).toBe(true);
  });

  it("ignores a non_runner — docs/08 D17, only a withdrawal deducts", () => {
    const o = settled(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [{ fraction: { num: 1, den: 9 }, runnerStatus: "non_runner" }],
      }),
    );
    expect(o.calculation.rule4.applied).toBe(false);
    expect(o.calculation.rule4.source).toBe("none");
  });

  it("surfaces D21 evidence confidence for the bands it used", () => {
    const o = settled(
      bet(),
      race({
        announcedRule4Pence: null,
        // 1/9 is a consensus-only band: six sources, zero worked examples.
        withdrawals: [{ fraction: { num: 1, den: 9 }, runnerStatus: "withdrawn" }],
      }),
    );
    expect(o.calculation.rule4.bands[0]?.evidenceConfidence).toBe("consensus-only");
    expect(o.calculation.rule4.weakestConfidence).toBe("consensus-only");
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/consensus-only/);
  });

  it("reports computed-confirmed where a worked example pins the band", () => {
    const o = settled(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [{ fraction: { num: 2, den: 1 }, runnerStatus: "withdrawn" }],
      }),
    );
    expect(o.calculation.rule4.weakestConfidence).toBe("computed-confirmed");
  });

  it("carries row 15's dispute through", () => {
    const o = settled(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [{ fraction: { num: 16, den: 5 }, runnerStatus: "withdrawn" }],
      }),
    );
    expect(o.calculation.rule4.bands[0]?.disputed).toMatch(/100\/30/);
  });

  it("never deducts from the returned stake", () => {
    const o = settled(bet({ oddsTaken: 5 }), race({ announcedRule4Pence: 90 }));
    // £10 at 5.0: £40 winnings, 90p leaves £4, plus the £10 stake whole.
    expect(o.returnMinor).toBe(1400n);
  });
});

describe("refusals are return values — docs/08 D14, D17, D22", () => {
  it("refuses a withdrawal with no fractional price", () => {
    const o = review(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [{ fraction: null, runnerStatus: "withdrawn" }],
      }),
    );
    // docs/08 D17, not D14: the feed did not say what the deduction was. A
    // price that is real but between two bands is the other reason, asserted
    // in the next test — the two are different questions for a reviewer.
    expect(o.reason).toBe("AMBIGUOUS_WITHDRAWAL");
    expect(o.detail).toMatch(/no fractional price/);
  });

  it("refuses a price that falls between two published bands", () => {
    const o = review(
      bet(),
      race({
        announcedRule4Pence: null,
        // 37/12 sits between 3/1 and 16/5 — on no rung of the ladder.
        withdrawals: [{ fraction: { num: 37, den: 12 }, runnerStatus: "withdrawn" }],
      }),
    );
    expect(o.detail).toMatch(/between two published bands/);
  });

  it("refuses a place bet with no runner count", () => {
    const o = review(
      bet({ type: "PLACE" }),
      race({ actualRunners: null }),
      runner({ finishPosition: 2 }),
    );
    expect(o.reason).toBe("MISSING_ACTUAL_RUNNERS");
  });

  it("still refunds a void bet even when Rule 4 is unresolvable", () => {
    // The void check runs FIRST: a non-runner gets its money back whether or
    // not the rest of the race can be settled.
    const o = settled(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [{ fraction: null, runnerStatus: "withdrawn" }],
      }),
      runner({ status: "NON_RUNNER" }),
    );
    expect(o.status).toBe("VOID");
    expect(o.returnMinor).toBe(1000n);
  });

  it("a WIN bet needs no runner count and settles regardless", () => {
    const o = settled(bet(), race({ actualRunners: null }), runner());
    expect(o.status).toBe("WON");
  });

  it("a refusal still carries a calculation object for the review screen", () => {
    const o = review(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [{ fraction: null, runnerStatus: "withdrawn" }],
      }),
    );
    expect(o.calculation.betType).toBe("WIN");
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/REFUSED/);
  });
});

describe("step 7 — rounding happens once, half-up, in the user's favour", () => {
  it("rounds a half-penny up", () => {
    // 1p at 2.005 -> exactly 2.005p, which must round to 2p not 1p.
    const o = settled(bet({ unitStakeMinor: 1n, totalStakeMinor: 1n, oddsTaken: 2.005 }));
    expect(o.returnMinor).toBe(2n);
  });

  it("records the order the rules fired in", () => {
    const o = settled(bet(), race({ announcedRule4Pence: 20 }));
    const joined = o.calculation.rulesApplied.join(" | ");
    expect(joined).toMatch(/Rule 4.*rounded once/s);
  });
});


/**
 * Cases that exist because a mutant survived, each pinning one decision that
 * nothing else in the suite distinguished (docs/08 D13, D24 Gate A).
 */
describe("Rule 4 aggregation boundaries", () => {
  /** A withdrawal at a price whose band deduction is known. */
  const wd = (num: number, den: number) => ({
    fraction: { num, den },
    runnerStatus: "withdrawn" as const,
  });

  it("does NOT report a cap when the total lands exactly on 90p", () => {
    // docs/05 §5.2 rule 2 caps deductions AT 90p. A total of exactly 90 is the
    // cap's value, not an application of it, and `> 90` vs `>= 90` is the whole
    // difference. Two 45p bands sum to precisely 90.
    const o = settled(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [wd(11, 10), wd(11, 10)],
      }),
    );
    expect(o.calculation.rule4.totalPence).toBe(90);
    expect(o.calculation.rule4.cappedAt90).toBe(false);
  });

  it("reports a cap only once the total EXCEEDS 90p", () => {
    const o = settled(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [wd(11, 10), wd(11, 10), wd(11, 10)],
      }),
    );
    expect(o.calculation.rule4.totalPence).toBe(90);
    expect(o.calculation.rule4.cappedAt90).toBe(true);
  });

  it("takes the WEAKEST evidence across bands, not the strongest or unanimous", () => {
    // 4/1 falls in the computed-confirmed 16/5-4/1 band; 6/1 falls in the
    // consensus-only 6/1-9/1 band. Mixing them must report consensus-only —
    // `some`, not `every`. Under `every` one well-evidenced band would launder
    // a poorly-evidenced one, and docs/08 D21 exists precisely so the user is
    // told which of the two they are relying on.
    const o = settled(
      bet(),
      race({ announcedRule4Pence: null, withdrawals: [wd(4, 1), wd(6, 1)] }),
    );
    expect(o.calculation.rule4.bands).toHaveLength(2);
    expect(o.calculation.rule4.weakestConfidence).toBe("consensus-only");
  });

  it("reports computed-confirmed when EVERY band is computed-confirmed", () => {
    const o = settled(bet(), race({ announcedRule4Pence: null, withdrawals: [wd(4, 1)] }));
    expect(o.calculation.rule4.weakestConfidence).toBe("computed-confirmed");
  });

  it("reports NO confidence at all when no band was consulted", () => {
    // No withdrawals means no band was used, and "computed-confirmed" would be
    // a claim about evidence that was never looked at.
    const o = settled(bet(), race({ announcedRule4Pence: null, withdrawals: [] }));
    expect(o.calculation.rule4.bands).toEqual([]);
    expect(o.calculation.rule4.weakestConfidence).toBeNull();
    expect(o.calculation.rule4.applied).toBe(false);
  });

  it("does not mark Rule 4 'applied' when the band table returns a ZERO deduction", () => {
    // A horse withdrawn at a very long price deducts nothing. The band was
    // consulted and the answer was zero, which is not the same as a deduction
    // having been applied — `> 0` vs `>= 0`.
    const o = settled(
      bet(),
      race({ announcedRule4Pence: null, withdrawals: [wd(100, 1)] }),
    );
    expect(o.calculation.rule4.bands).toHaveLength(1);
    expect(o.calculation.rule4.totalPence).toBe(0);
    expect(o.calculation.rule4.applied).toBe(false);
    expect(o.calculation.rule4.weakestConfidence).not.toBeNull();
  });
});

describe("VOID explains WHICH rule voided the bet", () => {
  it("names the runner when the horse did not run", () => {
    const o = settled(bet(), race(), runner({ status: "NON_RUNNER" }));
    expect(o.status).toBe("VOID");
    expect(o.calculation.rulesApplied.join(" ")).toMatch(
      /runner\.status=NON_RUNNER -> VOID/,
    );
  });

  it("names the runner when the horse was a reserve that did not get in", () => {
    const o = settled(bet(), race(), runner({ status: "RESERVE" }));
    expect(o.status).toBe("VOID");
    expect(o.calculation.rulesApplied.join(" ")).toMatch(/runner\.status=RESERVE -> VOID/);
  });

  it.each(["VOID", "ABANDONED", "POSTPONED"] as const)(
    "names the RACE when the race did not happen (%s), not the runner",
    (status) => {
      const o = settled(bet(), race({ status }), runner());
      expect(o.status).toBe("VOID");
      const rules = o.calculation.rulesApplied.join(" ");
      // The distinction matters to the reader: "your horse was withdrawn" and
      // "the meeting was abandoned" are different explanations for the same
      // refund.
      expect(rules).toMatch(new RegExp(`race\\.status=${status} -> VOID`));
      expect(rules).not.toMatch(/runner\.status=/);
    },
  );
});

describe("place terms: enhanced vs standard", () => {
  const ew = bet({ type: "EACH_WAY", unitStakeMinor: 1000n, totalStakeMinor: 2000n });

  it("uses the STANDARD table when no enhanced terms are offered", () => {
    const o = settled(
      ew,
      race({ actualRunners: 10, isHandicap: false, enhancedPlaces: null, enhancedFractionDen: null }),
      runner({ finishPosition: 3 }),
    );
    const place = o.calculation.parts.find((p) => p.part === "PLACE");
    expect(place?.placeTermsSource).toBe("standard");
    expect(place?.placesPaid).toBe(3);
    expect(place?.placeFractionDen).toBe(5);
  });

  it("uses ENHANCED terms verbatim when both fields are set", () => {
    const o = settled(
      ew,
      race({ actualRunners: 10, isHandicap: false, enhancedPlaces: 5, enhancedFractionDen: 4 }),
      runner({ finishPosition: 5 }),
    );
    const place = o.calculation.parts.find((p) => p.part === "PLACE");
    expect(place?.placeTermsSource).toBe("enhanced");
    expect(place?.placesPaid).toBe(5);
    expect(place?.placeFractionDen).toBe(4);
    // Fifth place pays under enhanced terms and would have lost under standard.
    expect(place?.outcome).toBe("won");
  });

  it.each([
    ["places without a fraction", { enhancedPlaces: 5, enhancedFractionDen: null }],
    ["a fraction without places", { enhancedPlaces: null, enhancedFractionDen: 4 }],
  ])("ignores half an override (%s) and falls back to the table", (_label, enhanced) => {
    // docs/08 D18: both or neither. Half an override is not a term, and taking
    // one field with the other defaulted would silently invent a place term.
    const o = settled(
      ew,
      race({ actualRunners: 10, isHandicap: false, ...enhanced }),
      runner({ finishPosition: 3 }),
    );
    const place = o.calculation.parts.find((p) => p.part === "PLACE");
    expect(place?.placeTermsSource).toBe("standard");
    expect(place?.placesPaid).toBe(3);
  });
});

describe("the PLACE part says why it lost", () => {
  const ew = bet({ type: "EACH_WAY", unitStakeMinor: 1000n, totalStakeMinor: 2000n });

  it("says 'unplaced/DNF' when the horse has no finishing position", () => {
    const o = settled(ew, race({ actualRunners: 10 }), runner({ finishPosition: null }));
    // "finished null" would be a bug on screen; a horse that did not complete
    // has no position, and saying so is the whole point of the explanation.
    expect(o.calculation.rulesApplied.join(" ")).toContain("PLACE: finished unplaced/DNF");
  });

  it("gives the finishing position when the horse finished but out of the places", () => {
    const o = settled(ew, race({ actualRunners: 10 }), runner({ finishPosition: 7 }));
    const rules = o.calculation.rulesApplied.join(" ");
    expect(rules).toContain("PLACE: finished 7");
    expect(rules).not.toContain("unplaced/DNF");
  });
});


describe("roundHalfUp — the single rounding rule, tested directly", () => {
  const r = (num: bigint, den: bigint) => ({ num, den });

  it("rounds down below the halfway point", () => {
    expect(roundHalfUp(r(149n, 100n))).toBe(1n);
    expect(roundHalfUp(r(1n, 3n))).toBe(0n);
  });

  it("rounds UP exactly on the halfway point — ties go to the user", () => {
    // .claude/rules/money.md: "half-up, resolving ties in the user's favour."
    // Banker's rounding, or rounding a tie down, quietly costs the user a penny
    // on every dead-heat share that lands on a half.
    expect(roundHalfUp(r(1n, 2n))).toBe(1n);
    expect(roundHalfUp(r(3n, 2n))).toBe(2n);
    expect(roundHalfUp(r(4063n, 2n))).toBe(2032n);
  });

  it("rounds up above the halfway point", () => {
    expect(roundHalfUp(r(151n, 100n))).toBe(2n);
  });

  it("leaves exact values alone", () => {
    expect(roundHalfUp(r(500n, 1n))).toBe(500n);
    expect(roundHalfUp(r(1000n, 10n))).toBe(100n);
    expect(roundHalfUp(r(0n, 7n))).toBe(0n);
  });

  it("is exact far beyond the range a double can represent", () => {
    // The whole reason returns are carried as bigint rationals. As a double,
    // this numerator loses its last digits and the answer is off by pennies.
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    expect(roundHalfUp(r(huge * 2n + 1n, 2n))).toBe(huge + 1n);
  });

  it.each([0n, -1n, -100n])("REFUSES a denominator of %s", (den) => {
    // Unreachable from settle(), where every denominator is positive by
    // construction. Left in and tested here because the failure it prevents —
    // a division by zero producing a nonsense payout — is silent.
    expect(() => roundHalfUp(r(100n, den))).toThrow(/non-positive denominator/);
  });
});
