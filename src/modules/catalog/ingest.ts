import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "@/db/client";
import type {
  HorseRef,
  IsoDate,
  PersonRef,
  RaceCard,
  RaceResult,
  RacingDataProvider,
  RegionCode,
  Runner,
} from "@/modules/providers";
import {
  datesInRange,
  meetingStatus,
  oddsToNumeric,
  raceStatus,
  raceType,
  runnerStatus,
} from "./mapping";
import { horses, meetings, people, races, runners, tracks } from "./schema";

export type Executor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface IngestOptions {
  provider: RacingDataProvider;
  /** Inclusive, YYYY-MM-DD. */
  from: IsoDate;
  to: IsoDate;
  regions: RegionCode[];
}

export interface IngestReport {
  daysRead: number;
  meetings: number;
  races: number;
  runners: number;
  results: number;
  /** Races the provider could not describe well enough to store. */
  skipped: Array<{ raceRef: string; reason: string }>;
}

function exec(tx?: Executor): Executor {
  return tx ?? getDb();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function upsertTrack(
  db: Executor,
  input: { name: string; countryCode: string; timezone: string },
): Promise<string> {
  const rows = await db
    .insert(tracks)
    .values(input)
    .onConflictDoUpdate({
      target: [tracks.name, tracks.countryCode],
      set: { timezone: input.timezone },
    })
    .returning({ id: tracks.id });

  const row = rows[0];
  if (!row) throw new Error(`failed to upsert track ${input.name}`);
  return row.id;
}

async function upsertHorse(db: Executor, horse: HorseRef): Promise<string> {
  const rows = await db
    .insert(horses)
    .values({
      name: horse.name,
      countryCode: horse.countryCode,
      foaledYear: horse.foaledYear,
      sex: horse.sex,
      sire: horse.sire,
      dam: horse.dam,
    })
    .onConflictDoUpdate({
      target: [horses.name, horses.countryCode, horses.foaledYear],
      set: { sex: horse.sex, sire: horse.sire, dam: horse.dam },
    })
    .returning({ id: horses.id });

  const row = rows[0];
  if (!row) throw new Error(`failed to upsert horse ${horse.name}`);
  return row.id;
}

async function upsertPerson(
  db: Executor,
  person: PersonRef | null,
  kind: "jockey" | "trainer",
): Promise<string | null> {
  if (!person) return null;

  const rows = await db
    .insert(people)
    .values({ name: person.name, kind })
    .onConflictDoUpdate({
      target: [people.name, people.kind],
      set: { name: person.name },
    })
    .returning({ id: people.id });

  const row = rows[0];
  if (!row) throw new Error(`failed to upsert ${kind} ${person.name}`);
  return row.id;
}

async function upsertMeeting(
  db: Executor,
  input: {
    trackId: string;
    date: IsoDate;
    going: string | null;
    status: string;
  },
): Promise<string> {
  const rows = await db
    .insert(meetings)
    .values(input)
    .onConflictDoUpdate({
      target: [meetings.trackId, meetings.date],
      set: { going: input.going, status: input.status },
    })
    .returning({ id: meetings.id });

  const row = rows[0];
  if (!row) throw new Error(`failed to upsert meeting ${input.date}`);
  return row.id;
}

async function upsertRace(
  db: Executor,
  providerId: string,
  meetingId: string,
  card: RaceCard,
): Promise<string> {
  const values = {
    meetingId,
    providerId,
    providerRef: card.raceRef,
    name: card.name,
    offTime: new Date(card.offTime),
    distanceYards: card.distanceYards,
    raceClass: card.raceClass,
    raceType: raceType(card.raceType),
    isHandicap: card.isHandicap,
    ageBand: card.ageBand,
    prizeMinor: card.prizeMinor,
    declaredRunners: card.declaredRunners,
    actualRunners: card.actualRunners,
    status: raceStatus(card.status),
    rule4Pence: card.rule4DeductionPence,
  };

  const rows = await db
    .insert(races)
    .values(values)
    .onConflictDoUpdate({
      target: [races.providerId, races.providerRef],
      set: values,
    })
    .returning({ id: races.id });

  const row = rows[0];
  if (!row) throw new Error(`failed to upsert race ${card.raceRef}`);
  return row.id;
}

async function upsertRunner(
  db: Executor,
  raceId: string,
  runner: Runner,
): Promise<void> {
  const horseId = await upsertHorse(db, runner.horse);
  const jockeyId = await upsertPerson(db, runner.jockey, "jockey");
  const trainerId = await upsertPerson(db, runner.trainer, "trainer");

  const values = {
    raceId,
    horseId,
    jockeyId,
    trainerId,
    clothNumber: runner.clothNumber,
    stallDraw: runner.stallDraw,
    weightLb: runner.weightCarriedLb,
    officialRating: runner.officialRating,
    status: runnerStatus(runner.status),
    withdrawnAtOdds: oddsToNumeric(runner.withdrawnAtOdds),
    startingPrice: oddsToNumeric(runner.startingPrice),
  };

  await db
    .insert(runners)
    .values(values)
    .onConflictDoUpdate({
      target: [runners.raceId, runners.clothNumber],
      set: values,
    });
}

/**
 * Applies a result to the runners already stored for the race.
 *
 * Finishing positions, the dead-heat count and disqualification all come
 * straight from the provider. Nothing is inferred: a runner the result does not
 * mention keeps whatever the racecard said.
 */
async function applyResult(
  db: Executor,
  raceId: string,
  providerRunnerToCloth: Map<string, number>,
  result: RaceResult,
): Promise<void> {
  for (const position of result.positions) {
    const cloth = providerRunnerToCloth.get(position.runnerId);
    if (cloth === undefined) continue;

    await db
      .update(runners)
      .set({
        finishPosition: position.position,
        deadHeatCount: 1 + position.deadHeatWith.length,
        disqualified: position.disqualified,
      })
      .where(and(eq(runners.raceId, raceId), eq(runners.clothNumber, cloth)));
  }

  for (const runnerId of result.nonRunners) {
    const cloth = providerRunnerToCloth.get(runnerId);
    if (cloth === undefined) continue;

    await db
      .update(runners)
      .set({ status: "non_runner" })
      .where(and(eq(runners.raceId, raceId), eq(runners.clothNumber, cloth)));
  }

  await db
    .update(races)
    .set({ rule4Pence: result.rule4DeductionPence })
    .where(eq(races.id, raceId));
}

/**
 * Reads a date range from a provider and writes it into the catalogue.
 *
 * Idempotent: every write is an upsert keyed on the natural key, so re-running
 * the same range produces the same rows.
 *
 * A race that cannot be described completely enough to store is skipped and
 * reported, never stored with a guessed value.
 */
export async function ingestRange(
  options: IngestOptions,
  tx?: Executor,
): Promise<IngestReport> {
  const { provider, from, to, regions } = options;
  const db = exec(tx);
  const report: IngestReport = {
    daysRead: 0,
    meetings: 0,
    races: 0,
    runners: 0,
    results: 0,
    skipped: [],
  };

  for (const region of regions) {
    // The capability, not a hardcoded list, decides whether this is allowed.
    if (!provider.capabilities.supportedRegions.includes(region)) {
      throw new Error(
        `provider '${provider.id}' does not supply region '${region}'`,
      );
    }
  }

  for (const date of datesInRange(from, to)) {
    for (const region of regions) {
      report.daysRead += 1;

      for (const meeting of await provider.listMeetings({ date, region })) {
        const trackId = await upsertTrack(db, {
          name: meeting.trackName,
          countryCode: meeting.countryCode,
          timezone: meeting.timezone,
        });
        const meetingId = await upsertMeeting(db, {
          trackId,
          date: meeting.date,
          going: meeting.going,
          status: meetingStatus(meeting.status),
        });
        report.meetings += 1;

        for (const summary of meeting.races) {
          try {
            const card = await provider.getRaceCard({
              raceRef: summary.raceRef,
            });
            const raceId = await upsertRace(db, provider.id, meetingId, card);
            report.races += 1;

            const clothByProviderId = new Map<string, number>();
            for (const runner of card.runners) {
              await upsertRunner(db, raceId, runner);
              clothByProviderId.set(runner.id, runner.clothNumber);
              report.runners += 1;
            }

            // A provider that does not supply official results is not asked
            // for them, rather than asked and quietly ignored.
            if (provider.capabilities.officialResults) {
              const result = await provider.getResult({
                raceRef: summary.raceRef,
              });
              if (result) {
                await applyResult(db, raceId, clothByProviderId, result);
                report.results += 1;
              }
            }
          } catch (error) {
            report.skipped.push({
              raceRef: summary.raceRef,
              reason: message(error),
            });
          }
        }
      }
    }
  }

  return report;
}
