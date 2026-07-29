import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { identityService } from "@/modules/identity";
import { users } from "@/modules/identity/schema";
import { ledgerEntries, OPENING_BALANCE_MINOR, wallets } from "./schema";
import { HouseWalletMissingError, walletService } from "./service";

/**
 * Exercises the two database triggers from docs/04 §3.1 against a real
 * PostgreSQL instance. Nothing here can be verified without one — the
 * append-only trigger and the deferred balance assertion are database
 * behaviour, not application behaviour.
 *
 * Requires TEST_DATABASE_URL, deliberately separate from DATABASE_URL: this
 * suite TRUNCATEs the wallet tables and must never be pointed at real data.
 *
 * Every test builds the rows it needs. An earlier version of this file shared
 * state across tests, and when an earlier test failed the append-only
 * assertions ran against an empty table — where a row-level trigger never
 * fires and UPDATE/DELETE trivially succeed. Both mutation tests below now
 * assert the table is non-empty first, so they cannot pass vacuously again.
 */
const url = process.env["TEST_DATABASE_URL"];

if (!url) {
  console.warn(
    "\n  SKIPPED: wallet database tests need TEST_DATABASE_URL.\n" +
      "  The append-only trigger and the DEFERRABLE balance assertion are\n" +
      "  UNVERIFIED until this runs against a real PostgreSQL 16 instance.\n",
  );
}

describe.skipIf(!url)("wallet service against PostgreSQL", () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    client = postgres(url as string, {
      max: 1,
      types: { bigint: postgres.BigInt },
    });
    db = drizzle(client, { casing: "snake_case" });
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    // TRUNCATE does not fire the row-level append-only trigger. users is
    // included because wallets.user_id references it.
    await db.execute(
      sql`truncate table ledger_entries, wallets, sessions, users cascade`,
    );
    // The truncate above takes the house wallet with it. Migration 0008 seeds
    // it, and registration cannot credit an opening balance without it.
    await db.execute(
      sql`insert into wallets (kind, currency) values ('house', 'GBP')`,
    );
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  /**
   * Registration creates the user, their wallet and their opening balance in
   * one transaction (docs/08 D8), so this reads the wallet back rather than
   * creating one. Going through the identity module's public interface is the
   * sanctioned cross-module path and the only thing that proves the
   * wallets.user_id foreign key holds end to end.
   */
  async function registerUserWithWallet() {
    // register() takes a Transaction, not an Executor — passing `db` no longer
    // type-checks, which is the fix for the atomicity defect this suite missed.
    const user = await db.transaction((tx) =>
      identityService.register(
        {
          email: `wallet-${randomUUID()}@example.test`,
          password: "correct horse battery staple",
        },
        tx,
      ),
    );
    const rows = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, user.id))
      .limit(1);
    const wallet = rows[0];
    if (!wallet) throw new Error("registration did not create a wallet");
    return { user, wallet };
  }

  /** A balanced pair, so the table is guaranteed non-empty. */
  async function postBalancedPair(amount: bigint) {
    const a = await walletService.createWallet({ kind: "void_pool" }, db);
    const b = await walletService.createWallet({ kind: "void_pool" }, db);
    const txnId = randomUUID();
    await walletService.postTransaction(
      {
        txnId,
        lines: [
          { walletId: a.id, amountMinor: -amount, entryType: "ADJUSTMENT" },
          { walletId: b.id, amountMinor: amount, entryType: "ADJUSTMENT" },
        ],
      },
      db,
    );
    return { a, b, txnId };
  }

  async function ledgerRowCount(): Promise<number> {
    const rows = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from ledger_entries`,
    );
    return Number(rows[0]?.n ?? "0");
  }

  it("derives a zero balance for a wallet with no entries", async () => {
    const wallet = await walletService.createWallet({ kind: "void_pool" }, db);
    expect(await walletService.getBalance(wallet.id, db)).toBe(0n);
  });

  it("refuses a user wallet whose user does not exist", async () => {
    await expect(
      walletService.createWallet({ kind: "user", userId: randomUUID() }, db),
    ).rejects.toThrow(/wallets_user_id_users_id_fk/);
  });

  it("credits the opening balance at registration, from the house", async () => {
    const house = await walletService.getHouseWallet(db);
    const houseBefore = await walletService.getBalance(house.id, db);

    const { wallet } = await registerUserWithWallet();

    // D2: £100,000 in pence.
    expect(OPENING_BALANCE_MINOR).toBe(10_000_000n);
    expect(await walletService.getBalance(wallet.id, db)).toBe(
      OPENING_BALANCE_MINOR,
    );
    // Balanced: the credit came from somewhere, it was not created.
    expect(await walletService.getBalance(house.id, db)).toBe(
      houseBefore - OPENING_BALANCE_MINOR,
    );
    expect(wallet.currency).toBe("GBP");
  });

  it("rolls the whole registration back if a later step fails", async () => {
    // The failure has to land AFTER the user and wallet inserts. An earlier
    // version of this test used a duplicate email, which fails on the very
    // first statement — there was nothing to roll back, so it passed whether
    // or not register() was atomic.
    //
    // Removing the house wallet makes getHouseWallet() throw, which happens
    // after both inserts.
    const email = `rollback-${randomUUID()}@example.test`;
    const before = await ledgerRowCount();
    const userWalletsBefore = (
      await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(eq(wallets.kind, "user"))
    ).length;

    await db.execute(sql`update wallets set kind='void_pool' where kind='house'`);
    try {
      await expect(
        db.transaction((tx) =>
          identityService.register(
            { email, password: "correct horse battery staple" },
            tx,
          ),
        ),
      ).rejects.toThrow(HouseWalletMissingError);

      const orphanedUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      expect(orphanedUsers).toHaveLength(0);

      const userWalletsAfter = await db
        .select({ id: wallets.id })
        .from(wallets)
        .where(eq(wallets.kind, "user"));
      expect(userWalletsAfter).toHaveLength(userWalletsBefore);
      expect(await ledgerRowCount()).toBe(before);
    } finally {
      await db.execute(
        sql`update wallets set kind='house' where id = (select id from wallets where user_id is null and kind='void_pool' order by created_at limit 1)`,
      );
    }
  });

  it("allows only one house wallet", async () => {
    await expect(
      walletService.createWallet({ kind: "house" }, db),
    ).rejects.toThrow(/wallets_house_singleton_key/);
  });

  it("rejects an UPDATE on ledger_entries", async () => {
    const { txnId } = await postBalancedPair(1_234n);
    // Without this the assertion below is vacuous: a row-level BEFORE trigger
    // never fires on a statement that matches no rows.
    expect(await ledgerRowCount()).toBeGreaterThan(0);

    await expect(
      db.execute(sql`update ledger_entries set memo = 'tampered'`),
    ).rejects.toThrow(/append-only/);

    const survivors = await db
      .select({ memo: ledgerEntries.memo })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.txnId, txnId));
    expect(survivors).toHaveLength(2);
    expect(survivors.every((r) => r.memo === null)).toBe(true);
  });

  it("rejects a DELETE on ledger_entries", async () => {
    const { txnId } = await postBalancedPair(4_321n);
    const before = await ledgerRowCount();
    expect(before).toBeGreaterThan(0);

    await expect(db.execute(sql`delete from ledger_entries`)).rejects.toThrow(
      /append-only/,
    );

    expect(await ledgerRowCount()).toBe(before);
    const survivors = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.txnId, txnId));
    expect(survivors).toHaveLength(2);
  });

  it("rejects an unbalanced set written directly, at COMMIT", async () => {
    const wallet = await walletService.createWallet({ kind: "void_pool" }, db);
    const txnId = randomUUID();

    // Bypasses buildEntries on purpose: this asserts the database refuses,
    // not that the application remembered to check.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`
          insert into ledger_entries (txn_id, wallet_id, amount_minor, entry_type)
          values (${txnId}::uuid, ${wallet.id}::uuid, 500, 'ADJUSTMENT')
        `);
      }),
    ).rejects.toThrow(/unbalanced txn/);

    // Rolled back, so the half-transaction left nothing behind.
    const orphans = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.txnId, txnId));
    expect(orphans).toHaveLength(0);
  });

  it("defers the balance check to COMMIT, not to each row", async () => {
    const a = await walletService.createWallet({ kind: "void_pool" }, db);
    const b = await walletService.createWallet({ kind: "void_pool" }, db);
    const txnId = randomUUID();

    // The first row leaves the txn at sum=-750. A non-deferred assertion would
    // reject it here; DEFERRABLE INITIALLY DEFERRED is what lets the pair land.
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into ledger_entries (txn_id, wallet_id, amount_minor, entry_type)
        values (${txnId}::uuid, ${a.id}::uuid, -750, 'REFUND')
      `);
      await tx.execute(sql`
        insert into ledger_entries (txn_id, wallet_id, amount_minor, entry_type)
        values (${txnId}::uuid, ${b.id}::uuid, 750, 'REFUND')
      `);
    });

    expect(await walletService.getBalance(b.id, db)).toBe(750n);
  });

  it("permits a multi-row balanced insert inside one transaction", async () => {
    const a = await walletService.createWallet({ kind: "void_pool" }, db);
    const b = await walletService.createWallet({ kind: "void_pool" }, db);
    const txnId = randomUUID();

    await db.transaction(async (tx) => {
      await walletService.postTransaction(
        {
          txnId,
          lines: [
            { walletId: a.id, amountMinor: -750n, entryType: "REFUND" },
            { walletId: b.id, amountMinor: 750n, entryType: "REFUND" },
          ],
        },
        tx,
      );
    });

    expect(await walletService.getBalance(b.id, db)).toBe(750n);
  });

  it("sums to zero across every wallet", async () => {
    // Non-vacuous: the invariant is only interesting with entries present.
    expect(await ledgerRowCount()).toBeGreaterThan(0);

    const rows = await db.execute<{ total: string | null }>(
      sql`select coalesce(sum(amount_minor), 0)::text as total from ledger_entries`,
    );
    expect(BigInt(rows[0]?.total ?? "0")).toBe(0n);
  });
});
