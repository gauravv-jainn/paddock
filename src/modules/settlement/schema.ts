import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Settlements — docs/04 §7. The settlement module owns this table.
 *
 * Two columns carry the weight:
 *
 * `calculation` is "the feature that ends disputes" (docs/04 §7) — the full
 * derivation settle() returned, stored verbatim. The settlement detail screen
 * renders it directly and recomputes nothing.
 *
 * `payload_hash` names the exact provider bytes the answer came from, so the
 * derivation can be replayed years later against the stored payload rather
 * than against whatever the feed serves then.
 */

export const SETTLEMENT_OUTCOMES = [
  "WON",
  "LOST",
  "VOID",
  "PARTIAL",
  "NEEDS_REVIEW",
] as const;

export const settlements = pgTable(
  "settlements",
  {
    id: uuid().primaryKey().defaultRandom(),
    betId: uuid().notNull(),
    raceId: uuid().notNull(),
    /** races.result_version this was computed against. */
    resultVersion: integer().notNull(),
    outcome: text().notNull(),
    returnMinor: bigint({ mode: "bigint" }).notNull(),
    calculation: jsonb().notNull(),
    /** sha256 of the provider result payload. */
    payloadHash: text().notNull(),
    /**
     * True on a row that reverses an earlier settlement after a stewards'
     * amendment. History is never mutated (docs/03 §5), so a re-settlement is
     * a reversal row plus a fresh settlement row, both retained.
     */
    isReversal: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "settlements_outcome_check",
      sql`${t.outcome} in ('WON','LOST','VOID','PARTIAL','NEEDS_REVIEW')`,
    ),
    check("settlements_return_non_negative", sql`${t.returnMinor} >= 0`),
    // docs/04 §7: "UNIQUE (bet_id, result_version) gives idempotent settlement
    // for free. Re-running the worker cannot double-pay." A reversal shares the
    // bet and the version it reverses, so is_reversal is part of the key.
    unique("settlements_bet_id_result_version_is_reversal_key").on(
      t.betId,
      t.resultVersion,
      t.isReversal,
    ),
    index("settlements_race_id_idx").on(t.raceId),
    index("settlements_needs_review_idx")
      .on(t.createdAt)
      .where(sql`outcome = 'NEEDS_REVIEW'`),
  ],
);

export type Settlement = typeof settlements.$inferSelect;
