/**
 * Field parsers for the raceform dataset (`docs/sources/datasets.md`).
 *
 * The distinction that matters: a **settlement input** that cannot be parsed
 * REFUSES the race. A **decorative** field that cannot be parsed degrades to
 * null and the race still imports.
 *
 *   settlement inputs : starting price, finishing position, runner count,
 *                       is_handicap, dead-heat grouping
 *   decorative        : distance, weight, official rating, headgear, comment
 *
 * Getting a decorative field wrong costs a wrong number on a racecard. Getting
 * a settlement input wrong costs money, which is why one refuses and the other
 * shrugs.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const no = (reason: string): Parsed<never> => ({ ok: false, reason });

/**
 * Starting price, fractional to decimal. SETTLEMENT INPUT — refuses.
 *
 * Decimal = numerator/denominator + 1. "Evens" is 1/1, i.e. 2.0. A horse with
 * no SP (did not run, or the field is blank) is a legitimate null rather than a
 * failure, so that case returns ok(null).
 */
export function parseStartingPrice(raw: string | null | undefined): Parsed<number | null> {
  if (raw === null || raw === undefined) return ok(null);
  const s = raw.trim();
  if (s === "" || s === "-" || /^n\/?a$/i.test(s)) return ok(null);

  if (/^(evens?|evs)$/i.test(s)) return ok(2);

  const frac = /^(\d+)\s*[/-]\s*(\d+)$/.exec(s);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den === 0) return no(`starting price '${s}' has a zero denominator`);
    return ok(num / den + 1);
  }

  // Some exports carry an already-decimal price.
  const dec = /^\d+(\.\d+)?$/.exec(s);
  if (dec) {
    const v = Number(s);
    if (v <= 1) return no(`decimal starting price '${s}' must exceed 1`);
    return ok(v);
  }

  return no(`unparseable starting price '${s}'`);
}

/**
 * Finishing position. SETTLEMENT INPUT — but a non-finisher is not an error.
 *
 * `pos` carries codes as well as numbers: F fell, PU pulled up, UR unseated,
 * BD brought down, RR refused to race, SU slipped up, RO ran out, DSQ
 * disqualified. Only DSQ is a *result*; the rest simply did not finish.
 */
export interface Position {
  position: number | null;
  disqualified: boolean;
}

export function parseFinishPosition(raw: string | null | undefined): Parsed<Position> {
  if (raw === null || raw === undefined) return ok({ position: null, disqualified: false });
  const s = raw.trim().toUpperCase();
  if (s === "") return ok({ position: null, disqualified: false });

  if (s === "DSQ" || s === "DQ") return ok({ position: null, disqualified: true });
  if (["F", "PU", "UR", "BD", "RR", "SU", "RO", "REF", "VOI"].includes(s)) {
    return ok({ position: null, disqualified: false });
  }

  // "1", "2", or dead-heat notations like "1=" / "=1".
  const n = /^=?(\d+)=?$/.exec(s);
  if (n) {
    const v = Number(n[1]);
    if (v <= 0) return no(`finishing position '${raw}' must be positive`);
    return ok({ position: v, disqualified: false });
  }

  return no(`unparseable finishing position '${raw}'`);
}

/** Weight, stones-pounds to pounds. DECORATIVE — degrades to null. */
export function parseWeightLb(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(raw.trim());
  if (!m) return null;
  const stones = Number(m[1]);
  const pounds = Number(m[2]);
  if (pounds > 13) return null; // not a valid st-lb pair
  return stones * 14 + pounds;
}

/** Distance, "1m 2f 110y" to yards. DECORATIVE — degrades to null. */
export function parseDistanceYards(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const miles = /(\d+)\s*m/.exec(s);
  const furlongs = /(\d+)\s*f/.exec(s);
  const yards = /(\d+)\s*y/.exec(s);
  if (!miles && !furlongs && !yards) return null;
  return (
    (miles ? Number(miles[1]) * 1760 : 0) +
    (furlongs ? Number(furlongs[1]) * 220 : 0) +
    (yards ? Number(yards[1]) : 0)
  );
}

/**
 * Splits a breeding suffix off a horse name: "Charyn (IRE)" to
 * { name: "Charyn", breedingSuffix: "IRE" }. `docs/08` D6 — this is a breeding
 * suffix, not a country code.
 */
export function parseHorseName(raw: string): { name: string; breedingSuffix: string | null } {
  const m = /^(.*?)\s*\(([A-Z]{2,3})\)\s*$/.exec(raw.trim());
  if (!m) return { name: raw.trim(), breedingSuffix: null };
  return { name: (m[1] ?? "").trim(), breedingSuffix: m[2] ?? null };
}

/**
 * A local wall-clock date and time in an IANA zone, to an ISO instant.
 *
 * The dataset stores `date` and `off` as local time with no offset. Naively
 * pasting a "Z" on the end is wrong by an hour for half the year, and the
 * mapping is not constant — this is the same DST trap that made an earlier
 * test in this repo unable to detect a local-time implementation.
 */
export function localToIsoInstant(
  date: string,
  time: string,
  timeZone: string,
): Parsed<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return no(`bad date '${date}'`);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!t) return no(`bad off time '${time}'`);

  const hh = String(Number(t[1])).padStart(2, "0");
  const mm = t[2] as string;

  // Guess UTC, read back what that instant looks like in the target zone, and
  // correct by the difference. Two passes settle it either side of a
  // transition; a third would change nothing.
  let ms = Date.parse(`${date}T${hh}:${mm}:00Z`);
  if (Number.isNaN(ms)) return no(`bad date/time '${date} ${time}'`);

  for (let i = 0; i < 2; i += 1) {
    const seen = zonedParts(ms, timeZone);
    if (!seen) return no(`unknown time zone '${timeZone}'`);
    const target = Date.parse(`${date}T${hh}:${mm}:00Z`);
    const drift = target - seen;
    if (drift === 0) break;
    ms += drift;
  }

  return ok(new Date(ms).toISOString());
}

/** The instant `ms`, as it reads on a clock in `timeZone`, expressed as epoch-UTC. */
function zonedParts(ms: number, timeZone: string): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ms));
  } catch {
    return null;
  }
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return Date.parse(
    `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}Z`,
  );
}
