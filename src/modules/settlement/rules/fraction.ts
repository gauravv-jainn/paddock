/**
 * Fractional prices as integer pairs — `docs/08` D14.
 *
 * The Rule 4 bands are published fractionally because the deduction is set from
 * the bookmaker's announced board price, which lives on the fractional ladder
 * by construction. Storing a decimal and converting inverts the domain and
 * creates gaps that do not exist in the rule; doing exactly that put a ten-row
 * error into `docs/05` §5.1.
 *
 * So a price is two integers here, and comparison never divides.
 */

export interface Fraction {
  num: number;
  den: number;
}

/**
 * Compares two fractional prices. Returns -1, 0 or 1.
 *
 * `a/b` vs `c/d` by cross multiplication: `a*d` vs `c*b`. Denominators are
 * positive, so the inequality direction is preserved and no division — and
 * therefore no float, and therefore no rounding — enters the comparison.
 */
export function compareFractions(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const left = a.num * b.den;
  const right = b.num * a.den;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** True when the two pairs are the same price. 6/4 and 3/2 are equal. */
export function fractionsEqual(a: Fraction, b: Fraction): boolean {
  return compareFractions(a, b) === 0;
}

export function formatFraction(f: Fraction): string {
  return `${f.num}/${f.den}`;
}

/**
 * Decimal odds for a fractional price: `num/den + 1`.
 *
 * DISPLAY AND ANALYTICS ONLY. Never use this to pick a Rule 4 band — that is
 * the conversion D14 exists to abolish, and `NUMERIC(10,3)` cannot represent
 * twelve of the ladder's prices exactly anyway (`8/13` is 1.6153846…).
 */
export function toDecimalForDisplay(f: Fraction): number {
  return f.num / f.den + 1;
}
