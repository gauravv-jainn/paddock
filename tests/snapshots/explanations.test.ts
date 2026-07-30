import { describe, expect, it } from "vitest";
import { settle } from "@/modules/settlement";
import { lookupPlaceTerms } from "@/modules/settlement/rules/placeTerms";
import { lookupRule4Band } from "@/modules/settlement/rules/rule4";
import type {
  SettlementBet,
  SettlementRace,
  SettlementRunner,
} from "@/modules/settlement";

/**
 * GATE B — the prose the user actually reads, pinned by snapshot.
 *
 * `docs/08` D24 splits the mutation gate in two. Gate A is arithmetic and
 * branches, held at 100%. Gate B is message and prose mutants, and D24 says it
 * is constrained by SNAPSHOT ASSERTIONS RATHER THAN BY A SCORE — because a
 * percentage target on wording rewards asserting that strings are non-empty,
 * which pins nothing and reads as coverage.
 *
 * What a snapshot buys instead: every one of these strings is rendered on the
 * settlement detail screen, which `docs/04` §7 calls "the feature that ends
 * disputes". A reworded explanation is not a bug, but it IS a change to what
 * the product tells a user about their money, and it should never happen by
 * accident or pass unreviewed. Changing one of these deliberately means
 * updating a snapshot in the same commit, in front of a reviewer.
 *
 * These are NOT a correctness check. Settlement correctness is `tests/golden/`
 * and nothing else (`.claude/rules/money.md`).
 */

const bet = (over: Partial<SettlementBet> = {}): SettlementBet => ({
  type: "WIN",
  unitStakeMinor: 1000n,
  totalStakeMinor: 1000n,
  oddsTaken: 5,
  ...over,
});

const eachWay = (over: Partial<SettlementBet> = {}): SettlementBet =>
  bet({ type: "EACH_WAY", unitStakeMinor: 1000n, totalStakeMinor: 2000n, ...over });

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

/** The prose a settlement produces, and nothing numeric. */
function explanation(
  b: SettlementBet,
  r: SettlementRace,
  ru: SettlementRunner,
): { rulesApplied: string[]; reason?: string; detail?: string } {
  const outcome = settle(b, r, ru);
  if (outcome.kind === "NEEDS_REVIEW") {
    return {
      rulesApplied: outcome.calculation.rulesApplied,
      reason: outcome.reason,
      detail: outcome.detail,
    };
  }
  return { rulesApplied: outcome.calculation.rulesApplied };
}

describe("settlement explanations", () => {
  it("clean win", () => {
    expect(explanation(bet(), race(), runner())).toMatchSnapshot();
  });

  it("clean loss", () => {
    expect(explanation(bet(), race(), runner({ finishPosition: 6 }))).toMatchSnapshot();
  });

  it("non-runner voids", () => {
    expect(
      explanation(bet(), race(), runner({ status: "NON_RUNNER" })),
    ).toMatchSnapshot();
  });

  it("reserve voids", () => {
    expect(explanation(bet(), race(), runner({ status: "RESERVE" }))).toMatchSnapshot();
  });

  it.each(["VOID", "ABANDONED", "POSTPONED"] as const)("race %s voids", (status) => {
    expect(explanation(bet(), race({ status }), runner())).toMatchSnapshot();
  });

  it("disqualification", () => {
    expect(
      explanation(bet(), race(), runner({ disqualified: true })),
    ).toMatchSnapshot();
  });

  it("each-way placed in a non-handicap", () => {
    expect(
      explanation(eachWay(), race({ actualRunners: 10 }), runner({ finishPosition: 3 })),
    ).toMatchSnapshot();
  });

  it("each-way placed in a handicap — the 1/4 fraction", () => {
    expect(
      explanation(
        eachWay(),
        race({ actualRunners: 16, isHandicap: true }),
        runner({ finishPosition: 4 }),
      ),
    ).toMatchSnapshot();
  });

  it("each-way unplaced — 'unplaced/DNF'", () => {
    expect(
      explanation(eachWay(), race({ actualRunners: 10 }), runner({ finishPosition: null })),
    ).toMatchSnapshot();
  });

  it("each-way outside the paid places", () => {
    expect(
      explanation(eachWay(), race({ actualRunners: 10 }), runner({ finishPosition: 7 })),
    ).toMatchSnapshot();
  });

  it("field pays no places at all", () => {
    expect(
      explanation(eachWay(), race({ actualRunners: 4 }), runner({ finishPosition: 1 })),
    ).toMatchSnapshot();
  });

  it("dead heat for the final paid place", () => {
    expect(
      explanation(
        eachWay(),
        race({ actualRunners: 16, isHandicap: true }),
        runner({ finishPosition: 4, deadHeatCount: 2 }),
      ),
    ).toMatchSnapshot();
  });

  it("three-way dead heat for the win", () => {
    expect(
      explanation(bet(), race(), runner({ finishPosition: 1, deadHeatCount: 3 })),
    ).toMatchSnapshot();
  });

  it("announced Rule 4 deduction", () => {
    expect(explanation(bet(), race({ announcedRule4Pence: 25 }), runner())).toMatchSnapshot();
  });

  it("Rule 4 from the band table", () => {
    expect(
      explanation(
        bet(),
        race({
          announcedRule4Pence: null,
          withdrawals: [{ fraction: { num: 4, den: 1 }, runnerStatus: "withdrawn" }],
        }),
        runner(),
      ),
    ).toMatchSnapshot();
  });

  it("Rule 4 capped at 90p", () => {
    const wd = { fraction: { num: 11, den: 10 }, runnerStatus: "withdrawn" as const };
    expect(
      explanation(
        bet(),
        race({ announcedRule4Pence: null, withdrawals: [wd, wd, wd] }),
        runner(),
      ),
    ).toMatchSnapshot();
  });

  it("enhanced place terms", () => {
    expect(
      explanation(
        eachWay(),
        race({ actualRunners: 10, enhancedPlaces: 5, enhancedFractionDen: 4 }),
        runner({ finishPosition: 5 }),
      ),
    ).toMatchSnapshot();
  });
});

describe("refusal explanations — what the review queue is told", () => {
  it("withdrawn runner with no fractional price (D17)", () => {
    expect(
      explanation(
        bet(),
        race({
          announcedRule4Pence: null,
          withdrawals: [{ fraction: null, runnerStatus: "withdrawn" }],
        }),
        runner(),
      ),
    ).toMatchSnapshot();
  });

  it("price between two published bands (D14)", () => {
    expect(
      explanation(
        bet(),
        race({
          announcedRule4Pence: null,
          withdrawals: [{ fraction: { num: 37, den: 12 }, runnerStatus: "withdrawn" }],
        }),
        runner(),
      ),
    ).toMatchSnapshot();
  });

  it("missing actual_runners on an each-way bet", () => {
    expect(
      explanation(eachWay(), race({ actualRunners: null }), runner({ finishPosition: 2 })),
    ).toMatchSnapshot();
  });
});

describe("programmer-error messages", () => {
  /** The message, not just the type — it is what a developer debugs from. */
  const messageOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("expected a throw");
  };

  it("settle() input guards", () => {
    expect({
      zeroStake: messageOf(() =>
        settle(bet({ unitStakeMinor: 0n, totalStakeMinor: 0n }), race(), runner()),
      ),
      oddsAtOne: messageOf(() => settle(bet({ oddsTaken: 1 }), race(), runner())),
      eachWayStakeMismatch: messageOf(() =>
        settle(bet({ type: "EACH_WAY", totalStakeMinor: 1000n }), race(), runner()),
      ),
      winStakeMismatch: messageOf(() =>
        settle(bet({ totalStakeMinor: 2000n }), race(), runner()),
      ),
      announcedOutOfRange: messageOf(() =>
        settle(bet(), race({ announcedRule4Pence: 91 }), runner()),
      ),
    }).toMatchSnapshot();
  });

  it("rule table guards", () => {
    expect({
      negativePrice: messageOf(() => lookupRule4Band({ num: -1, den: 2 })),
      zeroDenominator: messageOf(() => lookupRule4Band({ num: 1, den: 0 })),
      zeroRunners: messageOf(() => lookupPlaceTerms(0, false)),
      fractionalRunners: messageOf(() => lookupPlaceTerms(7.5, false)),
      halfAnOverride: messageOf(() =>
        lookupPlaceTerms(16, true, { places: 6, fractionDen: 0 }),
      ),
    }).toMatchSnapshot();
  });

  it("the between-bands refusal reason", () => {
    const found = lookupRule4Band({ num: 37, den: 12 });
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toMatchSnapshot();
  });
});


/**
 * Prose that a snapshot of `rulesApplied` alone does not reach — it lives in
 * the calculation's structured fields, which the settlement detail screen also
 * renders. Same Gate B purpose: pin the words, not a percentage.
 */
describe("prose carried in the calculation's structured fields", () => {
  it("labels the Rule 4 source 'none' when nothing was announced or looked up", () => {
    const o = settle(bet(), race({ announcedRule4Pence: 0 }), runner());
    if (o.kind !== "SETTLED") throw new Error("expected SETTLED");
    expect({
      source: o.calculation.rule4.source,
      applied: o.calculation.rule4.applied,
      weakestConfidence: o.calculation.rule4.weakestConfidence,
    }).toMatchSnapshot();
  });

  it("labels it 'announced' when the feed published a figure", () => {
    const o = settle(bet(), race({ announcedRule4Pence: 25 }), runner());
    if (o.kind !== "SETTLED") throw new Error("expected SETTLED");
    expect(o.calculation.rule4.source).toBe("announced");
  });

  it("spells out a DISPUTED Rule 4 band's competing published values", () => {
    // The 16/5 - 4/1 row is the weakest in the table on source count. docs/08
    // D21 exists so the user is told that, and the detail screen renders this
    // string verbatim — an empty one would silently drop the caveat.
    const o = settle(
      bet(),
      race({
        announcedRule4Pence: null,
        withdrawals: [{ fraction: { num: 4, den: 1 }, runnerStatus: "withdrawn" }],
      }),
      runner(),
    );
    if (o.kind !== "SETTLED") throw new Error("expected SETTLED");
    expect(o.calculation.rule4.bands[0]?.disputed).toMatchSnapshot();
  });

  it.each([
    ["won", 3, 10],
    ["lost", 7, 10],
  ] as const)("marks the place part '%s'", (expected, finishPosition, actualRunners) => {
    const o = settle(eachWay(), race({ actualRunners }), runner({ finishPosition }));
    if (o.kind !== "SETTLED") throw new Error("expected SETTLED");
    expect(o.calculation.parts.find((part) => part.part === "PLACE")?.outcome).toBe(
      expected,
    );
  });

  it("marks the place part 'void' when the field pays no places", () => {
    const o = settle(
      eachWay(),
      race({ actualRunners: 4 }),
      runner({ finishPosition: 1 }),
    );
    if (o.kind !== "SETTLED") throw new Error("expected SETTLED");
    const place = o.calculation.parts.find((part) => part.part === "PLACE");
    // 'void', not 'lost': the place part of a bet on a field that pays no
    // places was never a losing bet, and its stake comes back.
    expect(place?.outcome).toBe("void");
    expect(o.calculation.parts.map((part) => part.outcome)).toMatchSnapshot();
  });
});
