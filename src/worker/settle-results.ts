import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { persistPayload } from "@/modules/providers";
import { settleRace, type SettleRaceReport } from "@/modules/settlement";

/**
 * The settlement job — docs/03 §5, the whole pipeline in order.
 *
 *   result published
 *     ├─ persist raw payload + sha256          ← BEFORE normalising
 *     ├─ normalise
 *     └─ settle_race(raceId, resultVersion)
 *
 * Phase 0 is historical replay, so "result published" means "a race in the
 * archive reached status='result' and has bets standing against it". There is
 * no polling loop and no webhook because there is no live feed (docs/08 D20);
 * when one arrives it replaces `findRacesAwaitingSettlement` and nothing else.
 */

export interface SettlementRunReport {
  racesConsidered: number;
  racesSettled: number;
  betsSettled: number;
  betsResettled: number;
  betsNeedingReview: number;
  reports: SettleRaceReport[];
}

/**
 * Races with at least one bet whose settled version is behind the race's.
 *
 * Covers first settlement (`settled_version IS NULL`) and re-settlement after
 * a stewards' amendment (`settled_version < result_version`) in one query, so
 * an amended race cannot be missed by a job that only looks for open bets.
 */
async function findRacesAwaitingSettlement(limit: number): Promise<string[]> {
  const rows = await getDb().execute<{ race_id: string }>(sql`
    SELECT DISTINCT bl.race_id
      FROM bet_legs bl
      JOIN bets b ON b.id = bl.bet_id
      JOIN races r ON r.id = bl.race_id
     WHERE r.status IN ('result', 'void', 'abandoned')
       AND (b.settled_version IS NULL OR b.settled_version < r.result_version)
     LIMIT ${limit}
  `);
  return rows.map((r) => r.race_id);
}

/**
 * The payload behind a replayed archive result.
 *
 * Phase 0 settles from the local archive, which the ingestion step already
 * wrote to the catalogue. Persisting the normalised result here — rather than
 * fabricating a provider response that never existed — keeps the hash honest:
 * it is the sha256 of exactly the values settle() was given, and replaying it
 * reproduces the same answer.
 *
 * This is the one place the phase's constraint shows. With a live feed the raw
 * provider body is persisted instead, at the moment it is fetched, and this
 * function goes away.
 */
async function persistResultSnapshot(raceId: string): Promise<string> {
  const rows = await getDb().execute<Record<string, unknown>>(sql`
    SELECT r.id::text          AS race_id,
           r.result_version    AS result_version,
           r.status            AS status,
           r.actual_runners    AS actual_runners,
           r.is_handicap       AS is_handicap,
           r.rule4_pence       AS rule4_pence,
           ru.cloth_number     AS cloth_number,
           ru.status           AS runner_status,
           ru.finish_position  AS finish_position,
           ru.dead_heat_count  AS dead_heat_count,
           ru.disqualified     AS disqualified,
           ru.withdrawn_at_fraction_num AS wd_num,
           ru.withdrawn_at_fraction_den AS wd_den
      FROM races r
      JOIN runners ru ON ru.race_id = r.id
     WHERE r.id = ${raceId}::uuid
     ORDER BY ru.cloth_number
  `);

  const persisted = await persistPayload({
    providerId: "archive",
    kind: "result",
    entityRef: raceId,
    body: { source: "local archive replay", rows },
  });
  return persisted.bodySha256;
}

export async function runSettlementPass(
  options: { limit?: number } = {},
): Promise<SettlementRunReport> {
  const raceIds = await findRacesAwaitingSettlement(options.limit ?? 100);

  const run: SettlementRunReport = {
    racesConsidered: raceIds.length,
    racesSettled: 0,
    betsSettled: 0,
    betsResettled: 0,
    betsNeedingReview: 0,
    reports: [],
  };

  for (const raceId of raceIds) {
    const payloadHash = await persistResultSnapshot(raceId);
    const outcome = await settleRace(raceId, payloadHash);

    if (outcome.kind === "REFUSED") {
      // Not fatal to the pass. One unsettleable race must not stop the others.
      console.warn(`race ${raceId}: ${outcome.reason} — ${outcome.detail}`);
      continue;
    }

    run.racesSettled += 1;
    run.betsSettled += outcome.report.settled;
    run.betsResettled += outcome.report.resettled;
    run.betsNeedingReview += outcome.report.needsReview;
    run.reports.push(outcome.report);
  }

  return run;
}
