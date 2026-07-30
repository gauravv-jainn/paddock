import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { horses, meetings, races, runners, tracks } from "./schema";
import type { Executor } from "./read";

/**
 * Human labels for runners — what a bet-history row needs to say which horse
 * in which race a bet was struck on.
 *
 * The betting module cannot join to `races` or `horses` itself
 * (`.claude/rules/modules.md`), so a page that shows both composes the two
 * services. This is the catalogue's half.
 */

export interface RunnerLabel {
  runnerId: string;
  horseName: string;
  clothNumber: number;
  raceId: string;
  raceName: string;
  offTime: Date;
  trackName: string;
  meetingDate: string;
  finishPosition: number | null;
  startingPrice: string | null;
}

export async function getRunnerLabels(
  runnerIds: string[],
  tx?: Executor,
): Promise<Map<string, RunnerLabel>> {
  if (runnerIds.length === 0) return new Map();

  const rows = await (tx ?? getDb())
    .select({
      runnerId: runners.id,
      horseName: horses.name,
      clothNumber: runners.clothNumber,
      raceId: races.id,
      raceName: races.name,
      offTime: races.offTime,
      trackName: tracks.name,
      meetingDate: meetings.date,
      finishPosition: runners.finishPosition,
      startingPrice: runners.startingPrice,
    })
    .from(runners)
    .innerJoin(horses, eq(horses.id, runners.horseId))
    .innerJoin(races, eq(races.id, runners.raceId))
    .innerJoin(meetings, eq(meetings.id, races.meetingId))
    .innerJoin(tracks, eq(tracks.id, meetings.trackId))
    .where(inArray(runners.id, runnerIds));

  return new Map(rows.map((r) => [r.runnerId, r]));
}
