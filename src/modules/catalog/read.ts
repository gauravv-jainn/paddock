import { aliasedTable, and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb, type Database } from "@/db/client";
import { horses, meetings, people, races, runners, tracks } from "./schema";

export type Executor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Racecard read model.
 *
 * Flat, denormalised shapes for display. Nothing here is a settlement input:
 * `isHandicap` and `actualRunners` are carried through for the reader's
 * benefit, and settlement reads them from the catalogue itself, never from a
 * value that passed through this layer.
 */

export interface MeetingListItem {
  meetingId: string;
  date: string;
  trackName: string;
  countryCode: string;
  going: string | null;
  status: string;
  races: Array<{
    raceId: string;
    name: string;
    offTime: Date;
    status: string;
    isHandicap: boolean;
    declaredRunners: number | null;
    actualRunners: number | null;
  }>;
}

export interface RacecardRunner {
  runnerId: string;
  clothNumber: number;
  stallDraw: number | null;
  horseName: string;
  horseCountryCode: string | null;
  jockeyName: string | null;
  trainerName: string | null;
  weightLb: number | null;
  officialRating: number | null;
  status: string;
  startingPrice: string | null;
  withdrawnAtOdds: string | null;
  finishPosition: number | null;
  deadHeatCount: number;
  disqualified: boolean;
}

export interface Racecard {
  raceId: string;
  name: string;
  offTime: Date;
  status: string;
  raceClass: string | null;
  raceType: string | null;
  distanceYards: number | null;
  ageBand: string | null;
  isHandicap: boolean;
  declaredRunners: number | null;
  actualRunners: number | null;
  rule4Pence: number;
  resultVersion: number;
  trackName: string;
  countryCode: string;
  going: string | null;
  meetingDate: string;
  runners: RacecardRunner[];
}

export async function listMeetings(
  options?: { from?: string; to?: string },
  tx?: Executor,
): Promise<MeetingListItem[]> {
  const db = tx ?? getDb();

  const conditions = [
    ...(options?.from ? [gte(meetings.date, options.from)] : []),
    ...(options?.to ? [lte(meetings.date, options.to)] : []),
  ];

  const rows = await db
    .select({
      meetingId: meetings.id,
      date: meetings.date,
      going: meetings.going,
      meetingStatus: meetings.status,
      trackName: tracks.name,
      countryCode: tracks.countryCode,
      raceId: races.id,
      raceName: races.name,
      offTime: races.offTime,
      raceStatus: races.status,
      isHandicap: races.isHandicap,
      declaredRunners: races.declaredRunners,
      actualRunners: races.actualRunners,
    })
    .from(meetings)
    .innerJoin(tracks, eq(tracks.id, meetings.trackId))
    .leftJoin(races, eq(races.meetingId, meetings.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(meetings.date), asc(tracks.name), asc(races.offTime));

  const byMeeting = new Map<string, MeetingListItem>();
  for (const row of rows) {
    let meeting = byMeeting.get(row.meetingId);
    if (!meeting) {
      meeting = {
        meetingId: row.meetingId,
        date: row.date,
        trackName: row.trackName,
        countryCode: row.countryCode,
        going: row.going,
        status: row.meetingStatus,
        races: [],
      };
      byMeeting.set(row.meetingId, meeting);
    }
    if (row.raceId && row.raceName && row.offTime && row.raceStatus) {
      meeting.races.push({
        raceId: row.raceId,
        name: row.raceName,
        offTime: row.offTime,
        status: row.raceStatus,
        isHandicap: row.isHandicap ?? false,
        declaredRunners: row.declaredRunners,
        actualRunners: row.actualRunners,
      });
    }
  }

  return [...byMeeting.values()];
}

export async function getRacecard(
  raceId: string,
  tx?: Executor,
): Promise<Racecard | null> {
  const db = tx ?? getDb();

  const raceRows = await db
    .select({
      raceId: races.id,
      name: races.name,
      offTime: races.offTime,
      status: races.status,
      raceClass: races.raceClass,
      raceType: races.raceType,
      distanceYards: races.distanceYards,
      ageBand: races.ageBand,
      isHandicap: races.isHandicap,
      declaredRunners: races.declaredRunners,
      actualRunners: races.actualRunners,
      rule4Pence: races.rule4Pence,
      resultVersion: races.resultVersion,
      trackName: tracks.name,
      countryCode: tracks.countryCode,
      going: meetings.going,
      meetingDate: meetings.date,
    })
    .from(races)
    .innerJoin(meetings, eq(meetings.id, races.meetingId))
    .innerJoin(tracks, eq(tracks.id, meetings.trackId))
    .where(eq(races.id, raceId))
    .limit(1);

  const race = raceRows[0];
  if (!race) return null;

  const jockeys = aliasedTable(people, "jockeys");
  const trainers = aliasedTable(people, "trainers");

  const runnerRows = await db
    .select({
      runnerId: runners.id,
      clothNumber: runners.clothNumber,
      stallDraw: runners.stallDraw,
      horseName: horses.name,
      horseCountryCode: horses.countryCode,
      jockeyName: jockeys.name,
      trainerName: trainers.name,
      weightLb: runners.weightLb,
      officialRating: runners.officialRating,
      status: runners.status,
      startingPrice: runners.startingPrice,
      withdrawnAtOdds: runners.withdrawnAtOdds,
      finishPosition: runners.finishPosition,
      deadHeatCount: runners.deadHeatCount,
      disqualified: runners.disqualified,
    })
    .from(runners)
    .innerJoin(horses, eq(horses.id, runners.horseId))
    .leftJoin(jockeys, eq(jockeys.id, runners.jockeyId))
    .leftJoin(trainers, eq(trainers.id, runners.trainerId))
    .where(eq(runners.raceId, raceId))
    .orderBy(asc(runners.clothNumber));

  return { ...race, runners: runnerRows };
}
