import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildEntries,
  InvalidTransactionError,
  sumByWallet,
  UnbalancedTransactionError,
  type EntryType,
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

/** Arbitrary lines with no zero-sum guarantee — most of these are rejected. */
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
   * Calls that would break it are rejected before any row is written, so the
   * invariant holds over the accepted subsequence — which is the whole ledger.
   */
  it("holds over any sequence of accepted transactions", () => {
    fc.assert(
      fc.property(
        fc.array(balancedTxnArb, { minLength: 0, maxLength: 40 }),
        (txns) => {
          const written: TransactionLine[] = [];
          for (const txn of txns) {
            written.push(...buildEntries(txn));
          }

          const perWallet = sumByWallet(written);
          let total = 0n;
          for (const balance of perWallet.values()) {
            total += balance;
          }
          expect(total).toBe(0n);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("holds when unbalanced calls are interleaved and rejected", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(balancedTxnArb, arbitraryTxnArb), {
          minLength: 0,
          maxLength: 40,
        }),
        (txns) => {
          const written: TransactionLine[] = [];
          let rejected = 0;
          for (const txn of txns) {
            try {
              written.push(...buildEntries(txn));
            } catch (error) {
              // Nothing is written for a rejected transaction.
              expect(
                error instanceof UnbalancedTransactionError ||
                  error instanceof InvalidTransactionError,
              ).toBe(true);
              rejected += 1;
            }
          }

          let total = 0n;
          for (const balance of sumByWallet(written).values()) {
            total += balance;
          }
          expect(total).toBe(0n);
          expect(rejected).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("never writes a zero-amount entry", () => {
    fc.assert(
      fc.property(balancedTxnArb, (txn) => {
        for (const line of buildEntries(txn)) {
          expect(line.amountMinor).not.toBe(0n);
        }
      }),
      { numRuns: 500 },
    );
  });
});
