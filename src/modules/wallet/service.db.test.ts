import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { walletService } from "./service";

/**
 * Exercises the two database triggers from docs/04 §3.1 against a real
 * PostgreSQL instance. Nothing here can be verified without one — the
 * append-only trigger and the deferred balance assertion are database
 * behaviour, not application behaviour.
 *
 * Requires TEST_DATABASE_URL, deliberately separate from DATABASE_URL: this
 * suite TRUNCATEs the wallet tables and must never be pointed at real data.
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
    // TRUNCATE does not fire the row-level append-only trigger.
    await db.execute(sql`truncate table ledger_entries, wallets cascade`);
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  it("derives a zero balance for a wallet with no entries", async () => {
    const wallet = await walletService.createWallet({ kind: "house" }, db);
    expect(await walletService.getBalance(wallet.id, db)).toBe(0n);
  });

  it("writes a balanced transaction and derives both balances", async () => {
    const user = await walletService.createWallet(
      { kind: "user", userId: randomUUID() },
      db,
    );
    const house = await walletService.createWallet({ kind: "house" }, db);

    await walletService.postTransaction(
      {
        txnId: randomUUID(),
        lines: [
          {
            walletId: house.id,
            amountMinor: -10_000_000n,
            entryType: "OPENING_BALANCE",
          },
          {
            walletId: user.id,
            amountMinor: 10_000_000n,
            entryType: "OPENING_BALANCE",
          },
        ],
      },
      db,
    );

    expect(await walletService.getBalance(user.id, db)).toBe(10_000_000n);
    expect(await walletService.getBalance(house.id, db)).toBe(-10_000_000n);
  });

  it("rejects an UPDATE on ledger_entries", async () => {
    await expect(
      db.execute(sql`update ledger_entries set memo = 'tampered'`),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects a DELETE on ledger_entries", async () => {
    await expect(
      db.execute(sql`delete from ledger_entries`),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects an unbalanced set written directly, at COMMIT", async () => {
    const wallet = await walletService.createWallet({ kind: "house" }, db);
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
  });

  it("permits a multi-row balanced insert inside one transaction", async () => {
    const a = await walletService.createWallet({ kind: "house" }, db);
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
    const rows = await db.execute<{ total: string | null }>(
      sql`select coalesce(sum(amount_minor), 0)::text as total from ledger_entries`,
    );
    expect(BigInt(rows[0]?.total ?? "0")).toBe(0n);
  });
});
