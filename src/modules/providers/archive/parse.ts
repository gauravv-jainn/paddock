import { ProviderPayloadError } from "../errors";
import type {
  HorseRef,
  MeetingStatus,
  MoneyMinor,
  OddsPrice,
  PersonRef,
  RaceResult,
  RaceStatus,
  RaceType,
  RegionCode,
  Runner,
} from "../types";

/**
 * Hand-written validation for archive payloads.
 *
 * Archive files are untrusted input: they are assembled by hand from
 * historical sources. Every field is checked and a missing one is a hard
 * failure — nothing is defaulted, inferred or filled in with a plausible
 * value.
 *
 * (docs/03 §3 nominates Zod for boundary validation. That is a dependency this
 * session was not authorised to add, so the checks are explicit here. Swapping
 * this file for Zod schemas is a mechanical change.)
 */

const PROVIDER_ID = "archive" as const;

function fail(path: string, detail: string): never {
  throw new ProviderPayloadError(PROVIDER_ID, path, detail);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(path, `expected an array, got ${describe(value)}`);
  }
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, `expected a non-empty string, got ${describe(value)}`);
  }
  return value;
}

function nullableStr(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return str(value, path);
}

function int(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(path, `expected an integer, got ${describe(value)}`);
  }
  return value;
}

function nullableInt(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  return int(value, path);
}

/** Odds are decimal numbers and are multipliers only — they never hold money. */
function nullableOdds(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 1) {
    fail(path, `expected a decimal price greater than 1, got ${describe(value)}`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, `expected a boolean, got ${describe(value)}`);
  }
  return value;
}

/** Money arrives as a decimal string so no float ever touches it. */
function nullableMoneyMinor(value: unknown, path: string): MoneyMinor | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
    fail(
      path,
      `expected minor units as a digit string (money is never a JSON number), got ${describe(value)}`,
    );
  }
  return BigInt(value);
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  const s = str(value, path);
  if (!(allowed as readonly string[]).includes(s)) {
    fail(path, `expected one of ${allowed.join(", ")}, got '${s}'`);
  }
  return s as T;
}

function nullableOneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T | null {
  if (value === null || value === undefined) return null;
  return oneOf(value, path, allowed);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(value: unknown, path: string): string {
  const s = str(value, path);
  if (!ISO_DATE.test(s) || Number.isNaN(Date.parse(s))) {
    fail(path, `expected a YYYY-MM-DD date, got '${s}'`);
  }
  return s;
}

function isoInstant(value: unknown, path: string): string {
  const s = str(value, path);
  if (Number.isNaN(Date.parse(s))) {
    fail(path, `expected an ISO-8601 instant, got '${s}'`);
  }
  return s;
}

function nullableIsoInstant(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return isoInstant(value, path);
}

export const REGION_CODES = ["GB", "IE"] as const;
const MEETING_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "ABANDONED",
] as const satisfies readonly MeetingStatus[];
const RACE_STATUSES = [
  "SCHEDULED",
  "OPEN",
  "SUSPENDED",
  "OFF",
  "RESULT",
  "VOID",
  "ABANDONED",
  "POSTPONED",
] as const satisfies readonly RaceStatus[];
const RACE_TYPES = [
  "FLAT",
  "HURDLE",
  "CHASE",
  "NTF",
  "HARNESS",
] as const satisfies readonly RaceType[];
const RUNNER_STATUSES = [
  "DECLARED",
  "NON_RUNNER",
  "WITHDRAWN",
  "RESERVE",
] as const;
const RESULT_STATUSES = [
  "RESULT",
  "VOID",
  "ABANDONED",
  "POSTPONED",
  "UNDER_REVIEW",
] as const;
const MARKET_TYPES = ["WIN", "PLACE", "EACH_WAY"] as const;

function rule4Pence(value: unknown, path: string): number {
  const n = int(value, path);
  if (n < 0 || n > 90) {
    fail(path, `Rule 4 deduction must be 0-90 pence, got ${n}`);
  }
  return n;
}

function horse(value: unknown, path: string): HorseRef {
  const o = object(value, path);
  return {
    name: str(o["name"], `${path}.name`),
    countryCode: nullableStr(o["countryCode"], `${path}.countryCode`),
    foaledYear: nullableInt(o["foaledYear"], `${path}.foaledYear`),
    sex: nullableStr(o["sex"], `${path}.sex`),
    sire: nullableStr(o["sire"], `${path}.sire`),
    dam: nullableStr(o["dam"], `${path}.dam`),
  };
}

function person(value: unknown, path: string): PersonRef | null {
  if (value === null || value === undefined) return null;
  const o = object(value, path);
  return { name: str(o["name"], `${path}.name`) };
}

export function parseRunner(
  value: unknown,
  path: string,
  raceId: string,
): Runner {
  const o = object(value, path);
  const status = oneOf(o["status"], `${path}.status`, RUNNER_STATUSES);
  const withdrawnAtOdds = nullableOdds(
    o["withdrawnAtOdds"],
    `${path}.withdrawnAtOdds`,
  );

  // Rule 4 is computed from the price the withdrawn horse was trading at. A
  // withdrawal without that price cannot be settled, so it is rejected here
  // rather than producing a silently wrong deduction later.
  if (status === "WITHDRAWN" && withdrawnAtOdds === null) {
    fail(
      `${path}.withdrawnAtOdds`,
      "a WITHDRAWN runner must carry the price it was withdrawn at (Rule 4 input)",
    );
  }

  return {
    id: str(o["id"], `${path}.id`),
    raceId,
    clothNumber: int(o["clothNumber"], `${path}.clothNumber`),
    stallDraw: nullableInt(o["stallDraw"], `${path}.stallDraw`),
    horse: horse(o["horse"], `${path}.horse`),
    jockey: person(o["jockey"], `${path}.jockey`),
    trainer: person(o["trainer"], `${path}.trainer`),
    weightCarriedLb: nullableInt(
      o["weightCarriedLb"],
      `${path}.weightCarriedLb`,
    ),
    officialRating: nullableInt(o["officialRating"], `${path}.officialRating`),
    status,
    withdrawnAtOdds,
    startingPrice: nullableOdds(o["startingPrice"], `${path}.startingPrice`),
  };
}

export function parseResult(
  value: unknown,
  path: string,
  raceId: string,
  payloadHash: string,
): RaceResult {
  const o = object(value, path);
  const positions = array(o["positions"], `${path}.positions`).map(
    (entry, i) => {
      const p = object(entry, `${path}.positions[${i}]`);
      return {
        runnerId: str(p["runnerId"], `${path}.positions[${i}].runnerId`),
        position: int(p["position"], `${path}.positions[${i}].position`),
        deadHeatWith: array(
          p["deadHeatWith"] ?? [],
          `${path}.positions[${i}].deadHeatWith`,
        ).map((r, j) =>
          str(r, `${path}.positions[${i}].deadHeatWith[${j}]`),
        ),
        disqualified: bool(
          p["disqualified"],
          `${path}.positions[${i}].disqualified`,
        ),
      };
    },
  );

  return {
    raceId,
    status: oneOf(o["status"], `${path}.status`, RESULT_STATUSES),
    positions,
    nonRunners: array(o["nonRunners"] ?? [], `${path}.nonRunners`).map((r, i) =>
      str(r, `${path}.nonRunners[${i}]`),
    ),
    rule4DeductionPence: rule4Pence(
      o["rule4DeductionPence"],
      `${path}.rule4DeductionPence`,
    ),
    amendedAt: nullableIsoInstant(o["amendedAt"], `${path}.amendedAt`),
    providerPayloadHash: payloadHash,
  };
}

export function parseOddsPrices(value: unknown, path: string): OddsPrice[] {
  return array(value, path).map((entry, i) => {
    const o = object(entry, `${path}[${i}]`);
    const price = nullableOdds(o["priceDecimal"], `${path}[${i}].priceDecimal`);
    if (price === null) {
      fail(`${path}[${i}].priceDecimal`, "a price is required");
    }
    return {
      runnerId: str(o["runnerId"], `${path}[${i}].runnerId`),
      marketType: oneOf(o["marketType"], `${path}[${i}].marketType`, MARKET_TYPES),
      priceDecimal: price,
    };
  });
}

export const parse = {
  object,
  array,
  str,
  nullableStr,
  int,
  nullableInt,
  bool,
  nullableMoneyMinor,
  oneOf,
  nullableOneOf,
  isoDate,
  isoInstant,
  rule4Pence,
  fail,
  MEETING_STATUSES,
  RACE_STATUSES,
  RACE_TYPES,
  REGION_CODES,
};

export type { RegionCode };
