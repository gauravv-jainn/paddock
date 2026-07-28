import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  char,
  check,
  index,
  pgTable,
  pgView,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Wallet module tables — docs/04 §3.
 *
 * Money is BIGINT minor units. There is no balance column and there never will
 * be: balances are derived by summing ledger_entries.amount_minor.
 */

export const WALLET_KINDS = ["user", "house", "void_pool"] as const;

export const ENTRY_TYPES = [
  "OPENING_BALANCE",
  "STAKE",
  "RETURN",
  "REFUND",
  "REVERSAL",
  "ADJUSTMENT",
  "BANKROLL_RESET",
] as const;

export const REF_TYPES = ["bet", "settlement", "admin"] as const;

export const wallets = pgTable(
  "wallets",
  {
    id: uuid().primaryKey().defaultRandom(),
    // FK to identity.users is added by the S3 migration, once users exists.
    userId: uuid(),
    kind: text().notNull(),
    /** Accounting currency. Always USD; user-facing currency is display-only. */
    currency: char({ length: 3 }).notNull().default("USD"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("wallets_kind_check", sql`${t.kind} in ('user','house','void_pool')`),
    check(
      "user_wallet_requires_user",
      sql`(${t.kind} = 'user') = (${t.userId} is not null)`,
    ),
    uniqueIndex("wallets_user_id_key")
      .on(t.userId)
      .where(sql`kind = 'user'`),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial({ mode: "bigint" }).primaryKey(),
    /** Groups the balanced set. Every entry sharing a txn_id sums to zero. */
    txnId: uuid().notNull(),
    walletId: uuid()
      .notNull()
      .references(() => wallets.id),
    /** Signed minor units: positive credit, negative debit. Never zero. */
    amountMinor: bigint({ mode: "bigint" }).notNull(),
    entryType: text().notNull(),
    refType: text(),
    refId: uuid(),
    memo: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "ledger_entries_entry_type_check",
      sql`${t.entryType} in ('OPENING_BALANCE','STAKE','RETURN','REFUND','REVERSAL','ADJUSTMENT','BANKROLL_RESET')`,
    ),
    check("amount_nonzero", sql`${t.amountMinor} <> 0`),
    index("ledger_entries_wallet_id_created_at_idx").on(
      t.walletId,
      t.createdAt.desc(),
    ),
    index("ledger_entries_txn_id_idx").on(t.txnId),
    index("ledger_entries_ref_type_ref_id_idx").on(t.refType, t.refId),
  ],
);

/**
 * Created by the wallet_ledger_invariants migration, not managed by drizzle-kit.
 * Declared here so the service can select from it with the query builder.
 */
export const walletBalances = pgView("wallet_balances", {
  walletId: uuid("wallet_id").notNull(),
  balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull(),
}).existing();

export type Wallet = typeof wallets.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
