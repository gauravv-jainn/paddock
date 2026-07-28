import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/db/client";
import { ledgerEntries, walletBalances, wallets, type Wallet } from "./schema";
import {
  buildEntries,
  type TransactionInput,
  type TransactionLine,
} from "./transaction";

export type WalletKind = "user" | "house" | "void_pool";

export interface CreateWalletInput {
  kind: WalletKind;
  /** Required when kind is 'user', forbidden otherwise. */
  userId?: string;
}

/**
 * A transaction handle. `postTransaction` accepts one so callers that already
 * hold an open transaction (bet placement, settlement) write their ledger
 * entries inside it rather than opening a second one.
 */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface WalletService {
  createWallet(input: CreateWalletInput, tx?: Executor): Promise<Wallet>;
  postTransaction(input: TransactionInput, tx?: Executor): Promise<void>;
  getBalance(walletId: string, tx?: Executor): Promise<bigint>;
}

function exec(tx?: Executor): Executor {
  return tx ?? getDb();
}

async function createWallet(
  input: CreateWalletInput,
  tx?: Executor,
): Promise<Wallet> {
  const rows = await exec(tx)
    .insert(wallets)
    .values({ kind: input.kind, userId: input.userId ?? null })
    .returning();

  const wallet = rows[0];
  if (!wallet) {
    throw new Error("createWallet inserted no row");
  }
  return wallet;
}

/**
 * Writes one balanced set of ledger entries.
 *
 * The rows are validated to sum to exactly 0n before insert, and the database's
 * DEFERRABLE INITIALLY DEFERRED constraint trigger re-checks at COMMIT.
 */
async function postTransaction(
  input: TransactionInput,
  tx?: Executor,
): Promise<void> {
  const lines = buildEntries(input);

  await exec(tx)
    .insert(ledgerEntries)
    .values(
      lines.map((line: TransactionLine) => ({
        txnId: input.txnId,
        walletId: line.walletId,
        amountMinor: line.amountMinor,
        entryType: line.entryType,
        refType: line.refType ?? null,
        refId: line.refId ?? null,
        memo: line.memo ?? null,
      })),
    );
}

/**
 * Derived balance. There is no balance column; this reads the view that sums
 * ledger_entries. A wallet with no entries has a balance of 0n.
 */
async function getBalance(walletId: string, tx?: Executor): Promise<bigint> {
  const rows = await exec(tx)
    .select({ balanceMinor: walletBalances.balanceMinor })
    .from(walletBalances)
    .where(eq(walletBalances.walletId, walletId));

  return rows[0]?.balanceMinor ?? 0n;
}

export const walletService: WalletService = {
  createWallet,
  postTransaction,
  getBalance,
};
