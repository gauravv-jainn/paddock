import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, type Transaction } from "@/db/client";
import {
  listBetsForRace,
  recordBetSettlement,
  type SettleableBet,
} from "@/modules/betting";
import { getRaceForSettlement, type SettlementRaceRow } from "@/modules/catalog";
import { walletService } from "@/modules/wallet";
import { settlements, type Settlement } from "./schema";
import { settle } from "./settle";
import type {
  SettlementBet,
  SettlementOutcome,
  SettlementRace,
  SettlementRunner,
  Withdrawal,
} from "./types";

/**
 * The settlement worker — docs/03 §5.
 *
 *   FOR each bet on race:
 *     outcome = settle(bet, race, runner)      ← pure, no I/O
 *     write settlement row + ledger entries
 *   idempotent on (bet_id, result_version)
 *
 * Everything impure lives here so that `settle()` stays a pure function of
 * three values. This file reads, maps, writes and decides nothing about money.
 *
 * IDEMPOTENCE is the unique index on (bet_id, result_version, is_reversal),
 * not a check-then-write: two workers racing on the same race both attempt the
 * insert and exactly one succeeds. A bet already settled at this version is
 * skipped before any ledger entry is written.
 *
 * RE-SETTLEMENT never mutates. When `result_version` has moved on, the prior
 * settlement is reversed with compensating ledger entries and a new settlement
 * is written. Both rows survive, so the user can see both states (docs/03 §5).
 */

export type SettleRaceStatus =
  | "SETTLED"
  | "ALREADY_SETTLED"
  | "RESETTLED"
  | "NEEDS_REVIEW"
  | "NO_RUNNER";

export interface BetSettlementReport {
  betId: string;
  status: SettleRaceStatus;
  outcome?: SettlementOutcome["kind"];
  returnMinor?: bigint;
  detail?: string;
}

export interface SettleRaceReport {
  raceId: string;
  resultVersion: number;
  betsConsidered: number;
  settled: number;
  resettled: number;
  alreadySettled: number;
  needsReview: number;
  bets: BetSettlementReport[];
}

export type SettleRaceOutcome =
  | { kind: "DONE"; report: SettleRaceReport }
  | { kind: "REFUSED"; reason: SettleRaceRefusal; detail: string };

export type SettleRaceRefusal = "RACE_NOT_FOUND" | "RACE_HAS_NO_RESULT";

/**
 * Settles every bet on a race against the current result.
 *
 * `payloadHash` is the sha256 of the provider payload the result came from,
 * persisted by `providers.persistPayload` BEFORE normalising (docs/03 §5). It
 * is required, not optional: a settlement whose source bytes are not on disk
 * cannot be replayed, and an unreplayable settlement cannot end a dispute.
 */
export async function settleRace(
  raceId: string,
  payloadHash: string,
  options?: { now?: Date },
): Promise<SettleRaceOutcome> {
  if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
    throw new TypeError(`payloadHash must be a sha256 hex digest, got '${payloadHash}'`);
  }
  const now = options?.now ?? new Date();

  const race = await getRaceForSettlement(raceId);
  if (!race) {
    return { kind: "REFUSED", reason: "RACE_NOT_FOUND", detail: `no race ${raceId}` };
  }

  // A race that has not been resulted has nothing to settle against. VOID and
  // ABANDONED do settle — they refund — so only the pre-result states refuse.
  if (!SETTLEABLE_RACE_STATUSES.has(race.status)) {
    return {
      kind: "REFUSED",
      reason: "RACE_HAS_NO_RESULT",
      detail: `race status is '${race.status}'; nothing to settle against`,
    };
  }

  const bets = await listBetsForRace(raceId);
  const runnersById = new Map(race.runners.map((r) => [r.runnerId, r]));

  const report: SettleRaceReport = {
    raceId,
    resultVersion: race.resultVersion,
    betsConsidered: bets.length,
    settled: 0,
    resettled: 0,
    alreadySettled: 0,
    needsReview: 0,
    bets: [],
  };

  for (const bet of bets) {
    const line = await settleOneBet(bet, race, runnersById, payloadHash, now);
    report.bets.push(line);
    if (line.status === "SETTLED") report.settled += 1;
    if (line.status === "RESETTLED") report.resettled += 1;
    if (line.status === "ALREADY_SETTLED") report.alreadySettled += 1;
    if (line.status === "NEEDS_REVIEW") report.needsReview += 1;
  }

  return { kind: "DONE", report };
}

/** Pre-result states have no result to settle against. */
const SETTLEABLE_RACE_STATUSES = new Set(["result", "void", "abandoned"]);

async function settleOneBet(
  bet: SettleableBet,
  race: SettlementRaceRow,
  runnersById: Map<string, SettlementRaceRow["runners"][number]>,
  payloadHash: string,
  now: Date,
): Promise<BetSettlementReport> {
  const runnerRow = runnersById.get(bet.runnerId);
  if (!runnerRow) {
    // The leg names a runner that is not in this race. A data defect, not a
    // business outcome — flag it rather than guessing at an outcome.
    return {
      betId: bet.betId,
      status: "NO_RUNNER",
      detail: `runner ${bet.runnerId} is not declared in race ${race.raceId}`,
    };
  }

  if (bet.settledVersion === race.resultVersion) {
    return { betId: bet.betId, status: "ALREADY_SETTLED" };
  }

  // ── The pure part. Everything above and below is I/O; this line is the
  // product, and it sees only values.
  const outcome = settle(
    toSettlementBet(bet),
    toSettlementRace(race),
    toSettlementRunner(runnerRow),
  );

  const isResettlement = bet.settledVersion !== null;

  return getDb().transaction(async (tx) => {
    if (isResettlement) {
      await reversePriorSettlement(tx, bet, race.resultVersion, payloadHash, now);
    }

    const written = await writeSettlement(tx, bet, race, outcome, payloadHash, false);
    if (!written) {
      // Another worker won the race for this (bet, version). Its transaction
      // wrote the ledger entries; ours must not write a second set.
      return { betId: bet.betId, status: "ALREADY_SETTLED" as const };
    }

    if (outcome.kind === "NEEDS_REVIEW") {
      // No money moves on a refusal. The stake stays debited and the bet is
      // parked for a human — inventing a payout is the one thing settlement
      // must never do (.claude/rules/money.md).
      await recordBetSettlement(
        {
          betId: bet.betId,
          legId: bet.legId,
          status: "needs_review",
          legOutcome: "pending",
          returnMinor: 0n,
          resultVersion: race.resultVersion,
          settledAt: now,
        },
        tx,
      );
      return {
        betId: bet.betId,
        status: "NEEDS_REVIEW" as const,
        outcome: outcome.kind,
        detail: outcome.detail,
      };
    }

    if (outcome.returnMinor > 0n) {
      await creditReturn(tx, bet, outcome.returnMinor, outcome.status);
    }

    await recordBetSettlement(
      {
        betId: bet.betId,
        legId: bet.legId,
        status: outcome.status.toLowerCase(),
        legOutcome: legOutcomeFor(outcome),
        returnMinor: outcome.returnMinor,
        resultVersion: race.resultVersion,
        settledAt: now,
      },
      tx,
    );

    return {
      betId: bet.betId,
      status: (isResettlement ? "RESETTLED" : "SETTLED") as SettleRaceStatus,
      outcome: outcome.kind,
      returnMinor: outcome.returnMinor,
    };
  });
}

/**
 * Undoes a prior settlement with compensating entries.
 *
 * Never an UPDATE and never a DELETE — `docs/03` §5 and the append-only ledger
 * trigger both forbid it. The reversal is a new settlement row carrying
 * `is_reversal`, plus ledger entries that exactly negate what the earlier
 * settlement credited. The user ends up where they would have been had the
 * amended result been the first one, and both states stay visible.
 */
async function reversePriorSettlement(
  tx: Transaction,
  bet: SettleableBet,
  newResultVersion: number,
  payloadHash: string,
  now: Date,
): Promise<void> {
  const prior = await tx
    .select()
    .from(settlements)
    .where(
      and(
        eq(settlements.betId, bet.betId),
        eq(settlements.resultVersion, bet.settledVersion as number),
        eq(settlements.isReversal, false),
      ),
    )
    .limit(1);

  const priorRow = prior[0];
  if (!priorRow) return;

  if (priorRow.returnMinor > 0n) {
    // Exactly the opposite of the original credit. The user's balance may go
    // negative and is NOT clamped (.claude/rules/money.md) — a clamp would
    // silently gift the difference.
    const house = await walletService.getHouseWallet(tx);
    await walletService.postTransaction(
      {
        txnId: randomUUID(),
        lines: [
          {
            walletId: bet.walletId,
            amountMinor: -priorRow.returnMinor,
            entryType: "REVERSAL",
            refType: "bet",
            refId: bet.betId,
            memo: `reversal of settlement at result_version ${priorRow.resultVersion}`,
          },
          {
            walletId: house.id,
            amountMinor: priorRow.returnMinor,
            entryType: "REVERSAL",
            refType: "bet",
            refId: bet.betId,
          },
        ],
      },
      tx,
    );
  }

  await tx
    .insert(settlements)
    .values({
      betId: bet.betId,
      raceId: priorRow.raceId,
      resultVersion: priorRow.resultVersion,
      outcome: priorRow.outcome,
      returnMinor: priorRow.returnMinor,
      calculation: jsonSafe({
        version: 1,
        reversalOf: priorRow.id,
        reason: `race amended: result_version ${priorRow.resultVersion} -> ${newResultVersion}`,
        reversedAt: now.toISOString(),
        payloadHash,
        original: priorRow.calculation,
      }) as never,
      payloadHash,
      isReversal: true,
    })
    .onConflictDoNothing();
}

/**
 * JSON cannot carry a bigint, and `settle()`'s calculation is full of them —
 * every exact rational it keeps so that rounding happens exactly once.
 *
 * They are stored as decimal STRINGS, which is lossless: `BigInt(s)` returns
 * the original value. Storing them as JSON numbers would silently round every
 * numerator past 2^53 and quietly destroy the one property the calculation
 * exists to demonstrate. Arrays and object shapes are otherwise untouched, so
 * what is persisted is the derivation settle() returned, not a summary of it.
 */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]),
    );
  }
  return value;
}

/**
 * The stored derivation.
 *
 * On a refusal the machine-readable `reason` and `detail` are stored beside the
 * calculation rather than only inside `rulesApplied`. A review queue that had
 * to regex a prose sentence to find out why a bet was parked would break the
 * first time that sentence was reworded — and `rulesApplied` is prose meant for
 * a person to read.
 */
function storedCalculation(outcome: SettlementOutcome): unknown {
  const calculation = jsonSafe(outcome.calculation);
  if (outcome.kind !== "NEEDS_REVIEW") return calculation;
  return {
    ...(calculation as Record<string, unknown>),
    review: { reason: outcome.reason, detail: outcome.detail },
  };
}

/** Returns null when another worker already wrote this (bet, version). */
async function writeSettlement(
  tx: Transaction,
  bet: SettleableBet,
  race: SettlementRaceRow,
  outcome: SettlementOutcome,
  payloadHash: string,
  isReversal: boolean,
): Promise<Settlement | null> {
  const rows = await tx
    .insert(settlements)
    .values({
      betId: bet.betId,
      raceId: race.raceId,
      resultVersion: race.resultVersion,
      outcome: outcome.kind === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : outcome.status,
      returnMinor: outcome.kind === "NEEDS_REVIEW" ? 0n : outcome.returnMinor,
      calculation: storedCalculation(outcome) as never,
      payloadHash,
      isReversal,
    })
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

/**
 * Credits a settled bet's return.
 *
 * There is deliberately no `isReversal` flag. A reversal posts its own
 * compensating entries in `reversePriorSettlement`, so this path only ever
 * credits — a branch here for the negative case was unreachable code
 * pretending to be a safeguard.
 */
async function creditReturn(
  tx: Transaction,
  bet: SettleableBet,
  returnMinor: bigint,
  status: string,
): Promise<void> {
  const house = await walletService.getHouseWallet(tx);
  // VOID returns the stake and is not a payout; the entry type says which,
  // because analytics must not count a refund as a win.
  const entryType = status === "VOID" ? "REFUND" : "RETURN";
  await walletService.postTransaction(
    {
      txnId: randomUUID(),
      lines: [
        {
          walletId: bet.walletId,
          amountMinor: returnMinor,
          entryType,
          refType: "bet",
          refId: bet.betId,
        },
        {
          walletId: house.id,
          amountMinor: -returnMinor,
          entryType,
          refType: "bet",
          refId: bet.betId,
        },
      ],
    },
    tx,
  );
}

function legOutcomeFor(
  outcome: Extract<SettlementOutcome, { kind: "SETTLED" }>,
): "won" | "placed" | "lost" | "void" {
  if (outcome.status === "VOID") return "void";
  if (outcome.status === "LOST") return "lost";
  // PARTIAL is an each-way bet whose place part paid and win part did not.
  if (outcome.status === "PARTIAL") return "placed";
  return "won";
}

/* ── Mapping. Database vocabulary in, settle()'s value types out. ───────────
 *
 * Exported for testing. These two functions are where a database row becomes a
 * settlement input, so their guards — an unmapped status, a half-present
 * withdrawal fraction — decide whether a bad row reaches settle() or is
 * stopped. Reaching them through settleRace() alone would mean the DB's CHECK
 * constraints make some of them untestable, and an untested guard is a guess.
 */

function toSettlementBet(bet: SettleableBet): SettlementBet {
  return {
    type: bet.betType,
    unitStakeMinor: bet.unitStakeMinor,
    totalStakeMinor: bet.totalStakeMinor,
    oddsTaken: bet.oddsTaken,
  };
}

const RACE_STATUS_MAP: Record<string, SettlementRace["status"]> = {
  result: "RESULT",
  void: "VOID",
  abandoned: "ABANDONED",
  postponed: "POSTPONED",
};

export function toSettlementRace(race: SettlementRaceRow): SettlementRace {
  // Every withdrawn or non-running horse in the race, whether or not anyone
  // backed it — Rule 4 is a property of the race, not of the bet.
  const withdrawals: Withdrawal[] = race.runners
    .filter((r) => r.status === "withdrawn" || r.status === "non_runner")
    .map((r) => ({
      fraction:
        r.withdrawnAtFractionNum !== null && r.withdrawnAtFractionDen !== null
          ? { num: r.withdrawnAtFractionNum, den: r.withdrawnAtFractionDen }
          : null,
      runnerStatus: r.status as "withdrawn" | "non_runner",
    }));

  return {
    status: RACE_STATUS_MAP[race.status] ?? "UNDER_REVIEW",
    actualRunners: race.actualRunners,
    isHandicap: race.isHandicap,
    enhancedPlaces: race.enhancedPlaces,
    enhancedFractionDen: race.enhancedFraction,
    // 0 in the column means "nothing announced", which is NOT the same as an
    // announced deduction of zero. Null tells settle() to consult the band
    // table; 0 would tell it a deduction of zero was published (docs/08 D17).
    announcedRule4Pence: race.rule4Pence > 0 ? race.rule4Pence : null,
    withdrawals,
  };
}

const RUNNER_STATUS_MAP: Record<string, SettlementRunner["status"]> = {
  declared: "DECLARED",
  non_runner: "NON_RUNNER",
  withdrawn: "WITHDRAWN",
  reserve: "RESERVE",
};

export function toSettlementRunner(
  row: SettlementRaceRow["runners"][number],
): SettlementRunner {
  const status = RUNNER_STATUS_MAP[row.status];
  if (!status) {
    throw new Error(`unmapped runner status '${row.status}'`);
  }
  return {
    status,
    finishPosition: row.finishPosition,
    deadHeatCount: row.deadHeatCount,
    disqualified: row.disqualified,
  };
}
