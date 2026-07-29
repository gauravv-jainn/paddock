import { describe, expect, it } from "vitest";
import {
  EnhancedTermsIncompleteError,
  lookupPlaceTerms,
  PLACE_TERMS_TABLE,
} from "./placeTerms";

const terms = (runners: number, handicap: boolean) =>
  lookupPlaceTerms(runners, handicap);

describe("the boundaries .claude/rules/money.md requires", () => {
  /**
   * money.md: "Required boundary coverage: field sizes 4, 5, 7, 8, 11, 12, 15,
   * 16 — both handicap and non-handicap." All sixteen combinations, because
   * these are exactly the sizes where a table row changes.
   */
  it.each([
    // runners, handicap, places, fractionDen
    [4, false, 0, 0],
    [4, true, 0, 0],
    [5, false, 2, 4],
    [5, true, 2, 4],
    [7, false, 2, 4],
    [7, true, 2, 4],
    [8, false, 3, 5],
    [8, true, 3, 5],
    [11, false, 3, 5],
    [11, true, 3, 5],
    [12, false, 3, 5],
    [12, true, 3, 4], // handicap diverges here
    [15, false, 3, 5],
    [15, true, 3, 4],
    [16, false, 3, 5],
    [16, true, 4, 4], // and again here
  ])(
    "%i runners, handicap=%s -> %i places at 1/%i",
    (runners, handicap, places, fractionDen) => {
      const t = terms(runners, handicap);
      expect(t.places).toBe(places);
      expect(t.fractionDen).toBe(fractionDen);
      expect(t.source).toBe("standard");
    },
  );
});

describe("the two places the handicap column diverges", () => {
  it("splits at 12 runners: handicap pays 1/4, non-handicap 1/5", () => {
    expect(terms(11, true).fractionDen).toBe(5);
    expect(terms(12, true).fractionDen).toBe(4);
    expect(terms(12, false).fractionDen).toBe(5);
  });

  it("splits at 16 runners: handicap pays a fourth place", () => {
    expect(terms(15, true).places).toBe(3);
    expect(terms(16, true).places).toBe(4);
    // A non-handicap never pays four, at any field size.
    expect(terms(16, false).places).toBe(3);
    expect(terms(40, false).places).toBe(3);
  });
});

describe("small fields", () => {
  it.each([1, 2, 3, 4])("%i runners pays no places at all", (n) => {
    for (const handicap of [true, false]) {
      const t = terms(n, handicap);
      expect(t.places).toBe(0);
      expect(t.fractionDen).toBe(0);
    }
  });

  it("starts paying at 5 runners", () => {
    expect(terms(5, false).places).toBe(2);
  });
});

describe("non-handicap 8+ has no upper bound", () => {
  it("still pays 3 at 1/5 in a very large field", () => {
    // Two sources cap the non-handicap row (at 11 and at 15 runners), which
    // would leave a 20-runner non-handicap with no row. It resolves here.
    for (const n of [12, 16, 20, 30]) {
      const t = terms(n, false);
      expect(t.places, `${n} runners`).toBe(3);
      expect(t.fractionDen).toBe(5);
    }
  });
});

describe("the disputed handicap 12-15 row carries its dispute", () => {
  it("hands the note through so the settlement view can show it", () => {
    const t = terms(13, true);
    expect(t.fractionDen).toBe(4);
    expect(t.disputed?.competing).toMatch(/theracelab/);
  });

  it("does not attach a dispute to undisputed rows", () => {
    expect(terms(9, true).disputed).toBeUndefined();
    expect(terms(20, false).disputed).toBeUndefined();
  });
});

describe("docs/08 D18 — enhanced terms override verbatim", () => {
  it("uses the enhanced terms and does not consult the table", () => {
    // A 16-runner handicap would be 4 places at 1/4 as standard. With a
    // six-place offer it must be six, not the larger or the standard.
    const t = lookupPlaceTerms(16, true, { places: 6, fractionDen: 5 });
    expect(t.places).toBe(6);
    expect(t.fractionDen).toBe(5);
    expect(t.source).toBe("enhanced");
  });

  it("applies even where standard terms would pay nothing", () => {
    const t = lookupPlaceTerms(4, false, { places: 2, fractionDen: 4 });
    expect(t.places).toBe(2);
    expect(t.source).toBe("enhanced");
  });

  it("falls back to standard when no override is given", () => {
    expect(lookupPlaceTerms(16, true, null).source).toBe("standard");
    expect(lookupPlaceTerms(16, true, undefined).source).toBe("standard");
  });

  it("rejects half an override rather than guessing the other half", () => {
    // The database rejects this too (races_enhanced_terms_complete); reaching
    // here means it was constructed in code.
    for (const bad of [
      { places: 6, fractionDen: 0 },
      { places: 0, fractionDen: 4 },
      { places: -1, fractionDen: 4 },
      { places: 6.5, fractionDen: 4 },
    ]) {
      expect(() => lookupPlaceTerms(16, true, bad)).toThrow(
        EnhancedTermsIncompleteError,
      );
    }
  });
});

describe("bad input refuses rather than defaulting", () => {
  it.each([0, -1, 1.5, Number.NaN])("rejects %s runners", (n) => {
    expect(() => terms(n, false)).toThrow(RangeError);
  });
});

describe("the table itself", () => {
  it("records its provenance", () => {
    expect(PLACE_TERMS_TABLE.checkedOn).toBe("2026-07-29");
    expect(PLACE_TERMS_TABLE.effectiveFrom).toBeNull();
  });

  it("covers every field size for both race types", () => {
    // Total, so no runner count can fall through to the throw.
    for (let n = 1; n <= 40; n += 1) {
      for (const handicap of [true, false]) {
        expect(() => terms(n, handicap), `${n}/${String(handicap)}`).not.toThrow();
      }
    }
  });
});
