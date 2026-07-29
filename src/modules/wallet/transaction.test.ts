import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildEntries,
  InvalidTransactionError,
  sumByWallet,
  UnbalancedTransactionError,
  type EntryType,
  type TransactionInput,
  type TransactionLine,
} from "./transaction";

const WALLET_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
] as const;

const ENTRY_TYPE: EntryType = "STAKE";

/** Non-zero signed minor amounts, within a range a real bankroll could reach. */
const amountArb = fc
  .bigInt({ min: -100_000_000n, max: 100_000_000n })
  .filter((n) => n !== 0n);

const walletArb = fc.constantFrom(...WALLET_IDS);

/**
 * A transaction whose lines sum to zero by construction: n-1 free amounts plus
 * a balancing line. This is the shape every real caller produces.
 */
const balancedTxnArb = fc
  .tuple(
    fc.uuid(),
    fc.array(fc.tuple(walletArb, amountArb), { minLength: 1, maxLength: 6 }),
    walletArb,
  )
  .map(([txnId, parts, balancingWallet]) => {
    const total = parts.reduce((acc, [, amount]) => acc + amount, 0n);
    const lines: TransactionLine[] = parts.map(([walletId, amountMinor]) => ({
      walletId,
      amountMinor,
      entryType: ENTRY_TYPE,
    }));
    lines.push({
      walletId: balancingWallet,
      amountMinor: -total,
      entryType: ENTRY_TYPE,
    });
    return { txnId, lines };
  })
  // A balancing line of zero is not writable; the ledger forbids zero amounts.
  .filter(({ lines }) => lines.every((l) => l.amountMinor !== 0n));

/**
 * Arbitrary lines with no zero-sum guarantee. Most of these must be rejected —
 * feeding them in is what makes the invariant properties below non-trivial.
 */
const arbitraryTxnArb = fc.record({
  txnId: fc.uuid(),
  lines: fc.array(
    fc.record({
      walletId: walletArb,
      amountMinor: amountArb,
      entryType: fc.constant(ENTRY_TYPE),
    }),
    { minLength: 0, maxLength: 6 },
  ),
});

/**
 * A balanced set with a zero line spliced in. Adding zero does not change the
 * sum, so the zero-amount rule is the only thing that can reject these — which
 * is what makes them a real test of it.
 */
const balancedWithZeroLineArb = fc
  .tuple(balancedTxnArb, walletArb, fc.nat())
  .map(([txn, walletId, at]) => {
    const lines = [...txn.lines];
    lines.splice(at % (lines.length + 1), 0, {
      walletId,
      amountMinor: 0n,
      entryType: ENTRY_TYPE,
    });
    return { txnId: txn.txnId, lines };
  });

const anyTxnArb = fc.oneof(balancedTxnArb, arbitraryTxnArb, balancedWithZeroLineArb);

/**
 * An independent restatement of the three rules in buildEntries. The tests
 * below compare buildEntries against this rather than against itself, so a
 * rule deleted from the implementation shows up as a disagreement.
 */
function shouldBeAccepted(txn: TransactionInput): boolean {
  if (txn.lines.length < 2) return false;
  if (txn.lines.some((l) => l.amountMinor === 0n)) return false;
  return txn.lines.reduce((acc, l) => acc + l.amountMinor, 0n) === 0n;
}

function tryBuild(
  txn: TransactionInput,
): { accepted: true; lines: TransactionLine[] } | { accepted: false; error: unknown } {
  try {
    return { accepted: true, lines: buildEntries(txn) };
  } catch (error) {
    return { accepted: false, error };
  }
}

describe("buildEntries", () => {
  it("accepts a balanced transaction unchanged", () => {
    const lines: TransactionLine[] = [
      { walletId: WALLET_IDS[0], amountMinor: -2_500n, entryType: "STAKE" },
      { walletId: WALLET_IDS[1], amountMinor: 2_500n, entryType: "STAKE" },
    ];
    expect(buildEntries({ txnId: "t", lines })).toEqual(lines);
  });

  it("rejects a transaction with fewer than two lines", () => {
    expect(() =>
      buildEntries({
        txnId: "t",
        lines: [
          { walletId: WALLET_IDS[0], amountMinor: 1n, entryType: "STAKE" },
        ],
      }),
    ).toThrow(InvalidTransactionError);
  });

  it("rejects a zero-amount line", () => {
    expect(() =>
      buildEntries({
        txnId: "t",
        lines: [
          { walletId: WALLET_IDS[0], amountMinor: 0n, entryType: "STAKE" },
          { walletId: WALLET_IDS[1], amountMinor: 0n, entryType: "STAKE" },
        ],
      }),
    ).toThrow(InvalidTransactionError);
  });

  it("rejects an unbalanced transaction", () => {
    expect(() =>
      buildEntries({
        txnId: "t",
        lines: [
          { walletId: WALLET_IDS[0], amountMinor: -2_500n, entryType: "STAKE" },
          { walletId: WALLET_IDS[1], amountMinor: 2_400n, entryType: "STAKE" },
        ],
      }),
    ).toThrow(UnbalancedTransactionError);
  });
});

describe("ledger invariant", () => {
  /**
   * The property S2 asks for: for any sequence of postTransaction calls, the
   * sum of amount_minor across all wallets is exactly 0n.
   *
   * The sequence deliberately contains transactions that would break it. If
   * buildEntries lets one through, `written` no longer sums to zero and this
   * fails — which is what makes it a test of the invariant rather than of the
   * generator.
   */
  it("holds over any sequence of accepted transactions", () => {
    fc.assert(
      fc.property(fc.array(anyTxnArb, { maxLength: 40 }), (txns) => {
        const written: TransactionLine[] = [];
        for (const txn of txns) {
          const result = tryBuild(txn);
          if (result.accepted) {
            written.push(...result.lines);
          }
        }

        let total = 0n;
        for (const balance of sumByWallet(written).values()) {
          total += balance;
        }
        expect(total).toBe(0n);
      }),
      { numRuns: 500 },
    );
  });

  /**
   * buildEntries accepts exactly the transactions that satisfy all three rules
   * — no more, no less — and a rejected one writes nothing.
   */
  it("accepts exactly the transactions that satisfy every rule", () => {
    fc.assert(
      fc.property(anyTxnArb, (txn) => {
        const expected = shouldBeAccepted(txn);
        const result = tryBuild(txn);

        expect(result.accepted).toBe(expected);
        if (result.accepted) {
          expect(result.lines).toEqual(txn.lines);
        } else {
          expect(
            result.error instanceof UnbalancedTransactionError ||
              result.error instanceof InvalidTransactionError,
          ).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });

  /**
   * A zero-amount line is never written. The generator splices zeros into
   * otherwise-balanced sets, so the sum is still zero and only the
   * zero-amount rule can catch them.
   */
  it("never writes a zero-amount entry", () => {
    fc.assert(
      fc.property(balancedWithZeroLineArb, (txn) => {
        expect(txn.lines.some((l) => l.amountMinor === 0n)).toBe(true);
        expect(() => buildEntries(txn)).toThrow(InvalidTransactionError);
      }),
      { numRuns: 500 },
    );
  });
});
