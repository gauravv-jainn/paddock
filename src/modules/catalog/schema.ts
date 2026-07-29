import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
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
 * Racing catalogue — docs/04 §4.
 *
 * Two columns here are settlement inputs rather than metadata:
 * `races.is_handicap` and `races.actual_runners`. Together they determine
 * each-way place terms (docs/05 §4). See the notes on each below and the S4
 * assumptions in SESSIONS.md's report.
 *
 * Odds time series (docs/04 §5) is deliberately not here: it is not part of §4,
 * and no module has been assigned ownership of it yet.
 */

export const RACE_TYPES = ["flat", "hurdle", "chase", "ntf", "harness"] as const;
export const RACE_STATUSES = [
  "scheduled",
  "open",
  "suspended",
  "off",
  "result",
  "void",
  "abandoned",
  "postponed",
] as const;
export const RUNNER_STATUSES = [
  "declared",
  "non_runner",
  "withdrawn",
  "reserve",
] as const;
export const MEETING_STATUSES = [
  "scheduled",
  "inprogress",
  "completed",
  "abandoned",
] as const;
export const SURFACES = ["turf", "dirt", "aw", "sand", "snow"] as const;
export const PERSON_KINDS = ["jockey", "trainer", "owner"] as const;

export const tracks = pgTable(
  "tracks",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    countryCode: char({ length: 2 }).notNull(),
    surface: text(),
    /** IANA zone, e.g. 'Europe/London'. Off times are TIMESTAMPTZ regardless. */
    timezone: text().notNull(),
  },
  (t) => [
    check(
      "tracks_surface_check",
      sql`${t.surface} is null or ${t.surface} in ('turf','dirt','aw','sand','snow')`,
    ),
    unique("tracks_name_country_code_key").on(t.name, t.countryCode),
  ],
);

export const horses = pgTable(
  "horses",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    /** Breeding suffix, e.g. 'IRE', 'USA'. Three characters, unlike tracks. */
    countryCode: char({ length: 3 }),
    foaledYear: smallint(),
    sex: text(),
    sire: text(),
    dam: text(),
  },
  (t) => [
    // NULLS NOT DISTINCT is a deliberate addition to docs/04 §4. Two of the
    // three key columns are nullable, and under Postgres' default NULLS
    // DISTINCT a horse with no breeding suffix or no foaling year would insert
    // a fresh row on every ingestion run instead of matching the existing one.
    unique("horses_name_country_code_foaled_year_key")
      .on(t.name, t.countryCode, t.foaledYear)
      .nullsNotDistinct(),
  ],
);

export const people = pgTable(
  "people",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    kind: text().notNull(),
  },
  (t) => [
    check("people_kind_check", sql`${t.kind} in ('jockey','trainer','owner')`),
    unique("people_name_kind_key").on(t.name, t.kind),
  ],
);

export const meetings = pgTable(
  "meetings",
  {
    id: uuid().primaryKey().defaultRandom(),
    trackId: uuid()
      .notNull()
      .references(() => tracks.id),
    date: date().notNull(),
    going: text(),
    status: text().notNull().default("scheduled"),
  },
  (t) => [
    check(
      "meetings_status_check",
      sql`${t.status} in ('scheduled','inprogress','completed','abandoned')`,
    ),
    unique("meetings_track_id_date_key").on(t.trackId, t.date),
  ],
);

export const races = pgTable(
  "races",
  {
    id: uuid().primaryKey().defaultRandom(),
    meetingId: uuid()
      .notNull()
      .references(() => meetings.id),
    /** The provider's own identifier for this race. */
    providerRef: text().notNull(),
    /** Which provider supplied it, e.g. 'archive'. */
    providerId: text().notNull(),
    name: text().notNull(),
    offTime: timestamp({ withTimezone: true }).notNull(),
    distanceYards: integer(),
    raceClass: text(),
    raceType: text(),
    /**
     * SETTLEMENT INPUT. Selects the handicap or non-handicap column of the
     * place-terms table.
     *
     * DEFAULT FALSE is carried over from docs/04 §4 and is a hazard: a race
     * whose handicap status the feed did not supply silently becomes
     * non-handicap, which pays fewer places on some field sizes. The archive
     * adapter therefore refuses a racecard that does not state it explicitly,
     * so the default is never the reason a row has a value.
     */
    isHandicap: boolean().notNull().default(false),
    ageBand: text(),
    prizeMinor: bigint({ mode: "bigint" }),
    /** Count at declaration. Not a settlement input. */
    declaredRunners: smallint(),
    /**
     * SETTLEMENT INPUT. Runners that actually started, after non-runners.
     * Selects the row of the place-terms table.
     *
     * Nullable per docs/04 §4, which means it can be absent at settlement time.
     * The check constraint below closes that hole for the only state that
     * matters: a race cannot reach 'result' without it.
     */
    actualRunners: smallint(),
    status: text().notNull().default("scheduled"),
    /** Increments on a stewards' amendment; drives re-settlement. */
    resultVersion: integer().notNull().default(0),
    rule4Pence: smallint().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "races_race_type_check",
      sql`${t.raceType} is null or ${t.raceType} in ('flat','hurdle','chase','ntf','harness')`,
    ),
    check(
      "races_status_check",
      sql`${t.status} in ('scheduled','open','suspended','off','result','void','abandoned','postponed')`,
    ),
    check("races_rule4_pence_check", sql`${t.rule4Pence} between 0 and 90`),
    // Deliberate addition to docs/04 §4. Without it a race can carry
    // status='result' and a null actual_runners, and each-way settlement has
    // no place-terms row to look up.
    check(
      "races_result_requires_actual_runners",
      sql`${t.status} <> 'result' or ${t.actualRunners} is not null`,
    ),
    unique("races_provider_id_provider_ref_key").on(t.providerId, t.providerRef),
    index("races_off_time_idx").on(t.offTime),
    index("races_status_off_time_idx")
      .on(t.status, t.offTime)
      .where(sql`status in ('open','suspended','off')`),
  ],
);

export const runners = pgTable(
  "runners",
  {
    id: uuid().primaryKey().defaultRandom(),
    raceId: uuid()
      .notNull()
      .references(() => races.id, { onDelete: "cascade" }),
    horseId: uuid()
      .notNull()
      .references(() => horses.id),
    jockeyId: uuid().references(() => people.id),
    trainerId: uuid().references(() => people.id),
    clothNumber: smallint().notNull(),
    stallDraw: smallint(),
    weightLb: smallint(),
    officialRating: smallint(),
    status: text().notNull().default("declared"),
    /** SETTLEMENT INPUT. Required to compute a Rule 4 deduction. */
    withdrawnAtOdds: numeric({ precision: 10, scale: 3 }),
    startingPrice: numeric({ precision: 10, scale: 3 }),
    finishPosition: smallint(),
    /** 1 = clean finish, 2 = two-way dead heat, 3 = three-way, and so on. */
    deadHeatCount: smallint().notNull().default(1),
    disqualified: boolean().notNull().default(false),
  },
  (t) => [
    check(
      "runners_status_check",
      sql`${t.status} in ('declared','non_runner','withdrawn','reserve')`,
    ),
    check("runners_dead_heat_count_check", sql`${t.deadHeatCount} >= 1`),
    unique("runners_race_id_cloth_number_key").on(t.raceId, t.clothNumber),
    index("runners_race_id_finish_position_idx").on(t.raceId, t.finishPosition),
    index("runners_horse_id_idx").on(t.horseId),
  ],
);

export type Track = typeof tracks.$inferSelect;
export type Horse = typeof horses.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type Race = typeof races.$inferSelect;
export type Runner = typeof runners.$inferSelect;
