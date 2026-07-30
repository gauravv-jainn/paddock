import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Betting module tables — docs/04 §6.
 *
 * Money is BIGINT minor units, GBP pence (docs/08 D1). Phase 0 carries only
 * WIN, PLACE and EACH_WAY; the wider CHECK from docs/04 §6 is kept so exotics
 * and multiples do not need a migration in P2, but nothing writes them.
 */

export const BET_TYPES = ["WIN", "PLACE", "EACH_WAY"] as const;
export const BET_STATUSES = [
  "open",
  "won",
  "lost",
  "void",
  "partial",
  "cancelled",
  "needs_review",
] as const;

export const bets = pgTable(
  "bets",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().notNull(),
    walletId: uuid().notNull(),
    /** Client-supplied. The unique index below is the whole idempotency story. */
    idempotencyKey: uuid().notNull(),
    betType: text().notNull(),
    /** Per part. EACH_WAY stakes this twice. */
    unitStakeMinor: bigint({ mode: "bigint" }).notNull(),
    totalStakeMinor: bigint({ mode: "bigint" }).notNull(),
    status: text().notNull().default("open"),
    placedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp({ withTimezone: true }),
    returnMinor: bigint({ mode: "bigint" })
      .notNull()
      .default(sql`0`),
    /** races.result_version this was settled against. Drives re-settlement. */
    settledVersion: integer(),
  },
  (t) => [
    check(
      "bets_bet_type_check",
      sql`${t.betType} in ('WIN','PLACE','EACH_WAY','SHOW','EXACTA','QUINELLA','TRIFECTA','SUPERFECTA','DOUBLE','TREBLE','ACCUMULATOR')`,
    ),
    check(
      "bets_status_check",
      sql`${t.status} in ('open','won','lost','void','partial','cancelled','needs_review')`,
    ),
    check("bets_unit_stake_positive", sql`${t.unitStakeMinor} > 0`),
    check("bets_total_stake_positive", sql`${t.totalStakeMinor} > 0`),
    // docs/03 §4: the idempotency guarantee is a unique index, not a lookup.
    // Two concurrent retries of the same request cannot both insert.
    unique("bets_user_id_idempotency_key_key").on(t.userId, t.idempotencyKey),
    index("bets_user_id_placed_at_idx").on(t.userId, t.placedAt.desc()),
    index("bets_open_idx").on(t.status).where(sql`status = 'open'`),
  ],
);

export const betLegs = pgTable(
  "bet_legs",
  {
    id: uuid().primaryKey().defaultRandom(),
    betId: uuid()
      .notNull()
      .references(() => bets.id, { onDelete: "cascade" }),
    legIndex: smallint().notNull(),
    raceId: uuid().notNull(),
    runnerId: uuid().notNull(),
    /** Exotics only. Null for Phase 0's three types. */
    finishSlot: smallint(),
    /** Frozen at placement. The bet settles at the price the user accepted. */
    oddsTaken: numeric({ precision: 10, scale: 3 }).notNull(),
    oddsFormat: text().notNull().default("decimal"),
    outcome: text().default("pending"),
  },
  (t) => [
    check(
      "bet_legs_outcome_check",
      sql`${t.outcome} is null or ${t.outcome} in ('pending','won','placed','lost','void')`,
    ),
    unique("bet_legs_bet_id_leg_index_key").on(t.betId, t.legIndex),
    // docs/04 §6: "the single most important index in the schema" — the query
    // the settlement worker runs for every finished race.
    index("bet_legs_race_id_pending_idx")
      .on(t.raceId)
      .where(sql`outcome = 'pending'`),
  ],
);

export type Bet = typeof bets.$inferSelect;
export type BetLeg = typeof betLegs.$inferSelect;
