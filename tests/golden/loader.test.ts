import { describe, expect, it } from "vitest";
import {
  loadPublishedVectors,
  unsettleableUnderD14,
  type LoadedVector,
} from "./loader";

/**
 * Tests the loader, not the settlement engine — there is no settle() yet.
 *
 * The load itself is the assertion for most of these: loadPublishedVectors
 * throws on a duplicate id, a missing source quote, a money value that is not
 * a digit string, an each-way total that is not twice its unit, a non-integer
 * Rule 4 fraction, or a disputed vector with no stated reason.
 */
const suite = loadPublishedVectors();

describe("published.json loads", () => {
  it("parses every vector", () => {
    expect(suite.all.length).toBeGreaterThanOrEqual(25);
    expect(suite.all).toHaveLength(suite.graded.length + suite.disputed.length);
  });

  it("hands back money as bigint, never as number", () => {
    for (const v of suite.all) {
      expect(typeof v.expectedReturn).toBe("bigint");
      expect(typeof v.stake).toBe("bigint");
    }
  });

  it("keeps every expected value tied to a published quote", () => {
    for (const v of suite.all) {
      expect(v.sourceQuote.length).toBeGreaterThan(0);
      expect(v.sourceFile).toMatch(/^docs\/sources\//);
    }
  });
});

describe("docs/08 D15 — disputed vectors are reported, not graded", () => {
  it("excludes the disputed vector from the graded set", () => {
    expect(suite.disputed.length).toBeGreaterThan(0);
    const gradedIds = new Set(suite.graded.map((v) => v.id));
    for (const v of suite.disputed) {
      expect(gradedIds.has(v.id)).toBe(false);
    }
  });

  it("still exposes it, with its reason, so it stays visible", () => {
    for (const v of suite.disputed) {
      expect(v.expectedDisputed).toBe(true);
      expect(v.expectedDisputedReason).toBeTruthy();
      expect(suite.all.map((a) => a.id)).toContain(v.id);
    }
  });

  it("holds the three-way dead heat specifically", () => {
    // The source rounds the divided stake to £3.33 before multiplying, giving
    // £23.31 where rounding once at the end gives £23.33. money.md wins.
    const dh = suite.disputed.find((v) => v.id === "pub-dh-002-three-way");
    expect(dh).toBeDefined();
    expect(dh!.expectedReturn).toBe(2331n);
    expect(dh!.outcome.deadHeatCount).toBe(3);
  });
});

describe("docs/08 D14 — the Rule 4 lookup input is a fraction", () => {
  const withFraction = suite.all.filter((v) => v.race.withdrawnAtFraction);

  it("carries integer pairs, never a decimal, for every stated withdrawal", () => {
    expect(withFraction.length).toBeGreaterThan(0);
    for (const v of withFraction) {
      const fr = v.race.withdrawnAtFraction!;
      for (const one of Array.isArray(fr) ? fr : [fr]) {
        expect(Number.isInteger(one.num)).toBe(true);
        expect(Number.isInteger(one.den)).toBe(true);
      }
    }
  });

  it("agrees with the decimal each source also states", () => {
    // Cross-check only — the decimal is display-only and settle() never reads
    // it. If these ever disagree, the fixture is wrong.
    for (const v of withFraction) {
      const fr = v.race.withdrawnAtFraction!;
      const dec = v.race.withdrawnAtOdds;
      if (dec === undefined) continue;
      const frs = Array.isArray(fr) ? fr : [fr];
      const decs = Array.isArray(dec) ? dec : [dec];
      expect(frs).toHaveLength(decs.length);
      frs.forEach((one, i) => {
        expect(one.num / one.den + 1).toBeCloseTo(decs[i]!, 3);
      });
    }
  });

  it("reports nothing unsettleable — every stated withdrawal has a fraction", () => {
    const blocked: LoadedVector[] = unsettleableUnderD14(suite);
    expect(blocked.map((v) => v.id)).toEqual([]);
  });

  it("does not treat a given rule4Pence with no withdrawn price as unsettleable", () => {
    // pub-r4-001 and pub-r4-002 state a deduction outright, so the band lookup
    // never runs and D14 does not apply to them.
    const givenDeduction = suite.all.filter(
      (v) =>
        (v.race.rule4Pence ?? 0) > 0 && v.race.withdrawnAtOdds === undefined,
    );
    expect(givenDeduction.map((v) => v.id).sort()).toEqual([
      "pub-r4-001",
      "pub-r4-002",
    ]);
    for (const v of givenDeduction) {
      expect(unsettleableUnderD14(suite)).not.toContain(v);
    }
  });
});
