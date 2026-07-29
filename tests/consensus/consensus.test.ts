import { describe, expect, it } from "vitest";
import { IMPLEMENTED, SOURCES, type Band, type Fraction } from "./sources";

/**
 * Layer 4 of `docs/08` D20 — table consensus as a permanent gate.
 *
 * Every row of the `docs/05` §5.1 band table must agree with at least
 * MIN_SOURCES independent published tables. A row below that threshold fails
 * the build and prints the competing values with their sources.
 *
 * This is the answer to "fourteen bands are constrained by nothing". They are
 * now constrained by consensus, at a stated confidence level, and the level is
 * checked on every run rather than asserted once in a markdown file.
 *
 * It is NOT a substitute for a primary source. Six guides agreeing could be six
 * copies of one wrong original — a correlated-error risk this cannot see. O4
 * stays open.
 */
const MIN_SOURCES = 3;

/** Compare by value, so 6/4 and 3/2 agree. Cross-multiplied — docs/08 D14. */
function sameFraction(a: Fraction | null, b: Fraction | null): boolean {
  if (a === null || b === null) return a === b;
  return a.num * b.den === b.num * a.den;
}

function sameBand(a: Band, b: Band): boolean {
  return sameFraction(a.from, b.from) && sameFraction(a.to, b.to);
}

const show = (fr: Fraction | null): string => (fr ? `${fr.num}/${fr.den}` : "open");
const showBand = (b: Band): string => `${show(b.from)}..${show(b.to)}`;

interface RowTally {
  deduction: number;
  agreeing: string[];
  dissenting: Array<{ id: string; published: string; band: string }>;
}

function tally(): RowTally[] {
  return IMPLEMENTED.map((impl) => {
    const agreeing: string[] = [];
    const dissenting: RowTally["dissenting"] = [];
    for (const source of SOURCES) {
      const band = source.bands.find((b) => b.deduction === impl.deduction);
      if (band && sameBand(band, impl)) agreeing.push(source.id);
      else if (band) {
        dissenting.push({ id: source.id, published: band.published, band: showBand(band) });
      }
    }
    return { deduction: impl.deduction, agreeing, dissenting };
  });
}

const TALLY = tally();

describe("the encoding itself is sound", () => {
  it("has six sources, each with all nineteen rows", () => {
    expect(SOURCES).toHaveLength(6);
    for (const s of SOURCES) {
      expect(s.bands, `${s.id} row count`).toHaveLength(19);
      const deductions = s.bands.map((b) => b.deduction);
      expect(new Set(deductions).size, `${s.id} duplicate deduction`).toBe(19);
    }
  });

  it("names a verbatim capture for every source, so each value is auditable", () => {
    for (const s of SOURCES) {
      expect(s.file, s.id).toMatch(/^docs\/sources\/rule4-.*\.txt$/);
      expect(s.fetched, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("keeps the implemented table in sequence: bands never overlap", () => {
    // A table that overlaps has no single answer for a price in the overlap.
    // This is the property racing-index's row 15 violates.
    const ordered = [...IMPLEMENTED].sort((a, b) => b.deduction - a.deduction);
    for (let i = 1; i < ordered.length; i += 1) {
      const lower = ordered[i - 1]!; // larger deduction, shorter price
      const upper = ordered[i]!;
      if (!lower.to || !upper.from) continue;
      const lowerTop = lower.to.num / lower.to.den;
      const upperBottom = upper.from.num / upper.from.den;
      const message =
        `band ${upper.deduction}p starts at ${show(upper.from)} which overlaps ` +
        `band ${lower.deduction}p ending at ${show(lower.to)}`;

      if (upper.fromExclusive) {
        // "over 14/1" abuts the 5p band rather than overlapping it: 14/1 itself
        // belongs to the 5p band, and anything longer to this one.
        expect(upperBottom, message).toBeGreaterThanOrEqual(lowerTop);
      } else {
        expect(upperBottom, message).toBeGreaterThan(lowerTop);
      }
    }
  });
});

describe("every row of docs/05 §5.1 is backed by at least three sources", () => {
  it.each(TALLY.map((r) => [r.deduction, r] as const))(
    "%ip band",
    (_deduction, row) => {
      const detail =
        row.dissenting.length === 0
          ? ""
          : ` Competing values: ${row.dissenting
              .map((d) => `${d.id} publishes '${d.published}' (${d.band})`)
              .join("; ")}.`;

      expect(
        row.agreeing.length,
        `${row.deduction}p band has only ${row.agreeing.length} source(s) ` +
          `agreeing (${row.agreeing.join(", ") || "none"}), below the threshold ` +
          `of ${MIN_SOURCES}.${detail}`,
      ).toBeGreaterThanOrEqual(MIN_SOURCES);
    },
  );
});

describe("the two known disagreements are surfaced, not hidden", () => {
  it("records racing-index's row 15 as out of sequence", () => {
    const row15 = TALLY.find((r) => r.deduction === 20)!;
    const ri = row15.dissenting.find((d) => d.id === "racing-index");
    expect(ri, "racing-index should dissent at the 20p band").toBeDefined();
    expect(ri!.published).toBe("16/15 - 4/1");

    // 16/15 is 1.067, which is BELOW the 12/5 (2.4) that opens the band above
    // it. A table cannot run 12/5 -> 16/15 -> 9/2. Adopting it would break the
    // no-overlap test above, which is why it is a typo and not a reading.
    expect(16 / 15).toBeLessThan(12 / 5);
  });

  it("records nonrunnerstomorrow's 100/30 as a real two-way disagreement", () => {
    const row15 = TALLY.find((r) => r.deduction === 20)!;
    const nrt = row15.dissenting.find((d) => d.id === "nonrunnerstomorrow");
    expect(nrt!.published).toBe("100/30 - 4/1");

    // Unlike 16/15, 100/30 (3.333) IS in sequence between 3/1 and 9/2, so it
    // cannot be dismissed on arithmetic. It loses on count alone: 4 to 1.
    expect(100 / 30).toBeGreaterThan(3 / 1);
    expect(100 / 30).toBeLessThan(9 / 2);
    expect(row15.agreeing.length).toBeGreaterThan(row15.dissenting.length);
  });

  it("is the weakest row in the table, and says so", () => {
    const weakest = [...TALLY].sort((a, b) => a.agreeing.length - b.agreeing.length)[0]!;
    expect(weakest.deduction).toBe(20);
    expect(weakest.agreeing).toHaveLength(4);
  });
});

describe("the gate can actually fail", () => {
  it("rejects a table row that no source supports", () => {
    // Mutation-in-place: prove the threshold bites rather than trusting that
    // it would. A gate never seen to fail is a gate nobody should believe.
    const tampered: Band = {
      deduction: 45,
      from: { num: 7, den: 7 },
      to: { num: 99, den: 5 },
      published: "invented",
    };
    const agreeing = SOURCES.filter((s) => {
      const b = s.bands.find((x) => x.deduction === 45);
      return b && sameBand(b, tampered);
    });
    expect(agreeing.length).toBeLessThan(MIN_SOURCES);
  });

  it("counts a cosmetic rewrite as agreement, not dissent", () => {
    // 6/4 and 3/2 are the same price. Comparing published strings instead of
    // values would manufacture a disagreement out of formatting.
    const asThirds: Band = {
      deduction: 40,
      from: { num: 5, den: 4 },
      to: { num: 3, den: 2 },
      published: "5/4 - 3/2",
    };
    const impl = IMPLEMENTED.find((b) => b.deduction === 40)!;
    expect(sameBand(asThirds, impl)).toBe(true);
  });
});
