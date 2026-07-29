import type { RegionCode } from "../../types";
import { deriveIsHandicap } from "./handicap";
import {
  localToIsoInstant,
  parseDistanceYards,
  parseFinishPosition,
  parseHorseName,
  parseStartingPrice,
  parseWeightLb,
} from "./parse";

/**
 * raceform (`docs/sources/datasets.md` §2.1) to the archive day-file format in
 * `src/modules/providers/archive/README.md`.
 *
 * Pure: rows in, day files out. No filesystem, no database. The CLI in
 * src/worker/import-raceform.ts does the I/O.
 *
 * **Every refusal is reported, never defaulted.** A race whose handicap status,
 * runner count or starting prices cannot be established is skipped with its
 * reason — `docs/08` D3, D14 and D17 in the same shape.
 *
 * By `docs/08` D20 the archive carries no non-runners, no withdrawals and no
 * Rule 4: every race is emitted with `rule4DeductionPence: 0` and every runner
 * as DECLARED. Rule 4 stays covered by tests/golden/published.json alone.
 */

/** One row of the raceform `data` table. Strings, as SQLite hands them over. */
export interface RaceformRow {
  date: string;
  course: string;
  race_id: string;
  off: string;
  race_name: string;
  type?: string | null;
  class?: string | null;
  age_band?: string | null;
  dist?: string | null;
  going?: string | null;
  ran: number | string;
  num?: number | string | null;
  pos?: string | null;
  draw?: number | string | null;
  sp?: string | null;
  horse: string;
  sex?: string | null;
  wgt?: string | null;
  jockey?: string | null;
  trainer?: string | null;
  or?: string | number | null;
}

export interface CourseInfo {
  region: RegionCode;
  timeZone: string;
}

/** course name -> region and IANA zone. Supplied by the operator, never guessed. */
export type CourseMap = Record<string, CourseInfo>;

export interface SkippedRace {
  raceId: string;
  course: string;
  date: string;
  reason: string;
}

export interface ImportResult {
  /** Keyed `<REGION>/<YYYY-MM-DD>`, the day-file path without the extension. */
  dayFiles: Map<string, DayFile>;
  skipped: SkippedRace[];
}

export interface DayFile {
  region: RegionCode;
  date: string;
  meetings: Array<Record<string, unknown>>;
}

const RACE_TYPE: Record<string, string> = {
  flat: "FLAT",
  hurdle: "HURDLE",
  chase: "CHASE",
  "nh flat": "NTF",
  bumper: "NTF",
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * Groups rows into day files.
 *
 * A race is emitted only if every settlement input resolves. The first failure
 * skips the whole race — a partially-understood race is more dangerous than an
 * absent one, because it looks complete.
 */
export function buildDayFiles(
  rows: readonly RaceformRow[],
  courses: CourseMap,
): ImportResult {
  const byRace = new Map<string, RaceformRow[]>();
  for (const row of rows) {
    const list = byRace.get(row.race_id);
    if (list) list.push(row);
    else byRace.set(row.race_id, [row]);
  }

  const dayFiles = new Map<string, DayFile>();
  const skipped: SkippedRace[] = [];

  for (const [raceId, raceRows] of byRace) {
    const head = raceRows[0];
    if (!head) continue;

    const skip = (reason: string): void => {
      skipped.push({ raceId, course: head.course, date: head.date, reason });
    };

    const course = courses[head.course];
    if (!course) {
      skip(
        `course '${head.course}' is not in the course map — add it with a region ` +
          `and IANA time zone, or the region and off time would be guesses`,
      );
      continue;
    }

    const handicap = deriveIsHandicap(head.race_name);
    if (!handicap.ok) {
      skip(`is_handicap: ${handicap.reason}`);
      continue;
    }

    const actualRunners = toInt(head.ran);
    if (actualRunners === null || actualRunners <= 0) {
      skip(`'ran' is '${String(head.ran)}' — the place-terms row cannot be selected`);
      continue;
    }

    const offTime = localToIsoInstant(head.date, head.off, course.timeZone);
    if (!offTime.ok) {
      skip(`off time: ${offTime.reason}`);
      continue;
    }

    const runners: Array<Record<string, unknown>> = [];
    const positions: Array<{ runnerId: string; position: number; disqualified: boolean }> = [];
    let failed: string | null = null;

    for (const [i, row] of raceRows.entries()) {
      const cloth = toInt(row.num) ?? i + 1;
      const sp = parseStartingPrice(row.sp);
      if (!sp.ok) {
        failed = `runner ${cloth}: ${sp.reason}`;
        break;
      }
      const pos = parseFinishPosition(row.pos);
      if (!pos.ok) {
        failed = `runner ${cloth}: ${pos.reason}`;
        break;
      }

      const horse = parseHorseName(row.horse);
      const runnerId = String(cloth);

      runners.push({
        id: runnerId,
        clothNumber: cloth,
        stallDraw: toInt(row.draw),
        horse: {
          name: horse.name,
          breedingSuffix: horse.breedingSuffix,
          foaledYear: null,
          sex: row.sex ?? null,
          sire: null,
          dam: null,
        },
        jockey: row.jockey ? { name: row.jockey } : null,
        trainer: row.trainer ? { name: row.trainer } : null,
        weightCarriedLb: parseWeightLb(row.wgt),
        officialRating: toInt(row.or),
        // D20: the archive carries no non-runners or withdrawals.
        status: "DECLARED",
        withdrawnAtOdds: null,
        startingPrice: sp.value,
      });

      if (pos.value.position !== null) {
        positions.push({
          runnerId,
          position: pos.value.position,
          disqualified: pos.value.disqualified,
        });
      }
    }

    if (failed) {
      skip(failed);
      continue;
    }
    if (positions.length === 0) {
      skip("no runner has a finishing position — nothing to settle against");
      continue;
    }

    // Dead heats are derived, not guessed: two runners sharing a finishing
    // position tied, by definition.
    const atPosition = new Map<number, string[]>();
    for (const p of positions) {
      const list = atPosition.get(p.position);
      if (list) list.push(p.runnerId);
      else atPosition.set(p.position, [p.runnerId]);
    }

    const key = `${course.region}/${head.date}`;
    let day = dayFiles.get(key);
    if (!day) {
      day = { region: course.region, date: head.date, meetings: [] };
      dayFiles.set(key, day);
    }

    const meetingRef = slug(head.course);
    let meeting = day.meetings.find((m) => m["meetingRef"] === meetingRef);
    if (!meeting) {
      meeting = {
        meetingRef,
        trackName: head.course.replace(/\s*\([^)]*\)\s*$/, "").trim(),
        countryCode: course.region === "IE" ? "IE" : "GB",
        timezone: course.timeZone,
        going: head.going ?? null,
        status: "COMPLETED",
        races: [],
      };
      day.meetings.push(meeting);
    }

    (meeting["races"] as Array<Record<string, unknown>>).push({
      raceId,
      name: head.race_name,
      offTime: offTime.value,
      distanceYards: parseDistanceYards(head.dist),
      raceClass: head.class ?? null,
      raceType: head.type ? (RACE_TYPE[head.type.trim().toLowerCase()] ?? null) : null,
      isHandicap: handicap.isHandicap,
      ageBand: head.age_band ?? null,
      prizeMinor: null,
      declaredRunners: raceRows.length,
      actualRunners,
      status: "RESULT",
      rule4DeductionPence: 0,
      runners,
      odds: null,
      result: {
        status: "RESULT",
        positions: positions.map((p) => ({
          runnerId: p.runnerId,
          position: p.position,
          deadHeatWith: (atPosition.get(p.position) ?? []).filter(
            (id) => id !== p.runnerId,
          ),
          disqualified: p.disqualified,
        })),
        nonRunners: [],
        rule4DeductionPence: 0,
        amendedAt: null,
      },
    });
  }

  return { dayFiles, skipped };
}
