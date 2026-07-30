import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, type Database } from "@/db/client";
import { placeBet } from "@/modules/betting";
import { identityService } from "@/modules/identity";
import { settleRace } from "@/modules/settlement";
import { getEquityCurve, getPerformanceSummary, MIN_SAMPLE_FOR_RATIO } from "./service";

/**
 * Analytics against a real PostgreSQL — docs/02 P0-08.
 *
 * Driven through the real placement and settlement paths rather than by
 * inserting rows directly. Analytics that agrees with hand-written fixtures
 * but not with what the engine actually writes would be worse than none.
 */
const url = process.env["TEST_DATABASE_URL"];

if (!url) {
  console.warn("\n  SKIPPED: analytics tests need TEST_DATABASE_URL.\n");
}

const PAYLOAD_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe.skipIf(!url)("analytics against PostgreSQL", () => {
  let db: Database;
  let userId: string;

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
          email: `analytics-${randomUUID()}@example.test`,
          password: "correct horse battery staple",
        },
        tx,
      ),
    );
    userId = user.id;
  });

  /** A race where cloth 1 wins, cloth 2 is second, cloth 3 third. */
  async function makeRace() {
    const raceRows = await db.execute<{ id: string }>(sql`
      WITH t AS (INSERT INTO tracks (name, country_code, timezone)
                 VALUES (${`Course ${randomUUID().slice(0, 8)}`}, 'GB', 'Europe/London')
                 RETURNING id),
           m AS (INSERT INTO meetings (track_id, date)
                 SELECT id, DATE '2024-04-01' FROM t RETURNING id)
      INSERT INTO races (meeting_id, provider_ref, provider_id, name, off_time,
                         is_handicap, status, actual_runners)
      SELECT id, ${randomUUID()}, 'test', 'Analytics Race',
             now() - interval '1 hour', false, 'open', 8
      FROM m RETURNING id
    `);
    const raceId = raceRows[0]!.id;

    const runnerIds: string[] = [];
    for (let cloth = 1; cloth <= 8; cloth += 1) {
      const rows = await db.execute<{ id: string }>(sql`
        WITH h AS (INSERT INTO horses (name)
                   VALUES (${`Horse ${randomUUID().slice(0, 8)}`}) RETURNING id)
        INSERT INTO runners (race_id, horse_id, cloth_number, status,
                             starting_price, finish_position)
        SELECT ${raceId}::uuid, h.id, ${cloth}, 'declared', 5.000,
               ${cloth <= 3 ? cloth : null}
        FROM h RETURNING id
      `);
      runnerIds.push(rows[0]!.id);
    }
    return { raceId, runnerIds };
  }

  async function placeAndSettle(
    picks: Array<{ cloth: number; stakeMinor?: bigint; betType?: "WIN" | "EACH_WAY" }>,
  ) {
    const { raceId, runnerIds } = await makeRace();
    for (const pick of picks) {
      const outcome = await placeBet({
        userId,
        idempotencyKey: randomUUID(),
        betType: pick.betType ?? "WIN",
        unitStakeMinor: pick.stakeMinor ?? 1000n,
        raceId,
        runnerId: runnerIds[pick.cloth - 1]!,
        oddsTaken: 5,
        oddsTolerance: 0,
      });
      if (outcome.kind !== "PLACED") throw new Error(outcome.detail);
    }
    await db.execute(sql`update races set status = 'result' where id = ${raceId}::uuid`);
    await settleRace(raceId, PAYLOAD_HASH);
    return raceId;
  }

  it("reports zeroes, not NaN, for a user who has never bet", async () => {
    const s = await getPerformanceSummary(userId);

    expect(s.settledBets).toBe(0);
    expect(s.stakedMinor).toBe(0n);
    expect(s.profitMinor).toBe(0n);
    // Null, not 0 — "no ROI" and "an ROI of zero" are different statements.
    expect(s.roi.value).toBeNull();
    expect(s.roi.meaningful).toBe(false);
    expect(s.strikeRate.value).toBeNull();
    expect(s.averageOddsTaken).toBeNull();
    expect(s.balanceMinor).toBe(10_000_000n);
  });

  it("computes P&L from the ledger", async () => {
    // One £10 winner at 5.0 returning £50, two £10 losers.
    await placeAndSettle([{ cloth: 1 }, { cloth: 4 }, { cloth: 5 }]);
    const s = await getPerformanceSummary(userId);

    expect(s.stakedMinor).toBe(3000n);
    expect(s.returnedMinor).toBe(5000n);
    expect(s.profitMinor).toBe(2000n);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(2);
    expect(s.settledBets).toBe(3);
  });

  it("reports a LOSS without clamping it to zero", async () => {
    await placeAndSettle([{ cloth: 4 }, { cloth: 5 }]);
    const s = await getPerformanceSummary(userId);

    expect(s.profitMinor).toBe(-2000n);
    expect(s.roi.value).toBeCloseTo(-1, 10);
  });

  it("computes ROI as (returns - stakes) / stakes", async () => {
    await placeAndSettle([{ cloth: 1 }, { cloth: 4 }]);
    const s = await getPerformanceSummary(userId);

    // Staked £20, returned £50, profit £30. ROI = 3000/2000 = 1.5.
    expect(s.stakedMinor).toBe(2000n);
    expect(s.profitMinor).toBe(3000n);
    expect(s.roi.value).toBeCloseTo(1.5, 10);
  });

  it("carries the SAMPLE SIZE with every ratio and flags a small one", async () => {
    // docs/02 §5: a huge ROI on two bets is noise, and the shape of the return
    // value must make that impossible for a caller to render without seeing.
    await placeAndSettle([{ cloth: 1 }, { cloth: 4 }]);
    const s = await getPerformanceSummary(userId);

    expect(s.roi.sampleSize).toBe(2);
    expect(s.roi.meaningful).toBe(false);
    expect(s.strikeRate.sampleSize).toBe(2);
    expect(s.strikeRate.meaningful).toBe(false);
    expect(MIN_SAMPLE_FOR_RATIO).toBeGreaterThan(2);
  });

  it("marks a ratio meaningful once the sample clears the threshold", async () => {
    // Enough bets to cross MIN_SAMPLE_FOR_RATIO, in races of eight.
    const perRace = 6;
    const races = Math.ceil((MIN_SAMPLE_FOR_RATIO + 1) / perRace);
    for (let i = 0; i < races; i += 1) {
      await placeAndSettle(
        Array.from({ length: perRace }, (_, k) => ({ cloth: k + 1 })),
      );
    }

    const s = await getPerformanceSummary(userId);
    expect(s.settledBets).toBeGreaterThanOrEqual(MIN_SAMPLE_FOR_RATIO);
    expect(s.roi.meaningful).toBe(true);
    // Non-vacuous: the flag tracks the count rather than being hardcoded true.
    expect(s.roi.sampleSize).toBe(s.settledBets);
  });

  it("excludes VOID bets from the strike-rate denominator", async () => {
    const { raceId, runnerIds } = await makeRace();
    for (const cloth of [1, 4, 6]) {
      const outcome = await placeBet({
        userId,
        idempotencyKey: randomUUID(),
        betType: "WIN",
        unitStakeMinor: 1000n,
        raceId,
        runnerId: runnerIds[cloth - 1]!,
        oddsTaken: 5,
        oddsTolerance: 0,
      });
      if (outcome.kind !== "PLACED") throw new Error(outcome.detail);
    }
    // Cloth 6 becomes a non-runner: that bet is void, not lost.
    await db.execute(
      sql`update runners set status = 'non_runner' where id = ${runnerIds[5]!}::uuid`,
    );
    await db.execute(sql`update races set status = 'result' where id = ${raceId}::uuid`);
    await settleRace(raceId, PAYLOAD_HASH);

    const s = await getPerformanceSummary(userId);
    expect(s.voids).toBe(1);
    expect(s.settledBets).toBe(3);
    // One winner from two DECIDED bets, not from three.
    expect(s.strikeRate.value).toBeCloseTo(0.5, 10);
    expect(s.strikeRate.sampleSize).toBe(2);
  });

  it("counts an each-way place as a strike", async () => {
    // Cloth 3 finished third: the place part paid, the win part did not.
    await placeAndSettle([{ cloth: 3, betType: "EACH_WAY" }]);
    const s = await getPerformanceSummary(userId);

    expect(s.places).toBe(1);
    expect(s.wins).toBe(0);
    expect(s.strikeRate.value).toBeCloseTo(1, 10);
  });

  it("stake-weights the average odds", async () => {
    const { raceId, runnerIds } = await makeRace();
    // £10 at 5.0 and £30 at 5.0 -> 5.0. Then a bet at a different price to
    // prove the weighting is doing something.
    await db.execute(
      sql`update runners set starting_price = 3.000 where id = ${runnerIds[3]!}::uuid`,
    );
    for (const [cloth, stake, odds] of [
      [1, 1000n, 5],
      [4, 3000n, 3],
    ] as const) {
      const outcome = await placeBet({
        userId,
        idempotencyKey: randomUUID(),
        betType: "WIN",
        unitStakeMinor: stake,
        raceId,
        runnerId: runnerIds[cloth - 1]!,
        oddsTaken: odds,
        oddsTolerance: 0,
      });
      if (outcome.kind !== "PLACED") throw new Error(outcome.detail);
    }

    const s = await getPerformanceSummary(userId);
    // (10x5 + 30x3) / 40 = 3.5, NOT the unweighted mean of 4.0.
    expect(s.averageOddsTaken).toBeCloseTo(3.5, 6);
  });

  it("counts open bets separately and keeps them out of P&L", async () => {
    const { raceId, runnerIds } = await makeRace();
    const outcome = await placeBet({
      userId,
      idempotencyKey: randomUUID(),
      betType: "WIN",
      unitStakeMinor: 1000n,
      raceId,
      runnerId: runnerIds[0]!,
      oddsTaken: 5,
      oddsTolerance: 0,
    });
    if (outcome.kind !== "PLACED") throw new Error(outcome.detail);

    const s = await getPerformanceSummary(userId);
    expect(s.openBets).toBe(1);
    expect(s.settledBets).toBe(0);
    // The stake HAS left the wallet, so it counts as staked; but with no
    // settled bets the ROI has no sample and must not be reported as -100%.
    expect(s.stakedMinor).toBe(1000n);
    expect(s.roi.sampleSize).toBe(0);
    expect(s.roi.meaningful).toBe(false);
  });

  it("builds an equity curve that ends at the real balance", async () => {
    await placeAndSettle([{ cloth: 1 }, { cloth: 4 }]);

    const curve = await getEquityCurve(userId);
    const summary = await getPerformanceSummary(userId);

    expect(curve.length).toBeGreaterThan(1);
    // Opening balance, two stakes, one return.
    expect(curve[0]!.entryType).toBe("OPENING_BALANCE");
    expect(curve[0]!.balanceMinor).toBe(10_000_000n);
    // The curve is the ledger replayed, so its last point IS the balance.
    expect(curve.at(-1)!.balanceMinor).toBe(summary.balanceMinor);
  });

  it("keeps the equity curve monotonically ordered in time", async () => {
    await placeAndSettle([{ cloth: 1 }, { cloth: 4 }, { cloth: 5 }]);
    const curve = await getEquityCurve(userId);

    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.at.getTime()).toBeGreaterThanOrEqual(curve[i - 1]!.at.getTime());
    }
    // Each point's balance is the previous plus the delta — a running total,
    // not a series of independent snapshots.
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.balanceMinor).toBe(curve[i - 1]!.balanceMinor + curve[i]!.deltaMinor);
    }
  });

  it("reflects a re-settlement in both the curve and the summary", async () => {
    const { raceId, runnerIds } = await makeRace();
    const outcome = await placeBet({
      userId,
      idempotencyKey: randomUUID(),
      betType: "WIN",
      unitStakeMinor: 1000n,
      raceId,
      runnerId: runnerIds[1]!,
      oddsTaken: 5,
      oddsTolerance: 0,
    });
    if (outcome.kind !== "PLACED") throw new Error(outcome.detail);
    await db.execute(sql`update races set status = 'result' where id = ${raceId}::uuid`);
    await settleRace(raceId, PAYLOAD_HASH);

    const lost = await getPerformanceSummary(userId);
    expect(lost.profitMinor).toBe(-1000n);

    // Stewards promote the horse that was second.
    await db.execute(
      sql`update runners set finish_position = 2 where id = ${runnerIds[0]!}::uuid`,
    );
    await db.execute(
      sql`update runners set finish_position = 1 where id = ${runnerIds[1]!}::uuid`,
    );
    await db.execute(
      sql`update races set result_version = result_version + 1 where id = ${raceId}::uuid`,
    );
    await settleRace(raceId, "a".repeat(64));

    const won = await getPerformanceSummary(userId);
    expect(won.profitMinor).toBe(4000n);
    expect(won.wins).toBe(1);
    expect(won.losses).toBe(0);

    const curve = await getEquityCurve(userId);
    expect(curve.at(-1)!.balanceMinor).toBe(won.balanceMinor);
  });

  it("counts a bet parked for review without paying it", async () => {
    const { raceId, runnerIds } = await makeRace();
    const outcome = await placeBet({
      userId,
      idempotencyKey: randomUUID(),
      betType: "WIN",
      unitStakeMinor: 1000n,
      raceId,
      runnerId: runnerIds[0]!,
      oddsTaken: 5,
      oddsTolerance: 0,
    });
    if (outcome.kind !== "PLACED") throw new Error(outcome.detail);
    await db.execute(
      sql`update runners set status = 'withdrawn' where id = ${runnerIds[6]!}::uuid`,
    );
    await db.execute(sql`update races set status = 'result' where id = ${raceId}::uuid`);
    await settleRace(raceId, PAYLOAD_HASH);

    const s = await getPerformanceSummary(userId);
    expect(s.needsReview).toBe(1);
    // Not counted as settled, so it cannot flatter or damage the ROI while a
    // human is still deciding it.
    expect(s.settledBets).toBe(0);
    expect(s.returnedMinor).toBe(0n);
  });
});
