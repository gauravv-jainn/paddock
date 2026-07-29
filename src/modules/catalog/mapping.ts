import type {
  MeetingStatus,
  RaceStatus,
  RaceType,
  Runner,
} from "@/modules/providers";

/**
 * Canonical provider vocabulary to catalogue column values.
 *
 * The domain model uses SCREAMING_CASE; docs/04 §4 uses lower_snake CHECK
 * values. This file is the only place that knows both.
 */

const MEETING_STATUS: Record<MeetingStatus, string> = {
  SCHEDULED: "scheduled",
  IN_PROGRESS: "inprogress",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
};

const RACE_STATUS: Record<RaceStatus, string> = {
  SCHEDULED: "scheduled",
  OPEN: "open",
  SUSPENDED: "suspended",
  OFF: "off",
  RESULT: "result",
  VOID: "void",
  ABANDONED: "abandoned",
  POSTPONED: "postponed",
};

const RACE_TYPE: Record<RaceType, string> = {
  FLAT: "flat",
  HURDLE: "hurdle",
  CHASE: "chase",
  NTF: "ntf",
  HARNESS: "harness",
};

const RUNNER_STATUS: Record<Runner["status"], string> = {
  DECLARED: "declared",
  NON_RUNNER: "non_runner",
  WITHDRAWN: "withdrawn",
  RESERVE: "reserve",
};

export function meetingStatus(status: MeetingStatus): string {
  return MEETING_STATUS[status];
}

export function raceStatus(status: RaceStatus): string {
  return RACE_STATUS[status];
}

export function raceType(type: RaceType | null): string | null {
  return type === null ? null : RACE_TYPE[type];
}

export function runnerStatus(status: Runner["status"]): string {
  return RUNNER_STATUS[status];
}

/**
 * NUMERIC(10,3) columns are read and written as strings by Drizzle, which is
 * what we want: odds never round-trip through a float on their way to storage.
 */
export function oddsToNumeric(odds: number | null): string | null {
  return odds === null ? null : odds.toFixed(3);
}

/** Every date in [from, to], inclusive, as YYYY-MM-DD. */
export function datesInRange(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new RangeError(`invalid date range ${from}..${to}`);
  }
  if (end < start) {
    throw new RangeError(`date range ends before it starts: ${from}..${to}`);
  }

  const dates: string[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (let t = start; t <= end; t += DAY_MS) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}
