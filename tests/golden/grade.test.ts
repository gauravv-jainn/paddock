import { describe, expect, it } from "vitest";
import {
  settle,
  type SettlementBet,
  type SettlementRace,
  type SettlementRunner,
} from "@/modules/settlement";
import { loadPublishedVectors, type LoadedVector } from "./loader";

/**
 * S10 — grading settle() against the third-party published vectors.
 *
 * Every expectedReturnMinor here was computed by someone else and quoted
 * verbatim from a fetched page. That is the whole point: a fixture written
 * from the same understanding that wrote settle() grades nothing.
 *
 * Disputed vectors (docs/08 D15) are reported but not gated.
 */
const suite = loadPublishedVectors();

function toInputs(v: LoadedVector): {
  bet: SettlementBet;
  race: SettlementRace;
  runner: SettlementRunner;
} {
  const unit =
    v.bet.type === "EACH_WAY"
      ? BigInt(v.bet.unitStakeMinor as string)
      : v.stake;

  const fr = v.race.withdrawnAtFraction;
  const fractions = fr ? (Array.isArray(fr) ? fr : [fr]) : [];

  return {
    bet: {
      type: v.bet.type,
      unitStakeMinor: unit,
      totalStakeMinor: v.stake,
      oddsTaken: v.bet.oddsTaken,
    },
    race: {
      status: "RESULT",
      actualRunners: v.race.actualRunners ?? null,
      isHandicap: v.race.isHandicap ?? false,
      // The sources state a deduction outright; that is authoritative and the
      // band table is not consulted (docs/08 D14 note in settle()).
      announcedRule4Pence: v.race.rule4Pence ?? 0,
      withdrawals: fractions.map((f) => ({
        fraction: f,
        runnerStatus: "withdrawn" as const,
      })),
    },
    runner: {
      status: "DECLARED",
      finishPosition: v.outcome.finishPosition,
      deadHeatCount: v.outcome.deadHeatCount,
      disqualified: false,
    },
  };
}

describe("settle() against the published vectors", () => {
  it.each(suite.graded.map((v) => [v.id, v] as const))("%s", (_id, v) => {
    const { bet, race, runner } = toInputs(v);
    const outcome = settle(bet, race, runner);

    if (outcome.kind !== "SETTLED") {
      throw new Error(
        `${v.id} needed review (${outcome.reason}): ${outcome.detail}`,
      );
    }

    expect(
      outcome.returnMinor,
      `${v.id}\n  source: ${v.source}\n  quote:  ${v.sourceQuote}`,
    ).toBe(v.expectedReturn);
  });

  it("grades every non-disputed vector", () => {
    expect(suite.graded.length).toBeGreaterThanOrEqual(25);
  });
});

describe("docs/08 D15 — disputed vectors are reported, never gated", () => {
  it.each(suite.disputed.map((v) => [v.id, v] as const))(
    "%s (reported only)",
    (_id, v) => {
      const { bet, race, runner } = toInputs(v);
      const outcome = settle(bet, race, runner);
      if (outcome.kind !== "SETTLED") return;

      // Recorded, not asserted. The three-way dead heat expects £23.31 via an
      // intermediate rounding money.md forbids; we produce £23.33.
      const delta = outcome.returnMinor - v.expectedReturn;
      console.warn(
        `  DISPUTED ${v.id}: source says ${v.expectedReturn}, we say ` +
          `${outcome.returnMinor} (delta ${delta}). ${v.expectedDisputedReason ?? ""}`,
      );
      expect(typeof outcome.returnMinor).toBe("bigint");
    },
  );
});
