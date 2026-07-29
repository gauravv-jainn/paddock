import { describe, expect, it } from "vitest";
import {
  compareFractions,
  formatFraction,
  fractionsEqual,
  toDecimalForDisplay,
  type Fraction,
} from "./fraction";

const f = (num: number, den: number): Fraction => ({ num, den });

describe("compareFractions", () => {
  it("orders prices correctly", () => {
    expect(compareFractions(f(1, 2), f(1, 1))).toBe(-1);
    expect(compareFractions(f(1, 1), f(1, 2))).toBe(1);
    expect(compareFractions(f(1, 1), f(1, 1))).toBe(0);
  });

  it("treats equal prices written differently as equal", () => {
    expect(compareFractions(f(6, 4), f(3, 2))).toBe(0);
    expect(compareFractions(f(100, 30), f(10, 3))).toBe(0);
    expect(compareFractions(f(4, 6), f(2, 3))).toBe(0);
  });

  it("separates prices a 3dp decimal would collapse", () => {
    // Both are 1.615 as decimal odds at NUMERIC(10,3) scale. The whole point
    // of docs/08 D14 is that these stay distinct.
    expect(compareFractions(f(8, 13), f(615, 1000))).not.toBe(0);
  });

  it("is antisymmetric and transitive across the ladder", () => {
    const ladder = [f(1, 9), f(1, 2), f(1, 1), f(2, 1), f(14, 1), f(100, 1)];
    for (let i = 0; i < ladder.length; i += 1) {
      for (let j = 0; j < ladder.length; j += 1) {
        const a = ladder[i]!;
        const b = ladder[j]!;
        // Sum rather than negation: -compare(b,a) yields -0 when the result
        // is 0, and Object.is distinguishes -0 from 0.
        expect(compareFractions(a, b) + compareFractions(b, a)).toBe(0);
      }
    }
    expect(compareFractions(ladder[0]!, ladder[2]!)).toBe(-1);
    expect(compareFractions(ladder[2]!, ladder[4]!)).toBe(-1);
    expect(compareFractions(ladder[0]!, ladder[4]!)).toBe(-1);
  });
});

describe("fractionsEqual", () => {
  it("is equality by value, not by representation", () => {
    expect(fractionsEqual(f(6, 4), f(3, 2))).toBe(true);
    expect(fractionsEqual(f(16, 5), f(100, 30))).toBe(false);
  });
});

describe("formatFraction", () => {
  it("prints the pair as published", () => {
    expect(formatFraction(f(16, 5))).toBe("16/5");
    expect(formatFraction(f(1, 1))).toBe("1/1");
  });
});

describe("toDecimalForDisplay", () => {
  it("converts for display only", () => {
    expect(toDecimalForDisplay(f(1, 1))).toBe(2);
    expect(toDecimalForDisplay(f(5, 1))).toBe(6);
    expect(toDecimalForDisplay(f(1, 2))).toBe(1.5);
  });

  it("is lossy for twelve ladder prices — which is why it is display-only", () => {
    // 8/13 is 1.6153846..., not representable at NUMERIC(10,3). Round-tripping
    // through this function and back is exactly the conversion D14 abolished
    // from the settlement path.
    const exact = toDecimalForDisplay(f(8, 13));
    expect(Number(exact.toFixed(3))).not.toBe(exact);
  });
});
