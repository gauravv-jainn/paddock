import type { ENTRY_TYPES, REF_TYPES } from "./schema";

export type EntryType = (typeof ENTRY_TYPES)[number];
export type RefType = (typeof REF_TYPES)[number];

/** One side of a balanced transaction. */
export interface TransactionLine {
  walletId: string;
  /** Signed minor units. Positive credit, negative debit. Never zero. */
  amountMinor: bigint;
  entryType: EntryType;
  refType?: RefType;
  refId?: string;
  memo?: string;
}

export interface TransactionInput {
  /** Caller-supplied UUID grouping the balanced set. */
  txnId: string;
  lines: TransactionLine[];
}

export class UnbalancedTransactionError extends Error {
  constructor(
    readonly txnId: string,
    readonly sumMinor: bigint,
  ) {
    super(`unbalanced txn ${txnId} (sum=${sumMinor})`);
    this.name = "UnbalancedTransactionError";
  }
}

export class InvalidTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransactionError";
  }
}

/**
 * Validates a transaction and returns the rows to insert.
 *
 * Pure: no I/O, no clock. The database enforces the same zero-sum invariant at
 * COMMIT via the deferred constraint trigger; this is the same check applied
 * early so callers get a typed error instead of a transaction abort.
 */
export function buildEntries(input: TransactionInput): TransactionLine[] {
  const { txnId, lines } = input;

  if (lines.length < 2) {
    throw new InvalidTransactionError(
      `txn ${txnId} has ${lines.length} line(s); every transaction writes at least 2`,
    );
  }

  let sum = 0n;
  for (const line of lines) {
    if (line.amountMinor === 0n) {
      throw new InvalidTransactionError(
        `txn ${txnId} has a zero-amount line on wallet ${line.walletId}`,
      );
    }
    sum += line.amountMinor;
  }

  if (sum !== 0n) {
    throw new UnbalancedTransactionError(txnId, sum);
  }

  return lines;
}

/** Sums signed amounts per wallet. Used by the ledger invariant tests. */
export function sumByWallet(
  lines: readonly TransactionLine[],
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const line of lines) {
    totals.set(line.walletId, (totals.get(line.walletId) ?? 0n) + line.amountMinor);
  }
  return totals;
}
