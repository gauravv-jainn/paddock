import { describe, expect, it } from "vitest";
import { compareFractions, type Fraction } from "./fraction";
import { lookupRule4Band, RULE4_TABLE } from "./rule4";

const f = (num: number, den: number): Fraction => ({ num, den });
function deductionAt(num: number, den: number): number {
  const r = lookupRule4Band(f(num, den));
  if (!r.ok) throw new Error(`expected a band for ${num}/${den}: ${r.reason}`);
  return r.band.deduction;
}

describe("the table itself", () => {
  it("has nineteen rows with unique deductions", () => {
    expect(RULE4_TABLE.rows).toHaveLength(19);
    expect(new Set(RULE4_TABLE.rows.map((r) => r.deduction)).size).toBe(19);
  });

  it("records what is known about its provenance and what is not", () => {
    expect(RULE4_TABLE.checkedOn).toBe("2026-07-29");
    // money.md asks for versioning by effective date. No source states one, so
    // it is null rather than invented — see the comment on RuleTable.
    expect(RULE4_TABLE.effectiveFrom).toBeNull();
  });

  it("is contiguous: no gap between one band's ceiling and the next's floor", () => {
    // A gap is a price with no deduction. Given docs/08 D14 abolished the
    // decimal conversion, the fractional table must itself be total.
    const rows = [...RULE4_TABLE.rows].sort((a, b) => b.deduction - a.deduction);
    for (let i = 1; i < rows.length; i += 1) {
      const lower = rows[i - 1]!;
      const upper = rows[i]!;
      if (!lower.to || !upper.from) continue;
      expect(
        compareFractions(upper.from, lower.to),
        `${upper.deduction}p starts at ${upper.published} which does not follow ` +
          `${lower.deduction}p ending at ${lower.published}`,
      ).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("docs/08 D21 — evidence confidence", () => {
  it("marks consensus-only exactly where no worked example exists", () => {
    // Asserted rather than trusted: the literals and the flag are two separate
    // fields and could drift apart on any edit.
    for (const row of RULE4_TABLE.rows) {
      const expected = row.computedCount === 0 ? "consensus-only" : "computed-confirmed";
      expect(row.evidenceConfidence, `${row.deduction}p band`).toBe(expected);
    }
  });

  it("names the odds-on bands as the consensus-only ones", () => {
    const consensusOnly = RULE4_TABLE.rows
      .filter((r) => r.evidenceConfidence === "consensus-only")
      .map((r) => r.deduction)
      .sort((a, b) => b - a);
    // Rows 1-9 (90p..50p) plus 10p and 0p. These move the most money and are
    // the least independently confirmed — the reason D21 exists.
    expect(consensusOnly).toEqual([90, 85, 80, 75, 70, 65, 60, 55, 50, 10, 0]);
  });

  it("never claims more sources than exist", () => {
    for (const row of RULE4_TABLE.rows) {
      expect(row.sourceCount).toBeGreaterThanOrEqual(1);
      expect(row.sourceCount).toBeLessThanOrEqual(6);
      expect(row.computedCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("surfaces row 15's three competing values", () => {
    const row15 = RULE4_TABLE.rows.find((r) => r.deduction === 20)!;
    expect(row15.sourceCount).toBe(4); // weakest in the table
    expect(row15.disputed?.competing).toHaveLength(3);
    expect(row15.disputed?.competing.join(" ")).toMatch(/16\/5.*100\/30.*16\/15/s);
  });
});

describe("lookup — band boundaries are inclusive at both ends", () => {
  it.each([
    // exact published bounds, both ends of every closed band
    [1, 9, 90],
    [2, 17, 85],
    [2, 11, 85],
    [1, 5, 80],
    [1, 4, 80],
    [2, 7, 75],
    [3, 10, 75],
    [1, 3, 70],
    [2, 5, 70],
    [4, 9, 65],
    [8, 15, 65],
    [4, 7, 60],
    [8, 13, 60],
    [4, 6, 55],
    [4, 5, 55],
    [5, 6, 50],
    [20, 21, 50],
    [1, 1, 45],
    [6, 5, 45],
    [5, 4, 40],
    [6, 4, 40],
    [8, 5, 35],
    [7, 4, 35],
    [9, 5, 30],
    [9, 4, 30],
    [12, 5, 25],
    [3, 1, 25],
    [16, 5, 20],
    [4, 1, 20],
    [9, 2, 15],
    [11, 2, 15],
    [6, 1, 10],
    [9, 1, 10],
    [10, 1, 5],
    [14, 1, 5],
  ])("%i/%i -> %ip", (num, den, expected) => {
    expect(deductionAt(num, den)).toBe(expected);
  });

  it("puts 14/1 itself in the 5p band and anything longer at zero", () => {
    // Row 19's bound is EXCLUSIVE; the bands abut rather than overlap.
    expect(deductionAt(14, 1)).toBe(5);
    expect(deductionAt(15, 1)).toBe(0);
    expect(deductionAt(100, 1)).toBe(0);
  });

  it("puts anything shorter than 1/9 in the 90p band", () => {
    expect(deductionAt(1, 9)).toBe(90);
    expect(deductionAt(1, 20)).toBe(90);
    expect(deductionAt(1, 100)).toBe(90);
  });

  it("resolves the evens band that docs/08 D19 decided", () => {
    // Three readings existed: 45p (adopted), 50p, 55p. O6 stays open.
    expect(deductionAt(1, 1)).toBe(45);
  });

  it("treats equal prices written differently as the same band", () => {
    // 6/4 and 3/2 are the same price. A string comparison would not know.
    expect(deductionAt(6, 4)).toBe(deductionAt(3, 2));
    expect(deductionAt(4, 6)).toBe(deductionAt(2, 3));
  });
});

describe("lookup — prices between published bounds", () => {
  it.each([
    // Prices that exist on the ladder but are not band boundaries.
    [2, 1, 30], // 2/1 sits inside 9/5-9/4. pub-r4-003 confirms 30p.
    [5, 1, 15], // inside 9/2-11/2. pub-r4-006 and racing-index confirm 15p.
    [12, 1, 5], // inside 10/1-14/1. pub-r4-005 confirms 5p.
    [8, 1, 10], // inside 6/1-9/1.
    [11, 10, 45], // inside evens-6/5.
  ])("%i/%i -> %ip", (num, den, expected) => {
    expect(deductionAt(num, den)).toBe(expected);
  });

  it("never returns zero for a price inside a deducting band", () => {
    // A silent zero is a full payout on a race that owed a deduction — the
    // worst failure this table can have.
    for (let num = 1; num <= 14; num += 1) {
      expect(deductionAt(num, 1), `${num}/1`).toBeGreaterThan(0);
    }
  });
});

describe("the lookup does not divide", () => {
  it("resolves prices whose decimal form is not exactly representable", () => {
    // 8/13 is 1.6153846..., 20/21 is 1.9523809..., 4/7 is 1.5714285... Twelve
    // ladder prices cannot be held exactly at NUMERIC(10,3). Comparing by
    // cross multiplication makes that irrelevant — docs/08 D14.
    expect(deductionAt(8, 13)).toBe(60);
    expect(deductionAt(20, 21)).toBe(50);
    expect(deductionAt(4, 7)).toBe(60);
    expect(deductionAt(1, 3)).toBe(70);
  });

  it("distinguishes two prices that round to the same 3dp decimal", () => {
    // 2001/1000 and 2003/1000 both round to 3.001 as decimal odds but are
    // different fractions. Integer comparison keeps them distinct.
    const a = f(20001, 10000);
    const b = f(20003, 10000);
    expect(compareFractions(a, b)).toBe(-1);
  });
});

describe("prices the published scale does not describe — docs/08 D22", () => {
  it("refuses rather than throwing, and never invents a neighbouring band", () => {
    // 49/50 lies between 20/21 (top of the 50p band) and Evens (floor of 45p);
    // 37/12 lies between 3/1 and 16/5. The Tattersalls scale is defined over
    // rungs of the ladder and simply does not cover these.
    for (const [num, den] of [
      [49, 50],
      [37, 12],
    ] as const) {
      const r = lookupRule4Band(f(num, den));
      expect(r.ok, `${num}/${den} should not resolve`).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/between two published bands/);
    }
  });

  it("a refusal is NOT a zero deduction", () => {
    // The failure that would matter: treating "no band" as 0p pays out in
    // full on a race that owed a deduction.
    const r = lookupRule4Band(f(37, 12));
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("band");
  });

  it("still throws for a non-price, which is programmer error not business", () => {
    expect(() => lookupRule4Band(f(0, 1))).toThrow(RangeError);
    expect(() => lookupRule4Band(f(1, 0))).toThrow(RangeError);
  });
});


describe("the exclusive floor on the final band — docs/05 §5.1 row 19", () => {
  /**
   * Row 19 is "over 14/1", and its floor is EXCLUSIVE because 14/1 itself
   * belongs to row 18 ("10/1 - 14/1", 5p). Every other row's floor is
   * inclusive. Two mutants live here: dropping `fromExclusive` entirely, and
   * turning the `>` into `>=`. Either one hands 14/1 to the 0p band and
   * silently stops deducting on a race that owed 5p in the pound.
   */
  it("gives 14/1 EXACTLY to the 5p band, not to the 0p band above it", () => {
    const found = lookupRule4Band({ num: 14, den: 1 });
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.band.deduction).toBe(5);
      expect(found.band.published).toBe("10/1 - 14/1");
      // And it is not the exclusive-floor row that happens to also match.
      expect(found.band.fromExclusive).toBeUndefined();
    }
  });

  it("gives anything longer than 14/1 to the 0p band", () => {
    for (const price of [
      { num: 15, den: 1 },
      { num: 100, den: 1 },
      { num: 29, den: 2 },
    ]) {
      const found = lookupRule4Band(price);
      expect(found.ok).toBe(true);
      if (found.ok) {
        expect(found.band.deduction).toBe(0);
        expect(found.band.fromExclusive).toBe(true);
      }
    }
  });

  it("keeps every OTHER band's floor inclusive", () => {
    // The counterpart assertion: if `fromExclusive` were treated as true
    // everywhere, each band's own floor price would fall through to the next
    // row down and every deduction in the table would be wrong by one rung —
    // which is the exact shape of the ten-row error docs/08 records.
    const found = lookupRule4Band({ num: 10, den: 1 });
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.band.deduction).toBe(5);
  });
});


describe("the bands are order-independent, not merely well-typed", () => {
  /**
   * Searching the table REVERSED must give the same answer for every price.
   *
   * Against the shipped ordering, row 18 ("10/1 - 14/1") is checked before row
   * 19 ("over 14/1"), so row 19's exclusive floor never decides anything.
   * Reversed, row 19 is checked first and its `fromExclusive` flag is the only
   * thing standing between 14/1 and a 0p deduction on a race that owed 5p.
   *
   * This matters because the ten-row error in docs/05 §5.1 was an ordering
   * error. A table whose meaning depends on the sequence someone typed it in
   * is one transcription away from the same failure.
   */
  const reversed: typeof RULE4_TABLE = {
    ...RULE4_TABLE,
    rows: [...RULE4_TABLE.rows].reverse(),
  };

  it("gives 14/1 the 5p band even when the 0p band is checked FIRST", () => {
    const found = lookupRule4Band({ num: 14, den: 1 }, reversed);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.band.deduction).toBe(5);
  });

  it("agrees with the shipped ordering on every published bound", () => {
    const prices: Array<[number, number]> = [];
    for (const band of RULE4_TABLE.rows) {
      if (band.from) prices.push([band.from.num, band.from.den]);
      if (band.to) prices.push([band.to.num, band.to.den]);
    }
    prices.push([15, 1], [100, 1], [1, 20]);
    expect(prices.length).toBeGreaterThan(30);

    for (const [num, den] of prices) {
      const shipped = lookupRule4Band({ num, den });
      const other = lookupRule4Band({ num, den }, reversed);
      expect(other.ok).toBe(shipped.ok);
      if (shipped.ok && other.ok) {
        expect(
          other.band.deduction,
          `${num}/${den} differs when the table is reversed`,
        ).toBe(shipped.band.deduction);
      }
    }
  });
});
