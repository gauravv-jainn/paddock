import { sql } from "drizzle-orm";
import { getDb, type Executor } from "@/db/client";

/**
 * Phase 0 analytics — docs/02 P0-08.
 *
 * Owns no tables (`.claude/rules/modules.md`). Every figure is derived from
 * `bets` and `ledger_entries`, which means the numbers cannot drift from the
 * money: there is no analytics counter to fall out of step with the ledger.
 *
 * MONEY IS BIGINT PENCE throughout. Ratios — ROI, strike rate — are the only
 * floats here, they are computed from bigints at the very end, and they never
 * flow back into a monetary value.
 *
 * SAMPLE SIZE TRAVELS WITH EVERY RATIO. docs/02 §5: "a 200% ROI on four bets
 * is noise and the UI must not present it as a result." So `roi` is not a bare
 * number — it arrives with the count that produced it and a flag saying
 * whether that count clears the threshold. A caller cannot render the ratio
 * without having been handed the reason to qualify it.
 */

/**
 * Below this, a ratio is not reported as a result.
 *
 * 30 is a convention, not a derivation, and it is stated here rather than
 * buried in a component so that changing it is one edit and one decision.
 * docs/02 does not fix a number; it fixes the principle.
 */
export const MIN_SAMPLE_FOR_RATIO = 30;

export interface Ratio {
  /** Null when there is nothing to divide by — never 0 standing in for it. */
  value: number | null;
  sampleSize: number;
  /** False when sampleSize < MIN_SAMPLE_FOR_RATIO. */
  meaningful: boolean;
}

export interface PerformanceSummary {
  /** Bets that have been settled. Open bets are excluded from every figure. */
  settledBets: number;
  openBets: number;
  stakedMinor: bigint;
  returnedMinor: bigint;
  /** returned - staked. Negative is a loss and is not clamped. */
  profitMinor: bigint;
  roi: Ratio;
  strikeRate: Ratio;
  /** Decimal odds, stake-weighted. Null when nothing has been staked. */
  averageOddsTaken: number | null;
  wins: number;
  places: number;
  losses: number;
  voids: number;
  needsReview: number;
  balanceMinor: bigint;
}

export interface EquityPoint {
  at: Date;
  /** Running balance in pence, after this entry. */
  balanceMinor: bigint;
  /** Signed movement that produced it. */
  deltaMinor: bigint;
  entryType: string;
  betId: string | null;
}

function ratio(numerator: bigint, denominator: bigint, sampleSize: number): Ratio {
  if (denominator === 0n) {
    return { value: null, sampleSize, meaningful: false };
  }
  // The single float conversion, at the end, on a value that is already final.
  const value = Number(numerator) / Number(denominator);
  return { value, sampleSize, meaningful: sampleSize >= MIN_SAMPLE_FOR_RATIO };
}

/**
 * Headline figures for one user.
 *
 * Stakes and returns come from the LEDGER, not from `bets.total_stake_minor`.
 * The ledger is authoritative (docs/04 §1); `bets` carries a derived cache of
 * the same numbers, and reading the cache here would mean a reconciliation bug
 * could never show up in the analytics that would reveal it.
 */
export async function getPerformanceSummary(
  userId: string,
  tx?: Executor,
): Promise<PerformanceSummary> {
  const db = tx ?? getDb();

  const [money] = await db.execute<{
    staked: string;
    returned: string;
    balance: string;
  }>(sql`
    SELECT
      COALESCE(-SUM(le.amount_minor) FILTER (WHERE le.entry_type = 'STAKE'), 0)::text
        AS staked,
      COALESCE(SUM(le.amount_minor)
               FILTER (WHERE le.entry_type IN ('RETURN','REFUND','REVERSAL')), 0)::text
        AS returned,
      COALESCE(SUM(le.amount_minor), 0)::text AS balance
      FROM ledger_entries le
      JOIN wallets w ON w.id = le.wallet_id
     WHERE w.user_id = ${userId}::uuid AND w.kind = 'user'
  `);

  const [counts] = await db.execute<{
    settled: string;
    open: string;
    wins: string;
    places: string;
    losses: string;
    voids: string;
    needs_review: string;
    odds_weighted: string | null;
    stake_total: string;
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE b.status IN ('won','lost','void','partial'))::text AS settled,
      COUNT(*) FILTER (WHERE b.status = 'open')::text          AS open,
      COUNT(*) FILTER (WHERE b.status = 'won')::text           AS wins,
      COUNT(*) FILTER (WHERE b.status = 'partial')::text       AS places,
      COUNT(*) FILTER (WHERE b.status = 'lost')::text          AS losses,
      COUNT(*) FILTER (WHERE b.status = 'void')::text          AS voids,
      COUNT(*) FILTER (WHERE b.status = 'needs_review')::text  AS needs_review,
      SUM(bl.odds_taken * b.total_stake_minor)::text           AS odds_weighted,
      COALESCE(SUM(b.total_stake_minor), 0)::text              AS stake_total
      FROM bets b
      JOIN bet_legs bl ON bl.bet_id = b.id
     WHERE b.user_id = ${userId}::uuid
  `);

  const stakedMinor = BigInt(money!.staked);
  const returnedMinor = BigInt(money!.returned);
  const profitMinor = returnedMinor - stakedMinor;

  const settledBets = Number(counts!.settled);
  const wins = Number(counts!.wins);
  const places = Number(counts!.places);

  // A void is not a loss and not a win — it did not happen. Excluding it from
  // the strike-rate denominator is why the two counts differ.
  const decidedBets = settledBets - Number(counts!.voids);

  const stakeTotal = BigInt(counts!.stake_total);
  const averageOddsTaken =
    counts!.odds_weighted === null || stakeTotal === 0n
      ? null
      : Number(counts!.odds_weighted) / Number(stakeTotal);

  return {
    settledBets,
    openBets: Number(counts!.open),
    stakedMinor,
    returnedMinor,
    profitMinor,
    roi: ratio(profitMinor, stakedMinor, settledBets),
    strikeRate: ratio(BigInt(wins + places), BigInt(Math.max(decidedBets, 0)), decidedBets),
    averageOddsTaken,
    wins,
    places,
    losses: Number(counts!.losses),
    voids: Number(counts!.voids),
    needsReview: Number(counts!.needs_review),
    balanceMinor: BigInt(money!.balance),
  };
}

/**
 * The equity curve — the running balance, one point per ledger entry.
 *
 * Built by replaying the ledger in order rather than by sampling a stored
 * balance, so the curve is the account's actual history and cannot disagree
 * with it. docs/02 §5: "the equity curve cannot lie."
 */
export async function getEquityCurve(
  userId: string,
  options: { limit?: number } = {},
  tx?: Executor,
): Promise<EquityPoint[]> {
  const rows = await (tx ?? getDb()).execute<{
    // A raw execute() bypasses drizzle's column parsing, so a TIMESTAMPTZ
    // arrives as whatever the driver produced — not necessarily a Date. It is
    // normalised below rather than trusted, because the declared return type
    // promising a Date and the value being a string is exactly the kind of lie
    // that survives typecheck and fails at runtime.
    created_at: Date | string;
    amount_minor: string;
    running: string;
    entry_type: string;
    ref_id: string | null;
  }>(sql`
    SELECT le.created_at,
           le.amount_minor::text,
           SUM(le.amount_minor) OVER (ORDER BY le.created_at, le.id)::text AS running,
           le.entry_type,
           CASE WHEN le.ref_type = 'bet' THEN le.ref_id::text ELSE NULL END AS ref_id
      FROM ledger_entries le
      JOIN wallets w ON w.id = le.wallet_id
     WHERE w.user_id = ${userId}::uuid AND w.kind = 'user'
     ORDER BY le.created_at, le.id
     LIMIT ${options.limit ?? 5000}
  `);

  return rows.map((r) => ({
    at: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    balanceMinor: BigInt(r.running),
    deltaMinor: BigInt(r.amount_minor),
    entryType: r.entry_type,
    betId: r.ref_id,
  }));
}
