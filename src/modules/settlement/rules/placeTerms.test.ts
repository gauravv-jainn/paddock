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


describe("the disputed marker appears only where a dispute exists", () => {
  it("omits `disputed` entirely on an undisputed row", () => {
    // Only the handicap 12-15 row carries a competing published value. A
    // `disputed` key present on every row would put a caveat on the settlement
    // detail screen for terms that nobody disputes, and a caveat that appears
    // everywhere is one a reader learns to ignore.
    const terms = lookupPlaceTerms(10, false);
    expect(terms.places).toBe(3);
    expect("disputed" in terms).toBe(false);
    expect(terms.disputed).toBeUndefined();
  });

  it("carries `disputed` on the handicap 12-15 row", () => {
    const terms = lookupPlaceTerms(13, true);
    expect(terms.disputed).toBeDefined();
    // `competing` is a string here, not an array as it is on a Rule 4 band.
    expect(terms.disputed?.competing).toMatch(/1\/5/);
  });

  it.each([
    [4, false],
    [5, false],
    [7, true],
    [8, true],
    [16, true],
    [16, false],
  ])("omits `disputed` for %i runners, handicap=%s", (runners, handicap) => {
    expect("disputed" in lookupPlaceTerms(runners, handicap)).toBe(false);
  });
});


describe("the place-terms rows are order-independent", () => {
  /**
   * The `actualRunners < row.minRunners` guard is what makes this true. Against
   * the shipped ordering — contiguous and ascending — it can never fire, so
   * only a reordered table can tell it from its own absence.
   *
   * Reversed, the open-ended rows ("16+ handicap", "8+ non-handicap") are
   * checked FIRST, and without the guard a 5-runner handicap would match the
   * 16+ row and pay four places on a field that pays two.
   */
  const reversed: typeof PLACE_TERMS_TABLE = {
    ...PLACE_TERMS_TABLE,
    rows: [...PLACE_TERMS_TABLE.rows].reverse(),
  };

  it("does not pay a small field on an open-ended row checked first", () => {
    const terms = lookupPlaceTerms(5, true, null, reversed);
    expect(terms.places).toBe(2);
    expect(terms.fractionDen).toBe(4);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 15, 16, 17, 24, 40])(
    "agrees with the shipped ordering for %i runners, both race types",
    (runners) => {
      for (const isHandicap of [true, false]) {
        const shipped = lookupPlaceTerms(runners, isHandicap);
        const other = lookupPlaceTerms(runners, isHandicap, null, reversed);
        expect(
          { places: other.places, fractionDen: other.fractionDen },
          `${runners} runners, handicap=${isHandicap}`,
        ).toEqual({ places: shipped.places, fractionDen: shipped.fractionDen });
      }
    },
  );
});


describe("the guards that the shipped table makes unreachable", () => {
  it("REFUSES when no row covers the field, rather than paying zero places", () => {
    // Unreachable against the shipped table, which is total — proved by the
    // "covers every field size" test above. Reachable through the table
    // parameter, and worth reaching: silently paying no places on a race that
    // owed three is the same class of bug as a silent zero deduction.
    const gappy: typeof PLACE_TERMS_TABLE = {
      ...PLACE_TERMS_TABLE,
      rows: PLACE_TERMS_TABLE.rows.filter((r) => r.minRunners !== 1),
    };
    expect(() => lookupPlaceTerms(3, false, null, gappy)).toThrow(
      /no place-terms row for 3 runners, isHandicap=false/,
    );
  });

  it("names its own error type, so a catch can distinguish it", () => {
    try {
      lookupPlaceTerms(16, true, { places: 6, fractionDen: 0 });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as Error).name).toBe("EnhancedTermsIncompleteError");
      expect(error).toBeInstanceOf(EnhancedTermsIncompleteError);
    }
  });
});
