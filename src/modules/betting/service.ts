import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, type Executor, type Transaction } from "@/db/client";
import { walletService } from "@/modules/wallet";
import { betLegs, bets, type Bet } from "./schema";

/**
 * Bet placement — docs/03 §4, the single most correctness-sensitive flow.
 *
 * SERIALIZABLE, not optimistic locking: wallet contention per user is low and
 * correctness matters more than a few milliseconds. The balance is computed
 * from the ledger every time; there is no balance column and never will be
 * (docs/04 §1 rule 2).
 *
 * Refusals are return values, not exceptions — consistent with `docs/08` D14,
 * D17 and D22. Insufficient balance and a moved price are ordinary business
 * outcomes, not programmer errors, and a caller has to render them.
 */

export type BetType = "WIN" | "PLACE" | "EACH_WAY";

export interface PlaceBetInput {
  userId: string;
  /** Client-supplied UUID. Retrying with the same key returns the same bet. */
  idempotencyKey: string;
  betType: BetType;
  /** Per part, in pence. EACH_WAY debits twice this. */
  unitStakeMinor: bigint;
  raceId: string;
  runnerId: string;
  /** The price the user is accepting. */
  oddsTaken: number;
  /**
   * How far the price may have moved against them before we refuse, in
   * decimal points. 0 means "any movement rejects".
   */
  oddsTolerance: number;
}

export type PlaceBetRefusal =
  | "RACE_NOT_OPEN"
  | "RUNNER_NOT_DECLARED"
  | "ODDS_MOVED"
  | "INSUFFICIENT_BALANCE"
  | "NO_PRICE";

export type PlaceBetOutcome =
  | { kind: "PLACED"; bet: Bet; duplicate: boolean }
  | {
      kind: "REFUSED";
      reason: PlaceBetRefusal;
      detail: string;
    };

/** Race and runner state the placement path needs. Read inside the txn. */
interface Candidate {
  raceStatus: string;
  runnerStatus: string;
  currentOdds: number | null;
}

async function readCandidate(
  tx: Transaction,
  raceId: string,
  runnerId: string,
): Promise<Candidate | null> {
  // FOR SHARE on the race: it must not change status underneath us, but other
  // bettors on the same race must not be blocked either (docs/03 §4).
  const rows = await tx.execute<{
    race_status: string;
    runner_status: string;
    starting_price: string | null;
  }>(sql`
    SELECT ra.status AS race_status,
           ru.status AS runner_status,
           ru.starting_price
      FROM races ra
      JOIN runners ru ON ru.race_id = ra.id
     WHERE ra.id = ${raceId}::uuid AND ru.id = ${runnerId}::uuid
     FOR SHARE OF ra, ru
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    raceStatus: row.race_status,
    runnerStatus: row.runner_status,
    currentOdds: row.starting_price === null ? null : Number(row.starting_price),
  };
}

/**
 * Places a bet, or refuses with a reason.
 *
 * The whole thing is one SERIALIZABLE transaction: read the race, re-check the
 * price, compute the balance from the ledger, insert the bet, debit the stake.
 * Either all of it happens or none of it does.
 */
export async function placeBet(
  input: PlaceBetInput,
  tx?: Transaction,
): Promise<PlaceBetOutcome> {
  if (input.unitStakeMinor <= 0n) {
    throw new RangeError(`unit stake must be positive, got ${input.unitStakeMinor}`);
  }
  if (!Number.isFinite(input.oddsTaken) || input.oddsTaken <= 1) {
    throw new RangeError(`oddsTaken must exceed 1, got ${input.oddsTaken}`);
  }
  if (!Number.isFinite(input.oddsTolerance) || input.oddsTolerance < 0) {
    throw new RangeError("oddsTolerance must be a non-negative number");
  }

  const run = async (t: Transaction): Promise<PlaceBetOutcome> => {
    // 3. Idempotency. A retry returns the original bet and does NOT re-debit.
    // Checked first so a duplicate costs no locks; the unique index is the
    // real guarantee, and the catch below closes the race between the two.
    const existing = await t
      .select()
      .from(bets)
      .where(
        and(
          eq(bets.userId, input.userId),
          eq(bets.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return { kind: "PLACED", bet: existing[0], duplicate: true };
    }

    const candidate = await readCandidate(t, input.raceId, input.runnerId);
    if (!candidate) {
      return {
        kind: "REFUSED",
        reason: "RACE_NOT_OPEN",
        detail: "no such race or runner",
      };
    }

    // 4a. The race must be open and not yet off.
    if (candidate.raceStatus !== "open") {
      return {
        kind: "REFUSED",
        reason: "RACE_NOT_OPEN",
        detail: `race status is '${candidate.raceStatus}', not 'open'`,
      };
    }

    // 4b. The runner must be a declared runner.
    if (candidate.runnerStatus !== "declared") {
      return {
        kind: "REFUSED",
        reason: "RUNNER_NOT_DECLARED",
        detail: `runner status is '${candidate.runnerStatus}'`,
      };
    }

    // 4c. Re-fetch the price and check it against the user's tolerance.
    if (candidate.currentOdds === null) {
      return {
        kind: "REFUSED",
        reason: "NO_PRICE",
        detail: "the runner has no price, so there is nothing to accept",
      };
    }
    // Only movement AGAINST the bettor matters. A drift in their favour is
    // taken at the price they asked for, which is what a fixed-odds bet means.
    const drift = input.oddsTaken - candidate.currentOdds;
    if (drift > input.oddsTolerance) {
      return {
        kind: "REFUSED",
        reason: "ODDS_MOVED",
        detail:
          `price moved from ${input.oddsTaken} to ${candidate.currentOdds}, ` +
          `beyond the accepted tolerance of ${input.oddsTolerance}`,
      };
    }

    const totalStake =
      input.betType === "EACH_WAY" ? input.unitStakeMinor * 2n : input.unitStakeMinor;

    // 4d. Balance from the ledger. Never a cached column.
    const walletRows = await t.execute<{ id: string }>(sql`
      SELECT id FROM wallets WHERE user_id = ${input.userId}::uuid AND kind = 'user' LIMIT 1
    `);
    const walletId = walletRows[0]?.id;
    if (!walletId) {
      throw new Error(`user ${input.userId} has no wallet — registration is transactional (docs/08 D8)`);
    }

    const balance = await walletService.getBalance(walletId, t);
    if (balance < totalStake) {
      // docs/03 §4: reject, never clamp.
      return {
        kind: "REFUSED",
        reason: "INSUFFICIENT_BALANCE",
        detail: `balance ${balance} is below the total stake ${totalStake}`,
      };
    }

    const inserted = await t
      .insert(bets)
      .values({
        userId: input.userId,
        walletId,
        idempotencyKey: input.idempotencyKey,
        betType: input.betType,
        unitStakeMinor: input.unitStakeMinor,
        totalStakeMinor: totalStake,
        status: "open",
      })
      .returning();
    const bet = inserted[0];
    if (!bet) throw new Error("bet insert returned no row");

    await t.insert(betLegs).values({
      betId: bet.id,
      legIndex: 0,
      raceId: input.raceId,
      runnerId: input.runnerId,
      oddsTaken: input.oddsTaken.toFixed(3),
      outcome: "pending",
    });

    // 4e. Debit the stake. Balanced pair — virtual money is never created.
    const house = await walletService.getHouseWallet(t);
    await walletService.postTransaction(
      {
        txnId: randomUUID(),
        lines: [
          {
            walletId,
            amountMinor: -totalStake,
            entryType: "STAKE",
            refType: "bet",
            refId: bet.id,
          },
          {
            walletId: house.id,
            amountMinor: totalStake,
            entryType: "STAKE",
            refType: "bet",
            refId: bet.id,
          },
        ],
      },
      t,
    );

    return { kind: "PLACED", bet, duplicate: false };
  };

  // A caller-supplied transaction is the caller's to manage. Any failure below
  // aborts it, and only its owner can decide whether to restart — so no retry
  // and no recovery query here, both of which would run on a poisoned handle.
  if (tx) return run(tx);

  // A serialization failure is not an error condition under SERIALIZABLE — it
  // is the isolation level's contract, and the application is required to
  // retry. Two people betting on the same race, or one client retrying over a
  // flaky connection, would otherwise both see a 500.
  //
  // Retrying is safe because the whole transaction aborted: nothing was
  // written, and the idempotency pre-check at the top of `run` picks up
  // whichever bet did commit, returning it as a duplicate. Bounded, because a
  // retry loop with no ceiling turns contention into an outage. No backoff
  // jitter — `Math.random()` and `Date.now()` stay out of the money path
  // (.claude/rules/money.md), and per-user wallet contention is low by design.
  let lastError: unknown;
  for (let tries = 0; tries < MAX_PLACEMENT_ATTEMPTS; tries += 1) {
    try {
      return await getDb().transaction(run, { isolationLevel: "serializable" });
    } catch (error) {
      if (!isRetryable(error)) throw error;
      lastError = error;
    }
  }
  throw new Error(
    `bet placement lost ${MAX_PLACEMENT_ATTEMPTS} serialization races for user ` +
      `${input.userId}; last error: ${String(lastError)}`,
  );
}

/** Bounded so contention surfaces as an error, never as an unbounded loop. */
const MAX_PLACEMENT_ATTEMPTS = 5;

/** The idempotency index. Named so a different unique violation is not retried. */
const IDEMPOTENCY_CONSTRAINT = "bets_user_id_idempotency_key_key";

function pgField(error: unknown, field: string): string | undefined {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Three SQLSTATEs mean "this transaction did not happen; run it again". None is
 * a business outcome, and re-running is what resolves each:
 *
 * - `40001` serialization_failure — the expected outcome of SERIALIZABLE.
 * - `40P01` deadlock_detected — one side is chosen as the victim.
 * - `23505` on the idempotency index — a concurrent request with the same key
 *   committed after our snapshot was taken. Postgres reports this as 40001 at
 *   SERIALIZABLE rather than 23505, so this arm is belt-and-braces for a
 *   future caller running at a lower isolation level; either way the retry's
 *   pre-check now sees the committed row and returns it as a duplicate. That
 *   is why there is no separate recovery query — re-running IS the recovery.
 *
 * A unique violation on any other constraint is a real defect and propagates.
 */
function isRetryable(error: unknown): boolean {
  const code = pgField(error, "code");
  if (code === "40001" || code === "40P01") return true;
  return code === "23505" && pgField(error, "constraint_name") === IDEMPOTENCY_CONSTRAINT;
}

export async function listBetsForUser(
  userId: string,
  tx?: Executor,
): Promise<Bet[]> {
  return (tx ?? getDb())
    .select()
    .from(bets)
    .where(eq(bets.userId, userId))
    .orderBy(sql`${bets.placedAt} DESC`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Settlement-facing interface.
 *
 * The settlement module owns `settlements`; this module owns `bets` and
 * `bet_legs`. These four functions are the whole sanctioned surface between
 * them (`.claude/rules/modules.md`) — settlement never queries a bet table.
 * ──────────────────────────────────────────────────────────────────────────── */

/** One bet standing on a race, with the leg that names its runner. */
export interface SettleableBet {
  betId: string;
  userId: string;
  walletId: string;
  betType: BetType;
  unitStakeMinor: bigint;
  totalStakeMinor: bigint;
  status: string;
  settledVersion: number | null;
  returnMinor: bigint;
  legId: string;
  runnerId: string;
  /** Frozen at placement. The bet settles at this price, not the current one. */
  oddsTaken: number;
}

/**
 * Every bet on a race that settlement should consider.
 *
 * Includes already-settled bets, not just open ones, because a stewards'
 * amendment has to reach the bets the previous result paid out. The worker
 * decides what to do with each from `settledVersion`; filtering to open bets
 * here would make re-settlement structurally impossible.
 */
export async function listBetsForRace(
  raceId: string,
  tx?: Executor,
): Promise<SettleableBet[]> {
  const rows = await (tx ?? getDb())
    .select({
      betId: bets.id,
      userId: bets.userId,
      walletId: bets.walletId,
      betType: bets.betType,
      unitStakeMinor: bets.unitStakeMinor,
      totalStakeMinor: bets.totalStakeMinor,
      status: bets.status,
      settledVersion: bets.settledVersion,
      returnMinor: bets.returnMinor,
      legId: betLegs.id,
      runnerId: betLegs.runnerId,
      oddsTaken: betLegs.oddsTaken,
    })
    .from(bets)
    .innerJoin(betLegs, eq(betLegs.betId, bets.id))
    .where(eq(betLegs.raceId, raceId))
    .orderBy(bets.placedAt);

  return rows.map((r) => ({
    ...r,
    betType: r.betType as BetType,
    // NUMERIC(10,3) arrives as a string. Odds are a multiplier, never money.
    oddsTaken: Number(r.oddsTaken),
  }));
}

export interface BetSettlementUpdate {
  betId: string;
  legId: string;
  /** 'won' | 'lost' | 'void' | 'partial' | 'needs_review' */
  status: string;
  legOutcome: "won" | "placed" | "lost" | "void" | "pending";
  returnMinor: bigint;
  resultVersion: number;
  settledAt: Date;
}

/**
 * Records the result of settling one bet.
 *
 * `bets.return_minor` and `bets.status` are a derived cache of the settlement
 * row, kept because every bet-history screen would otherwise join settlements.
 * The ledger and `settlements` remain authoritative; this is the only place
 * that writes them, and a re-settlement overwrites rather than accumulates.
 */
export async function recordBetSettlement(
  update: BetSettlementUpdate,
  tx: Transaction,
): Promise<void> {
  await tx
    .update(bets)
    .set({
      status: update.status,
      returnMinor: update.returnMinor,
      settledVersion: update.resultVersion,
      settledAt: update.settledAt,
    })
    .where(eq(bets.id, update.betId));

  await tx
    .update(betLegs)
    .set({ outcome: update.legOutcome })
    .where(eq(betLegs.id, update.legId));
}
