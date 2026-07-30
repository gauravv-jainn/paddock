import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Executor } from "./read";
import { races, runners } from "./schema";

/**
 * The catalogue's settlement-facing read — the only sanctioned way the
 * settlement module gets at races and runners (`.claude/rules/modules.md`).
 *
 * Deliberately separate from the racecard read model. That one is display
 * shapes and says so; this one carries the four settlement inputs and the
 * Rule 4 fraction, and nothing cosmetic. Mixing them would eventually let a
 * display-shaped value reach settle().
 *
 * Every field is returned raw. No interpretation happens here — mapping to
 * settle()'s value types is the settlement module's job, because deciding what
 * a `withdrawn` runner with a null fraction means is a settlement rule
 * (docs/08 D17), not a catalogue concern.
 */

export interface SettlementRunnerRow {
  runnerId: string;
  clothNumber: number;
  status: string;
  finishPosition: number | null;
  deadHeatCount: number;
  disqualified: boolean;
  /** The sole Rule 4 lookup input (docs/08 D14). Null is NOT "no deduction". */
  withdrawnAtFractionNum: number | null;
  withdrawnAtFractionDen: number | null;
}

export interface SettlementRaceRow {
  raceId: string;
  status: string;
  resultVersion: number;
  /** SETTLEMENT INPUT. Runners that actually started. */
  actualRunners: number | null;
  /** SETTLEMENT INPUT. Selects the handicap column of the place-terms table. */
  isHandicap: boolean;
  /** docs/08 D18. Both or neither. */
  enhancedPlaces: number | null;
  enhancedFraction: number | null;
  /** An outright announced deduction, authoritative when non-zero. */
  rule4Pence: number;
  runners: SettlementRunnerRow[];
}

export async function getRaceForSettlement(
  raceId: string,
  tx?: Executor,
): Promise<SettlementRaceRow | null> {
  const db = tx ?? getDb();

  const raceRows = await db
    .select({
      raceId: races.id,
      status: races.status,
      resultVersion: races.resultVersion,
      actualRunners: races.actualRunners,
      isHandicap: races.isHandicap,
      enhancedPlaces: races.enhancedPlaces,
      enhancedFraction: races.enhancedFraction,
      rule4Pence: races.rule4Pence,
    })
    .from(races)
    .where(eq(races.id, raceId))
    .limit(1);

  const race = raceRows[0];
  if (!race) return null;

  const runnerRows = await db
    .select({
      runnerId: runners.id,
      clothNumber: runners.clothNumber,
      status: runners.status,
      finishPosition: runners.finishPosition,
      deadHeatCount: runners.deadHeatCount,
      disqualified: runners.disqualified,
      withdrawnAtFractionNum: runners.withdrawnAtFractionNum,
      withdrawnAtFractionDen: runners.withdrawnAtFractionDen,
    })
    .from(runners)
    .where(eq(runners.raceId, raceId))
    .orderBy(asc(runners.clothNumber));

  return { ...race, runners: runnerRows };
}
