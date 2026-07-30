import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, type Database } from "@/db/client";
import { placeBet } from "@/modules/betting";
import { identityService } from "@/modules/identity";
import { walletService } from "@/modules/wallet";
import { settlements } from "./schema";
import { settleRace } from "./settleRace";

/**
 * The settlement worker against a real PostgreSQL — docs/03 §5.
 *
 * What is verified here is the ORCHESTRATION, not the arithmetic. settle()'s
 * correctness is measured against `tests/golden/` and nowhere else
 * (`.claude/rules/money.md`); these tests check that the right values reach it,
 * that its answer is persisted verbatim, that the ledger balances, and that
 * running the worker twice cannot pay twice.
 */
const url = process.env["TEST_DATABASE_URL"];

if (!url) {
  console.warn(
    "\n  SKIPPED: settlement worker tests need TEST_DATABASE_URL.\n" +
      "  Idempotency and re-settlement are UNVERIFIED without one.\n",
  );
}

/** sha256 of an empty payload body — a real digest, shaped like a real one. */
const PAYLOAD_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe.skipIf(!url)("settleRace against PostgreSQL", () => {
  let db: Database;
  let userId: string;
  let walletId: string;

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
    await db.execute(sql`insert into wallets (kind, currency) values ('house','GBP')`);

    const user = await db.transaction((tx) =>
      identityService.register(
        {
          email: `settle-${randomUUID()}@example.test`,
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
  });

  const balance = () => walletService.getBalance(walletId, db);

  interface RaceSpec {
    isHandicap?: boolean;
    actualRunners?: number;
    status?: string;
    rule4Pence?: number;
    /** cloth number -> finishing position. Absent = unplaced. */
    finish?: Record<number, number>;
    runnerCount?: number;
    runnerStatus?: Record<number, string>;
    deadHeat?: Record<number, number>;
  }

  /** Builds a race with N declared runners and returns its ids. */
  async function makeRace(spec: RaceSpec = {}) {
    const {
      isHandicap = false,
      actualRunners = 8,
      status = "result",
      rule4Pence = 0,
      finish = { 1: 1 },
      runnerCount = 8,
      runnerStatus = {},
      deadHeat = {},
    } = spec;

    const raceRows = await db.execute<{ id: string }>(sql`
      WITH t AS (INSERT INTO tracks (name, country_code, timezone)
                 VALUES (${`Course ${randomUUID().slice(0, 8)}`}, 'GB', 'Europe/London')
                 RETURNING id),
           m AS (INSERT INTO meetings (track_id, date)
                 SELECT id, DATE '2024-03-05' FROM t RETURNING id)
      INSERT INTO races (meeting_id, provider_ref, provider_id, name, off_time,
                         is_handicap, status, actual_runners, rule4_pence)
      SELECT id, ${randomUUID()}, 'test', 'Settlement Test Race',
             now() - interval '1 hour', ${isHandicap}, ${status},
             ${actualRunners}, ${rule4Pence}
      FROM m RETURNING id
    `);
    const raceId = raceRows[0]!.id;

    const runnerIds: Record<number, string> = {};
    for (let cloth = 1; cloth <= runnerCount; cloth += 1) {
      const rows = await db.execute<{ id: string }>(sql`
        WITH h AS (INSERT INTO horses (name)
                   VALUES (${`Horse ${randomUUID().slice(0, 8)}`}) RETURNING id)
        INSERT INTO runners (race_id, horse_id, cloth_number, status,
                             starting_price, finish_position, dead_heat_count)
        SELECT ${raceId}::uuid, h.id, ${cloth},
               ${runnerStatus[cloth] ?? "declared"}, 5.000,
               ${finish[cloth] ?? null}, ${deadHeat[cloth] ?? 1}
        FROM h RETURNING id
      `);
      runnerIds[cloth] = rows[0]!.id;
    }
    return { raceId, runnerIds };
  }

  async function openRace(raceId: string) {
    await db.execute(sql`update races set status = 'open' where id = ${raceId}::uuid`);
  }
  async function resultRace(raceId: string) {
    await db.execute(sql`update races set status = 'result' where id = ${raceId}::uuid`);
  }

  async function bet(
    raceId: string,
    runnerId: string,
    over: { betType?: "WIN" | "PLACE" | "EACH_WAY"; unitStakeMinor?: bigint } = {},
  ) {
    await openRace(raceId);
    const outcome = await placeBet({
      userId,
      idempotencyKey: randomUUID(),
      betType: over.betType ?? "WIN",
      unitStakeMinor: over.unitStakeMinor ?? 1000n,
      raceId,
      runnerId,
      oddsTaken: 5,
      oddsTolerance: 0,
    });
    if (outcome.kind !== "PLACED") throw new Error(`placement refused: ${outcome.detail}`);
    await resultRace(raceId);
    return outcome.bet;
  }

  it("settles a winning bet, credits the return and records the calculation", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
    const placed = await bet(raceId, runnerIds[1]!);
    const afterStake = await balance();

    const result = await settleRace(raceId, PAYLOAD_HASH);
    if (result.kind !== "DONE") throw new Error(result.detail);

    expect(result.report.settled).toBe(1);
    expect(result.report.betsConsidered).toBe(1);

    // £10 at 5.0 returns £50: the £40 profit plus the £10 stake back.
    expect(await balance()).toBe(afterStake + 5000n);

    const rows = await db.select().from(settlements).where(eq(settlements.betId, placed.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("WON");
    expect(rows[0]!.returnMinor).toBe(5000n);
    expect(rows[0]!.payloadHash).toBe(PAYLOAD_HASH);
    expect(rows[0]!.isReversal).toBe(false);

    // docs/04 §7: the stored calculation is what the detail screen renders.
    // It must arrive whole, not as a summary.
    const calc = rows[0]!.calculation as Record<string, unknown>;
    expect(calc["version"]).toBe(1);
    expect(calc["returnMinor"]).toBe("5000");
    expect(Array.isArray(calc["rulesApplied"])).toBe(true);
    expect((calc["rulesApplied"] as string[]).length).toBeGreaterThan(0);
    expect(calc["rounding"]).toBeTruthy();
    expect(Array.isArray(calc["parts"])).toBe(true);
  });

  it("settles a losing bet without moving money", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
    await bet(raceId, runnerIds[2]!);
    const afterStake = await balance();

    const result = await settleRace(raceId, PAYLOAD_HASH);
    if (result.kind !== "DONE") throw new Error(result.detail);

    expect(result.report.settled).toBe(1);
    // The stake was already taken at placement; losing moves nothing further.
    expect(await balance()).toBe(afterStake);

    const rows = await db.select().from(settlements);
    expect(rows[0]!.outcome).toBe("LOST");
    expect(rows[0]!.returnMinor).toBe(0n);
  });

  it("refunds a non-runner in full", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 }, runnerCount: 8 });
    const placed = await bet(raceId, runnerIds[3]!);
    await db.execute(
      sql`update runners set status = 'non_runner' where id = ${runnerIds[3]!}::uuid`,
    );
    const afterStake = await balance();

    const result = await settleRace(raceId, PAYLOAD_HASH);
    if (result.kind !== "DONE") throw new Error(result.detail);

    expect(await balance()).toBe(afterStake + 1000n);
    const rows = await db.select().from(settlements).where(eq(settlements.betId, placed.id));
    expect(rows[0]!.outcome).toBe("VOID");
    expect(rows[0]!.returnMinor).toBe(1000n);
  });

  it("is IDEMPOTENT — running the worker twice cannot pay twice", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
    await bet(raceId, runnerIds[1]!);
    const afterStake = await balance();

    const first = await settleRace(raceId, PAYLOAD_HASH);
    const paid = await balance();
    const second = await settleRace(raceId, PAYLOAD_HASH);

    if (first.kind !== "DONE" || second.kind !== "DONE") throw new Error("refused");
    expect(first.report.settled).toBe(1);
    expect(second.report.settled).toBe(0);
    expect(second.report.alreadySettled).toBe(1);

    expect(paid).toBe(afterStake + 5000n);
    expect(await balance()).toBe(paid);
    expect(await db.select().from(settlements)).toHaveLength(1);
  });

  it("is idempotent under CONCURRENT workers on the same race", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
    await bet(raceId, runnerIds[1]!);
    const afterStake = await balance();

    const results = await Promise.all([
      settleRace(raceId, PAYLOAD_HASH),
      settleRace(raceId, PAYLOAD_HASH),
      settleRace(raceId, PAYLOAD_HASH),
    ]);

    const settledTotal = results.reduce(
      (n, r) => n + (r.kind === "DONE" ? r.report.settled : 0),
      0,
    );
    // Exactly one worker may write the settlement, whatever the interleaving.
    expect(settledTotal).toBe(1);
    expect(await db.select().from(settlements)).toHaveLength(1);
    expect(await balance()).toBe(afterStake + 5000n);
  });

  it("re-settles an amended result with COMPENSATING entries, mutating nothing", async () => {
    // Backed cloth 2. First result: cloth 1 won, so the bet lost.
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1, 2: 2 } });
    const placed = await bet(raceId, runnerIds[2]!);
    const afterStake = await balance();

    const first = await settleRace(raceId, PAYLOAD_HASH);
    if (first.kind !== "DONE") throw new Error(first.detail);
    expect(await balance()).toBe(afterStake);

    // Stewards reverse the placings and the result version increments.
    await db.execute(sql`
      update runners set finish_position = 2 where id = ${runnerIds[1]!}::uuid`);
    await db.execute(sql`
      update runners set finish_position = 1 where id = ${runnerIds[2]!}::uuid`);
    await db.execute(sql`
      update races set result_version = result_version + 1 where id = ${raceId}::uuid`);

    const amendedHash = "a".repeat(64);
    const second = await settleRace(raceId, amendedHash);
    if (second.kind !== "DONE") throw new Error(second.detail);

    expect(second.report.resettled).toBe(1);
    expect(await balance()).toBe(afterStake + 5000n);

    const rows = await db
      .select()
      .from(settlements)
      .where(eq(settlements.betId, placed.id))
      .orderBy(settlements.createdAt);

    // Three rows: the original LOST, its reversal, and the new WON. History is
    // added to, never overwritten (docs/03 §5).
    expect(rows).toHaveLength(3);
    const reversal = rows.find((r) => r.isReversal);
    expect(reversal).toBeTruthy();
    expect(reversal!.resultVersion).toBe(0);
    const originals = rows.filter((r) => !r.isReversal);
    expect(originals.map((r) => r.outcome).sort()).toEqual(["LOST", "WON"]);
    expect(originals.find((r) => r.resultVersion === 0)!.outcome).toBe("LOST");
    expect(originals.find((r) => r.resultVersion === 1)!.outcome).toBe("WON");
  });

  it("claws back an overpayment when an amendment takes a win away", async () => {
    // Backed cloth 1, which won. Then the stewards disqualify it.
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1, 2: 2 } });
    await bet(raceId, runnerIds[1]!);
    const afterStake = await balance();

    await settleRace(raceId, PAYLOAD_HASH);
    expect(await balance()).toBe(afterStake + 5000n);

    await db.execute(sql`
      update runners set disqualified = true where id = ${runnerIds[1]!}::uuid`);
    await db.execute(sql`
      update races set result_version = result_version + 1 where id = ${raceId}::uuid`);

    const second = await settleRace(raceId, "b".repeat(64));
    if (second.kind !== "DONE") throw new Error(second.detail);

    // The £50 comes back off. Compensating entries, not an edited ledger.
    expect(await balance()).toBe(afterStake);

    const reversalEntries = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from ledger_entries where entry_type = 'REVERSAL'`,
    );
    expect(Number(reversalEntries[0]!.n)).toBe(2);
  });

  it("parks a bet for review rather than inventing a Rule 4 deduction", async () => {
    // docs/08 D17: a withdrawn runner with neither a fraction nor an announced
    // deduction is a question, not a zero.
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 }, rule4Pence: 0 });
    const placed = await bet(raceId, runnerIds[1]!);
    await db.execute(
      sql`update runners set status = 'withdrawn' where id = ${runnerIds[4]!}::uuid`,
    );
    const afterStake = await balance();

    const result = await settleRace(raceId, PAYLOAD_HASH);
    if (result.kind !== "DONE") throw new Error(result.detail);

    expect(result.report.needsReview).toBe(1);
    expect(result.report.settled).toBe(0);
    // Nothing is paid on a refusal — not the win, not a guess at it.
    expect(await balance()).toBe(afterStake);

    const rows = await db.select().from(settlements).where(eq(settlements.betId, placed.id));
    expect(rows[0]!.outcome).toBe("NEEDS_REVIEW");
    expect(rows[0]!.returnMinor).toBe(0n);
    // The reason is persisted MACHINE-READABLY, not only as prose inside
    // rulesApplied — a review queue must not have to regex an English sentence.
    const calc = rows[0]!.calculation as {
      review: { reason: string; detail: string };
      rulesApplied: string[];
    };
    expect(calc.review.reason).toBe("AMBIGUOUS_WITHDRAWAL");
    expect(calc.review.detail.length).toBeGreaterThan(0);
    expect(calc.rulesApplied.some((r) => r.startsWith("REFUSED"))).toBe(true);
  });

  it("refuses a race with no result instead of settling against nothing", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
    await bet(raceId, runnerIds[1]!);
    await openRace(raceId);

    const result = await settleRace(raceId, PAYLOAD_HASH);
    expect(result.kind).toBe("REFUSED");
    if (result.kind === "REFUSED") {
      expect(result.reason).toBe("RACE_HAS_NO_RESULT");
      // Names the status it actually found. "Cannot settle" without saying
      // what state the race is in sends whoever reads the log back to the
      // database to find out.
      expect(result.detail).toBe("race status is 'open'; nothing to settle against");
    }
    expect(await db.select().from(settlements)).toHaveLength(0);
  });

  it("refuses an unknown race and says which one", async () => {
    const missing = randomUUID();
    const result = await settleRace(missing, PAYLOAD_HASH);
    expect(result.kind).toBe("REFUSED");
    if (result.kind === "REFUSED") {
      expect(result.reason).toBe("RACE_NOT_FOUND");
      // The id, not a bare "not found": a worker draining a queue of races
      // logs this, and one without the id names nothing.
      expect(result.detail).toBe(`no race ${missing}`);
    }
  });

  it("rejects a payload hash that is not a sha256 digest", async () => {
    const { raceId } = await makeRace();
    // A settlement whose source bytes cannot be located is unreplayable, and
    // an unreplayable settlement cannot end a dispute.
    await expect(settleRace(raceId, "not-a-hash")).rejects.toThrow(TypeError);
    await expect(settleRace(raceId, "A".repeat(64))).rejects.toThrow(TypeError);
    // The message names the offending value: a bare TypeError from a worker
    // processing a queue of races says nothing about which race failed.
    await expect(settleRace(raceId, "not-a-hash")).rejects.toThrow(
      /payloadHash must be a sha256 hex digest, got 'not-a-hash'/,
    );
  });

  it("settles an each-way bet across both parts", async () => {
    const { raceId, runnerIds } = await makeRace({
      finish: { 1: 1, 2: 2, 3: 3 },
      actualRunners: 8,
      isHandicap: false,
    });
    // Backed the third horse: the place part pays, the win part does not.
    const placed = await bet(raceId, runnerIds[3]!, {
      betType: "EACH_WAY",
      unitStakeMinor: 1000n,
    });
    const afterStake = await balance();

    const result = await settleRace(raceId, PAYLOAD_HASH);
    if (result.kind !== "DONE") throw new Error(result.detail);

    const rows = await db.select().from(settlements).where(eq(settlements.betId, placed.id));
    expect(rows[0]!.outcome).toBe("PARTIAL");
    expect(rows[0]!.returnMinor).toBeGreaterThan(0n);
    expect(await balance()).toBe(afterStake + rows[0]!.returnMinor);

    const calc = rows[0]!.calculation as { parts: Array<{ part: string }> };
    expect(calc.parts.map((p) => p.part)).toEqual(["WIN", "PLACE"]);
  });

  it("leaves the ledger summing to zero after every settlement path", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1, 2: 2 } });
    await bet(raceId, runnerIds[1]!);
    await bet(raceId, runnerIds[2]!, { betType: "EACH_WAY" });
    await bet(raceId, runnerIds[5]!);
    await settleRace(raceId, PAYLOAD_HASH);

    const [row] = await db.execute<{ total: string; n: string }>(
      sql`select coalesce(sum(amount_minor), 0)::text as total,
                 count(*)::text as n from ledger_entries`,
    );
    expect(Number(row!.n)).toBeGreaterThan(0);
    expect(BigInt(row!.total)).toBe(0n);

    // And every individual transaction balances, not just the grand total —
    // two offsetting errors would hide in the sum.
    const unbalanced = await db.execute<{ txn_id: string }>(sql`
      select txn_id from ledger_entries
       group by txn_id having sum(amount_minor) <> 0
    `);
    expect(unbalanced).toHaveLength(0);
  });

  it("skips a bet whose leg names a runner not in the race", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
    await bet(raceId, runnerIds[1]!);
    // A data defect: the runner disappears from the race after placement.
    await db.execute(sql`delete from runners where id = ${runnerIds[1]!}::uuid`);

    const result = await settleRace(raceId, PAYLOAD_HASH);
    if (result.kind !== "DONE") throw new Error(result.detail);

    expect(result.report.bets[0]!.status).toBe("NO_RUNNER");
    expect(result.report.settled).toBe(0);
    expect(await db.select().from(settlements)).toHaveLength(0);
  });

  it("never writes a settlement row that the append-only ledger contradicts", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
    const placed = await bet(raceId, runnerIds[1]!);
    await settleRace(raceId, PAYLOAD_HASH);

    // Every settlement with a return has ledger entries backing it, tagged to
    // the same bet. A settlement row with no money behind it is a lie.
    const row = (
      await db.select().from(settlements).where(eq(settlements.betId, placed.id))
    )[0]!;
    const credited = await db.execute<{ total: string }>(sql`
      select coalesce(sum(amount_minor), 0)::text as total
        from ledger_entries
       where ref_id = ${placed.id}::uuid
         and wallet_id = ${walletId}::uuid
         and entry_type in ('RETURN','REFUND')
    `);
    expect(BigInt(credited[0]!.total)).toBe(row.returnMinor);
  });

  it("does not re-settle a bet already settled at the same version", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
    const placed = await bet(raceId, runnerIds[1]!);
    await settleRace(raceId, PAYLOAD_HASH);

    const before = await balance();
    // A worker retry with a DIFFERENT payload hash but the same result version
    // must still be a no-op — the version is what identifies the result.
    const again = await settleRace(raceId, "c".repeat(64));
    if (again.kind !== "DONE") throw new Error(again.detail);

    expect(again.report.alreadySettled).toBe(1);
    expect(await balance()).toBe(before);
    const rows = await db
      .select()
      .from(settlements)
      .where(and(eq(settlements.betId, placed.id), eq(settlements.isReversal, false)));
    expect(rows).toHaveLength(1);
  });
  it("does not double-pay when it LOSES the insert race for a settlement", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
    const placed = await bet(raceId, runnerIds[1]!);
    await settleRace(raceId, PAYLOAD_HASH);
    const paid = await balance();

    // Reproduce exactly what a losing concurrent worker sees: it read the bet
    // BEFORE the winner committed, so its settled_version is still null, but
    // the settlement row now exists. Rewinding the bet row reproduces that view
    // deterministically — Promise.all cannot, because the schedule that
    // produces it is not something a test can force.
    await db.execute(sql`
      update bets set settled_version = null, status = 'open', return_minor = 0,
                      settled_at = null
       where id = ${placed.id}::uuid`);

    const second = await settleRace(raceId, PAYLOAD_HASH);
    if (second.kind !== "DONE") throw new Error(second.detail);

    // The unique index refuses the second insert, so the worker reports the bet
    // as already settled and — the part that matters — writes NO ledger entry.
    expect(second.report.bets[0]!.status).toBe("ALREADY_SETTLED");
    expect(second.report.settled).toBe(0);
    expect(await balance()).toBe(paid);
    expect(
      await db
        .select()
        .from(settlements)
        .where(and(eq(settlements.betId, placed.id), eq(settlements.isReversal, false))),
    ).toHaveLength(1);
  });
  it.each(["void", "abandoned"] as const)(
    "settles a '%s' race by refunding, rather than refusing it",
    async (status) => {
      // SETTLEABLE_RACE_STATUSES carries three values. Only 'result' was
      // exercised, so two thirds of that set were unconstrained — dropping
      // either would have silently stopped refunding abandoned meetings.
      const { raceId, runnerIds } = await makeRace({ finish: { 1: 1 } });
      await bet(raceId, runnerIds[1]!);
      const afterStake = await balance();
      await db.execute(
        sql`update races set status = ${status} where id = ${raceId}::uuid`,
      );

      const result = await settleRace(raceId, PAYLOAD_HASH);
      if (result.kind !== "DONE") throw new Error(result.detail);

      expect(result.report.settled).toBe(1);
      // The whole stake comes back: the race did not happen.
      expect(await balance()).toBe(afterStake + 1000n);
      const rows = await db.select().from(settlements);
      expect(rows[0]!.outcome).toBe("VOID");
    },
  );

  it("tags reversal ledger entries to the bet, so they can be traced", async () => {
    const { raceId, runnerIds } = await makeRace({ finish: { 1: 1, 2: 2 } });
    const placed = await bet(raceId, runnerIds[1]!);
    await settleRace(raceId, PAYLOAD_HASH);

    await db.execute(sql`
      update runners set disqualified = true where id = ${runnerIds[1]!}::uuid`);
    await db.execute(sql`
      update races set result_version = result_version + 1 where id = ${raceId}::uuid`);
    await settleRace(raceId, "d".repeat(64));

    const entries = await db.execute<{ ref_type: string; ref_id: string; memo: string | null }>(
      sql`select ref_type, ref_id::text, memo from ledger_entries
           where entry_type = 'REVERSAL'`,
    );
    expect(entries).toHaveLength(2);
    // Untagged reversal entries would be unattributable in the ledger — a
    // clawback nobody could explain to the user it came from.
    expect(entries.every((e) => e.ref_type === "bet")).toBe(true);
    expect(entries.every((e) => e.ref_id === placed.id)).toBe(true);
    expect(entries.some((e) => (e.memo ?? "").includes("result_version"))).toBe(true);
  });
});
