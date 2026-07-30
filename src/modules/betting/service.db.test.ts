import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, type Database } from "@/db/client";
import { identityService } from "@/modules/identity";
import { walletService } from "@/modules/wallet";
import { bets, betLegs } from "./schema";
import { placeBet } from "./service";

/**
 * Bet placement against a real PostgreSQL — docs/03 §4.
 *
 * SERIALIZABLE isolation, the idempotency unique index and the ledger-derived
 * balance are database behaviour. None of it can be verified without one.
 *
 * `placeBet` opens its own transaction through `getDb()`, which reads
 * DATABASE_URL. This suite points DATABASE_URL at TEST_DATABASE_URL before the
 * first call so placement and assertions cannot end up on different databases —
 * a mismatch that would leave every assertion here passing vacuously against a
 * database nothing had written to.
 */
const url = process.env["TEST_DATABASE_URL"];

if (!url) {
  console.warn(
    "\n  SKIPPED: betting database tests need TEST_DATABASE_URL.\n" +
      "  SERIALIZABLE placement, idempotency under concurrency and the\n" +
      "  ledger-derived balance are UNVERIFIED until this runs.\n",
  );
}

describe.skipIf(!url)("placeBet against PostgreSQL", () => {
  let db: Database;
  let userId: string;
  let walletId: string;
  let raceId: string;
  let runnerId: string;

  beforeAll(async () => {
    process.env["DATABASE_URL"] = url as string;
    db = getDb();
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    await db.execute(
      sql`truncate table bet_legs, bets, ledger_entries, wallets, sessions, users,
          runners, races, meetings, tracks, horses, people cascade`,
    );
    // TRUNCATE took the seeded house wallet with it; registration cannot
    // credit an opening balance without a counterparty.
    await db.execute(sql`insert into wallets (kind, currency) values ('house','GBP')`);

    const user = await db.transaction((tx) =>
      identityService.register(
        {
          email: `bettor-${randomUUID()}@example.test`,
          password: "correct horse battery staple",
        },
        tx,
      ),
    );
    userId = user.id;
    const w = await db.execute<{ id: string }>(
      sql`select id from wallets where user_id = ${userId}::uuid and kind = 'user'`,
    );
    walletId = w[0]!.id;

    // One open race carrying one declared runner priced at 5.0.
    const rows = await db.execute<{ race_id: string; runner_id: string }>(sql`
      WITH t AS (INSERT INTO tracks (name, country_code, timezone)
                 VALUES ('Bet Test Course', 'GB', 'Europe/London') RETURNING id),
           m AS (INSERT INTO meetings (track_id, date)
                 SELECT id, DATE '2024-01-02' FROM t RETURNING id),
           r AS (INSERT INTO races (meeting_id, provider_ref, provider_id, name,
                                    off_time, is_handicap, status, actual_runners)
                 SELECT id, 'bt-1', 'test', 'Bet Test Race',
                        now() + interval '1 hour', false, 'open', 8
                 FROM m RETURNING id),
           h AS (INSERT INTO horses (name) VALUES ('Bet Test Horse') RETURNING id)
      INSERT INTO runners (race_id, horse_id, cloth_number, status, starting_price)
      SELECT r.id, h.id, 1, 'declared', 5.000 FROM r, h
      RETURNING race_id, id AS runner_id
    `);
    raceId = rows[0]!.race_id;
    runnerId = rows[0]!.runner_id;
  });

  afterAll(async () => {
    await closeDb();
  });

  const input = (over: Partial<Parameters<typeof placeBet>[0]> = {}) => ({
    userId,
    idempotencyKey: randomUUID(),
    betType: "WIN" as const,
    unitStakeMinor: 1000n,
    raceId,
    runnerId,
    oddsTaken: 5,
    oddsTolerance: 0,
    ...over,
  });

  const balance = () => walletService.getBalance(walletId, db);

  it("opens with a positive balance, so the stake assertions are not vacuous", async () => {
    expect(await balance()).toBeGreaterThan(0n);
  });

  it("debits the stake from the ledger, not from a balance column", async () => {
    const before = await balance();
    const outcome = await placeBet(input());

    expect(outcome.kind).toBe("PLACED");
    expect(await balance()).toBe(before - 1000n);
  });

  it("records the leg with the price the user accepted, frozen", async () => {
    const outcome = await placeBet(input({ oddsTaken: 4.5, oddsTolerance: 1 }));
    if (outcome.kind !== "PLACED") throw new Error(outcome.detail);

    const legs = await db.select().from(betLegs).where(eq(betLegs.betId, outcome.bet.id));
    expect(legs).toHaveLength(1);
    // 4.500, not the runner's current 5.000 — a fixed-odds bet settles at the
    // accepted price, so placement must not overwrite it with the live one.
    expect(legs[0]!.oddsTaken).toBe("4.500");
    expect(legs[0]!.outcome).toBe("pending");
    expect(legs[0]!.runnerId).toBe(runnerId);
  });

  it("stakes an each-way bet twice", async () => {
    const before = await balance();
    const outcome = await placeBet(input({ betType: "EACH_WAY", unitStakeMinor: 500n }));
    if (outcome.kind !== "PLACED") throw new Error(outcome.detail);

    expect(outcome.bet.unitStakeMinor).toBe(500n);
    expect(outcome.bet.totalStakeMinor).toBe(1000n);
    expect(await balance()).toBe(before - 1000n);
  });

  it("is idempotent — a retry returns the same bet and does NOT re-debit", async () => {
    const key = randomUUID();
    const before = await balance();

    const first = await placeBet(input({ idempotencyKey: key }));
    const afterFirst = await balance();
    const second = await placeBet(input({ idempotencyKey: key }));

    if (first.kind !== "PLACED" || second.kind !== "PLACED") {
      throw new Error("expected both calls to report PLACED");
    }
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.bet.id).toBe(first.bet.id);
    expect(afterFirst).toBe(before - 1000n);
    // The retry must move nothing at all.
    expect(await balance()).toBe(afterFirst);
  });

  it("survives CONCURRENT retries of one key — one bet, one leg, one debit", async () => {
    const key = randomUUID();
    const before = await balance();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => placeBet(input({ idempotencyKey: key }))),
    );

    // Every caller gets an answer; none sees a constraint violation.
    expect(results.every((r) => r.kind === "PLACED")).toBe(true);
    const ids = new Set(
      results.map((r) => (r.kind === "PLACED" ? r.bet.id : "REFUSED")),
    );
    expect(ids.size).toBe(1);

    const rows = await db.select().from(bets).where(eq(bets.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    const legs = await db.select().from(betLegs).where(eq(betLegs.betId, rows[0]!.id));
    expect(legs).toHaveLength(1);
    expect(await balance()).toBe(before - 1000n);
  });

  it("rejects rather than clamps on insufficient balance", async () => {
    const before = await balance();
    const outcome = await placeBet(input({ unitStakeMinor: 99_999_999_999n }));

    expect(outcome.kind).toBe("REFUSED");
    if (outcome.kind === "REFUSED") expect(outcome.reason).toBe("INSUFFICIENT_BALANCE");
    // Nothing partial was taken and no bet row survives the refusal.
    expect(await balance()).toBe(before);
  });

  it("refuses when the price shortened past the accepted tolerance", async () => {
    // Runner is 5.0; asking for 6.0 means it shortened by 1.0 against the bettor.
    const outcome = await placeBet(input({ oddsTaken: 6, oddsTolerance: 0.5 }));

    expect(outcome.kind).toBe("REFUSED");
    if (outcome.kind === "REFUSED") {
      expect(outcome.reason).toBe("ODDS_MOVED");
      expect(outcome.detail).toContain("5");
    }
  });

  it("accepts a shortening that stays inside tolerance", async () => {
    const outcome = await placeBet(input({ oddsTaken: 5.4, oddsTolerance: 0.5 }));
    expect(outcome.kind).toBe("PLACED");
  });

  it("accepts a drift in the bettor's favour even at zero tolerance", async () => {
    // Asked for 4.0, runner is now 5.0. Only movement AGAINST the bettor is a
    // tolerance breach; this stands at the price they accepted.
    const outcome = await placeBet(input({ oddsTaken: 4, oddsTolerance: 0 }));
    expect(outcome.kind).toBe("PLACED");
  });

  it("refuses a race that is not open", async () => {
    await db.execute(sql`update races set status = 'off' where id = ${raceId}::uuid`);
    try {
      const outcome = await placeBet(input());
      expect(outcome.kind).toBe("REFUSED");
      if (outcome.kind === "REFUSED") {
        expect(outcome.reason).toBe("RACE_NOT_OPEN");
        expect(outcome.detail).toContain("off");
      }
    } finally {
      await db.execute(sql`update races set status = 'open' where id = ${raceId}::uuid`);
    }
  });

  it("refuses a runner that is not declared", async () => {
    await db.execute(
      sql`update runners set status = 'non_runner' where id = ${runnerId}::uuid`,
    );
    try {
      const outcome = await placeBet(input());
      expect(outcome.kind).toBe("REFUSED");
      if (outcome.kind === "REFUSED") {
        expect(outcome.reason).toBe("RUNNER_NOT_DECLARED");
        expect(outcome.detail).toContain("non_runner");
      }
    } finally {
      await db.execute(
        sql`update runners set status = 'declared' where id = ${runnerId}::uuid`,
      );
    }
  });

  it("refuses a runner with no price rather than inventing one", async () => {
    await db.execute(
      sql`update runners set starting_price = null where id = ${runnerId}::uuid`,
    );
    try {
      const outcome = await placeBet(input());
      expect(outcome.kind).toBe("REFUSED");
      if (outcome.kind === "REFUSED") expect(outcome.reason).toBe("NO_PRICE");
    } finally {
      await db.execute(
        sql`update runners set starting_price = 5.000 where id = ${runnerId}::uuid`,
      );
    }
  });

  it("refuses an unknown race or runner", async () => {
    const outcome = await placeBet(input({ runnerId: randomUUID() }));
    expect(outcome.kind).toBe("REFUSED");
  });

  it("throws on programmer error rather than refusing", async () => {
    // A negative stake or a price of 1.0 is a caller bug, not a business
    // outcome a user interface has to render.
    await expect(placeBet(input({ unitStakeMinor: 0n }))).rejects.toThrow(RangeError);
    await expect(placeBet(input({ unitStakeMinor: -5n }))).rejects.toThrow(RangeError);
    await expect(placeBet(input({ oddsTaken: 1 }))).rejects.toThrow(RangeError);
    await expect(placeBet(input({ oddsTolerance: -1 }))).rejects.toThrow(RangeError);
  });

  it("writes a balanced STAKE pair for every placement", async () => {
    const outcome = await placeBet(input());
    if (outcome.kind !== "PLACED") throw new Error(outcome.detail);

    const entries = await db.execute<{
      wallet_id: string;
      amount_minor: string;
      entry_type: string;
      txn_id: string;
    }>(sql`
      select wallet_id, amount_minor::text, entry_type, txn_id
        from ledger_entries where ref_type = 'bet' and ref_id = ${outcome.bet.id}::uuid
    `);

    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.txn_id)).size).toBe(1);
    expect(entries.every((e) => e.entry_type === "STAKE")).toBe(true);
    expect(entries.reduce((sum, e) => sum + BigInt(e.amount_minor), 0n)).toBe(0n);
    const mine = entries.find((e) => e.wallet_id === walletId);
    expect(BigInt(mine!.amount_minor)).toBe(-1000n);
  });

  it("keeps the whole ledger summing to zero", async () => {
    const [row] = await db.execute<{ total: string; n: string }>(
      sql`select coalesce(sum(amount_minor), 0)::text as total,
                 count(*)::text as n from ledger_entries`,
    );
    // Non-vacuous first: a zero sum over an empty table proves nothing.
    expect(Number(row!.n)).toBeGreaterThan(0);
    expect(BigInt(row!.total)).toBe(0n);
  });
});
