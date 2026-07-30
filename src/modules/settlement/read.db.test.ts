import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, type Database } from "@/db/client";
import { settlements } from "./schema";
import { getCurrentSettlements, getSettlementHistory } from "./read";

/**
 * Settlement reads — the queries the bet-history and detail screens run.
 *
 * Rows are inserted directly here rather than through the worker: these two
 * functions are pure selection logic over settlement rows, and driving the
 * whole engine to produce a reversal would test the engine again rather than
 * the selection.
 */
const url = process.env["TEST_DATABASE_URL"];

if (!url) {
  console.warn("\n  SKIPPED: settlement read tests need TEST_DATABASE_URL.\n");
}

describe.skipIf(!url)("settlement reads", () => {
  let db: Database;
  let betA: string;
  let betB: string;
  let raceId: string;

  beforeAll(async () => {
    process.env["DATABASE_URL"] = url as string;
    db = getDb();
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    return async () => {
      await closeDb();
    };
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table settlements, bet_legs, bets, ledger_entries, wallets,
          sessions, users, runners, races, meetings, tracks, horses, people,
          provider_payloads cascade`,
    );
    // The FKs are real, so a settlement needs a real bet and a real race.
    const seeded = await db.execute<{ race_id: string; bet_a: string; bet_b: string }>(sql`
      WITH u AS (
        INSERT INTO users (email, password_hash, display_name, handle)
        VALUES (${`read-${randomUUID()}@example.test`}, 'x', 'r', ${randomUUID().slice(0, 12)})
        RETURNING id
      ), w AS (
        INSERT INTO wallets (kind, currency, user_id) SELECT 'user', 'GBP', id FROM u
        RETURNING id, user_id
      ), t AS (
        INSERT INTO tracks (name, country_code, timezone)
        VALUES (${`Course ${randomUUID().slice(0, 8)}`}, 'GB', 'Europe/London') RETURNING id
      ), m AS (
        INSERT INTO meetings (track_id, date) SELECT id, DATE '2024-06-01' FROM t RETURNING id
      ), r AS (
        INSERT INTO races (meeting_id, provider_ref, provider_id, name, off_time,
                           is_handicap, status, actual_runners)
        SELECT id, ${randomUUID()}, 'test', 'Read Test Race', now(), false, 'result', 8
        FROM m RETURNING id
      ), ba AS (
        INSERT INTO bets (user_id, wallet_id, idempotency_key, bet_type,
                          unit_stake_minor, total_stake_minor)
        SELECT w.user_id, w.id, ${randomUUID()}, 'WIN', 1000, 1000 FROM w RETURNING id
      ), bb AS (
        INSERT INTO bets (user_id, wallet_id, idempotency_key, bet_type,
                          unit_stake_minor, total_stake_minor)
        SELECT w.user_id, w.id, ${randomUUID()}, 'WIN', 1000, 1000 FROM w RETURNING id
      )
      SELECT r.id AS race_id, ba.id AS bet_a, bb.id AS bet_b FROM r, ba, bb
    `);
    raceId = seeded[0]!.race_id;
    betA = seeded[0]!.bet_a;
    betB = seeded[0]!.bet_b;
  });

  async function insertSettlement(
    betId: string,
    resultVersion: number,
    outcome: string,
    returnMinor: bigint,
    isReversal = false,
  ) {
    await db.insert(settlements).values({
      betId,
      raceId,
      resultVersion,
      outcome,
      returnMinor,
      calculation: { version: 1, note: `v${resultVersion}` } as never,
      payloadHash: "a".repeat(64),
      isReversal,
    });
  }

  describe("getSettlementHistory", () => {
    it("returns every row for one bet, reversals included, newest first", async () => {
      await insertSettlement(betA, 0, "LOST", 0n);
      await insertSettlement(betA, 0, "LOST", 0n, true);
      await insertSettlement(betA, 1, "WON", 5000n);
      await insertSettlement(betB, 0, "WON", 9999n);

      const history = await getSettlementHistory(betA);

      expect(history).toHaveLength(3);
      // Scoped to the bet asked for — betB's row must not appear.
      expect(history.every((s) => s.betId === betA)).toBe(true);
      expect(history.some((s) => s.isReversal)).toBe(true);
      for (let i = 1; i < history.length; i += 1) {
        expect(history[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
          history[i]!.createdAt.getTime(),
        );
      }
    });

    it("returns an empty list for a bet that has never been settled", async () => {
      expect(await getSettlementHistory(betA)).toEqual([]);
    });

    it("accepts a caller-supplied executor", async () => {
      await insertSettlement(betA, 0, "WON", 100n);
      // The `tx ?? getDb()` branch: passing a handle must use it, not open a
      // second connection.
      const inside = await db.transaction((tx) => getSettlementHistory(betA, tx));
      expect(inside).toHaveLength(1);
    });
  });

  describe("getCurrentSettlements", () => {
    it("returns nothing for an empty id list WITHOUT querying", async () => {
      await insertSettlement(betA, 0, "WON", 100n);

      // Asserting only `size === 0` does NOT test the early return: with it
      // removed, `inArray(column, [])` still yields no rows and the assertion
      // passes anyway. Stryker caught that — the mutant survived.
      //
      // So the property is asserted directly: the empty case must not touch
      // the database at all. `inArray(column, [])` is invalid SQL on some
      // drivers and a silent "matches nothing" on others, and neither is
      // something to find out in production.
      const exploding = {
        select() {
          throw new Error("getCurrentSettlements queried on an empty id list");
        },
      } as unknown as Parameters<typeof getCurrentSettlements>[1];

      const map = await getCurrentSettlements([], exploding);
      expect(map.size).toBe(0);
    });

    it("returns the highest-versioned NON-reversal row per bet", async () => {
      await insertSettlement(betA, 0, "LOST", 0n);
      await insertSettlement(betA, 0, "LOST", 0n, true);
      await insertSettlement(betA, 1, "WON", 5000n);
      await insertSettlement(betB, 0, "VOID", 1000n);

      const map = await getCurrentSettlements([betA, betB]);

      expect(map.size).toBe(2);
      // The amended settlement, not the original and not the reversal.
      expect(map.get(betA)!.resultVersion).toBe(1);
      expect(map.get(betA)!.outcome).toBe("WON");
      expect(map.get(betA)!.isReversal).toBe(false);
      expect(map.get(betB)!.outcome).toBe("VOID");
    });

    it("EXCLUDES a bet whose only settlement row is a reversal", async () => {
      await insertSettlement(betA, 0, "LOST", 0n, true);
      const map = await getCurrentSettlements([betA]);
      // A reversal alone is history, not a current answer. Returning it would
      // show a reversed figure as though it still stood.
      expect(map.has(betA)).toBe(false);
    });

    it("returns nothing for ids with no settlements", async () => {
      const map = await getCurrentSettlements([betA, betB]);
      expect(map.size).toBe(0);
    });

    it("accepts a caller-supplied executor", async () => {
      await insertSettlement(betA, 0, "WON", 100n);
      const inside = await db.transaction((tx) =>
        getCurrentSettlements([betA], tx),
      );
      expect(inside.size).toBe(1);
    });
  });
});
