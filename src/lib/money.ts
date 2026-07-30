/**
 * Display formatting for GBP pence.
 *
 * The conversion to pounds is done with bigint division and remainder, NOT by
 * dividing by 100 in floating point. `Number(1234567890123n) / 100` is already
 * wrong, and the money path forbids a float touching a monetary value
 * (.claude/rules/money.md) — including on the way to a screen, because a
 * display that disagrees with the ledger is a support ticket.
 */

const PENCE_PER_POUND = 100n;

export function formatPence(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const pounds = abs / PENCE_PER_POUND;
  const pence = abs % PENCE_PER_POUND;
  const grouped = pounds.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}£${grouped}.${pence.toString().padStart(2, "0")}`;
}

/** With an explicit sign, for a profit-and-loss figure. */
export function formatSignedPence(minor: bigint): string {
  if (minor > 0n) return `+${formatPence(minor)}`;
  return formatPence(minor);
}

/** Pounds-and-pence entered by a user, back to pence. Refuses anything else. */
export function parsePoundsToPence(input: string): bigint | null {
  const trimmed = input.trim().replace(/^£/, "").replace(/,/g, "");
  // Never parseFloat. The string is decomposed and each half parsed as an
  // integer, so 10.10 cannot become 1009 pence on the way through a double.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const pounds = BigInt(match[1] as string);
  const pence = BigInt((match[2] ?? "0").padEnd(2, "0"));
  return pounds * PENCE_PER_POUND + pence;
}

export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatOdds(decimal: number): string {
  return decimal.toFixed(2);
}
