import { describe, expect, it } from "vitest";
import type { SettlementRaceRow } from "@/modules/catalog";
import { toSettlementRace, toSettlementRunner } from "./settleRace";

/**
 * The database-row → settle()-input boundary.
 *
 * Every guard here decides whether a bad row reaches the settlement engine or
 * is stopped at the door. Two of them cannot be reached through settleRace()
 * at all, because the database's CHECK constraints forbid the rows that would
 * trigger them — which makes them exactly the guards most likely to be wrong
 * and never noticed.
 */

const runnerRow = (
  over: Partial<SettlementRaceRow["runners"][number]> = {},
): SettlementRaceRow["runners"][number] => ({
  runnerId: "r1",
  clothNumber: 1,
  status: "declared",
  finishPosition: 1,
  deadHeatCount: 1,
  disqualified: false,
  withdrawnAtFractionNum: null,
  withdrawnAtFractionDen: null,
  ...over,
});

const raceRow = (over: Partial<SettlementRaceRow> = {}): SettlementRaceRow => ({
  raceId: "race-1",
  status: "result",
  resultVersion: 0,
  actualRunners: 8,
  isHandicap: false,
  enhancedPlaces: null,
  enhancedFraction: null,
  rule4Pence: 0,
  runners: [runnerRow()],
  ...over,
});

describe("toSettlementRunner", () => {
  it.each([
    ["declared", "DECLARED"],
    ["non_runner", "NON_RUNNER"],
    ["withdrawn", "WITHDRAWN"],
    ["reserve", "RESERVE"],
  ])("maps '%s' to '%s'", (dbStatus, expected) => {
    expect(toSettlementRunner(runnerRow({ status: dbStatus })).status).toBe(expected);
  });

  it("THROWS on a status it does not know, rather than passing undefined on", () => {
    // Unreachable today: runners_status_check restricts the column to the four
    // above. It is reachable the moment a migration adds a fifth, and the
    // failure mode without this guard is `status: undefined` arriving inside
    // settle() and being compared against string literals — every comparison
    // false, so the horse silently settles as a normal declared runner.
    expect(() => toSettlementRunner(runnerRow({ status: "objected" }))).toThrow(
      /unmapped runner status 'objected'/,
    );
  });

  it("carries the finishing detail through unchanged", () => {
    const mapped = toSettlementRunner(
      runnerRow({ finishPosition: 3, deadHeatCount: 2, disqualified: true }),
    );
    expect(mapped).toEqual({
      status: "DECLARED",
      finishPosition: 3,
      deadHeatCount: 2,
      disqualified: true,
    });
  });
});

describe("toSettlementRace", () => {
  it("maps a withdrawal that HAS a fractional price into a usable fraction", () => {
    const race = toSettlementRace(
      raceRow({
        runners: [
          runnerRow(),
          runnerRow({
            runnerId: "r2",
            status: "withdrawn",
            withdrawnAtFractionNum: 4,
            withdrawnAtFractionDen: 1,
          }),
        ],
      }),
    );

    expect(race.withdrawals).toHaveLength(1);
    expect(race.withdrawals[0]).toEqual({
      fraction: { num: 4, den: 1 },
      runnerStatus: "withdrawn",
    });
  });

  it("maps a withdrawal with NO price to a null fraction, not to zero", () => {
    const race = toSettlementRace(
      raceRow({
        runners: [runnerRow({ status: "withdrawn" })],
      }),
    );
    // docs/08 D14: a null fraction does NOT mean "no deduction". It means
    // settle() must refuse. Mapping it to 0/1 here would silently pay out in
    // full on a race that owed a deduction.
    expect(race.withdrawals[0]!.fraction).toBeNull();
  });

  it.each([
    ["numerator only", { withdrawnAtFractionNum: 4, withdrawnAtFractionDen: null }],
    ["denominator only", { withdrawnAtFractionNum: null, withdrawnAtFractionDen: 1 }],
  ])("treats a half-present fraction (%s) as no fraction", (_label, fraction) => {
    // Unreachable through the database, which has runners_withdrawn_fraction_
    // complete asserting both-or-neither. Half a fraction is not a price, and
    // the safe reading of one is "we do not know", never a guess at the other
    // half.
    const race = toSettlementRace(
      raceRow({ runners: [runnerRow({ status: "withdrawn", ...fraction })] }),
    );
    expect(race.withdrawals[0]!.fraction).toBeNull();
  });

  it("includes NON-RUNNERS in the withdrawal list, not just withdrawn horses", () => {
    const race = toSettlementRace(
      raceRow({
        runners: [
          runnerRow(),
          runnerRow({ runnerId: "r2", status: "non_runner" }),
          runnerRow({ runnerId: "r3", status: "withdrawn" }),
        ],
      }),
    );
    expect(race.withdrawals.map((w) => w.runnerStatus).sort()).toEqual([
      "non_runner",
      "withdrawn",
    ]);
  });

  it("ignores declared and reserve runners entirely", () => {
    const race = toSettlementRace(
      raceRow({
        runners: [runnerRow(), runnerRow({ runnerId: "r2", status: "reserve" })],
      }),
    );
    expect(race.withdrawals).toEqual([]);
  });

  it("turns an announced deduction of ZERO into null, not into 'zero announced'", () => {
    // docs/08 D17. rule4_pence defaults to 0 meaning "nothing announced", which
    // is not the same statement as "a deduction of zero was published". Passing
    // 0 through would tell settle() the question was answered and stop it
    // consulting the band table.
    expect(toSettlementRace(raceRow({ rule4Pence: 0 })).announcedRule4Pence).toBeNull();
    expect(toSettlementRace(raceRow({ rule4Pence: 10 })).announcedRule4Pence).toBe(10);
  });

  it.each([
    ["result", "RESULT"],
    ["void", "VOID"],
    ["abandoned", "ABANDONED"],
    ["postponed", "POSTPONED"],
  ])("maps race status '%s' to '%s'", (dbStatus, expected) => {
    expect(toSettlementRace(raceRow({ status: dbStatus })).status).toBe(expected);
  });

  it("maps an unknown race status to UNDER_REVIEW rather than guessing", () => {
    expect(toSettlementRace(raceRow({ status: "open" })).status).toBe("UNDER_REVIEW");
  });

  it("passes the enhanced terms through, both or neither", () => {
    const standard = toSettlementRace(raceRow());
    expect(standard.enhancedPlaces).toBeNull();
    expect(standard.enhancedFractionDen).toBeNull();

    const enhanced = toSettlementRace(
      raceRow({ enhancedPlaces: 6, enhancedFraction: 5 }),
    );
    expect(enhanced.enhancedPlaces).toBe(6);
    expect(enhanced.enhancedFractionDen).toBe(5);
  });

  it("carries actualRunners and isHandicap through untouched", () => {
    const race = toSettlementRace(raceRow({ actualRunners: 16, isHandicap: true }));
    expect(race.actualRunners).toBe(16);
    expect(race.isHandicap).toBe(true);
    // Null must stay null — settle() refuses on it rather than assuming a field
    // size (docs/08 D3).
    expect(toSettlementRace(raceRow({ actualRunners: null })).actualRunners).toBeNull();
  });
});
