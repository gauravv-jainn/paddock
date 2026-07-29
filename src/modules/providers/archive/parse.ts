import { z } from "zod";
import { ProviderPayloadError } from "../errors";
import type { RaceResult, RegionCode, Runner } from "../types";

/**
 * Zod schemas for archive payloads (docs/08 D7).
 *
 * Archive files are untrusted input: they are assembled by hand from
 * historical sources. Every field is checked and a missing one is a hard
 * failure — nothing is defaulted, inferred, or filled in with a plausible
 * value.
 *
 * The schemas are split into three stages rather than validating a whole day
 * file at once, and that is deliberate: listing a day must not fail because
 * one race elsewhere in the file is malformed. `dayEnvelopeSchema` covers what
 * `listMeetings` needs, and the heavier shapes are parsed only when the
 * corresponding race is actually asked for.
 */

const PROVIDER_ID = "archive" as const;

/**
 * Runs a schema, re-throwing a Zod failure as the ProviderPayloadError the rest
 * of the system already handles. Zod's issue path is prefixed with the caller's
 * location in the file, so an error still names the offending field — e.g.
 * `meetings[0].races[1].runners[3].withdrawnAtOdds`.
 */
export function parseWith<T>(
  schema: z.ZodType<T>,
  value: unknown,
  prefix: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const issue = result.error.issues[0];
  const path = [prefix, ...(issue?.path ?? [])]
    .filter((segment) => segment !== "")
    .join(".");
  throw new ProviderPayloadError(
    PROVIDER_ID,
    path,
    issue?.message ?? "invalid payload",
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const nonEmptyString = z.string().min(1, "expected a non-empty string");

/** Absent and null both mean "not recorded". */
function nullable<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((v) => v ?? null);
}

export const REGION_CODES = ["GB", "IE"] as const satisfies readonly RegionCode[];

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date")
  .refine((s) => !Number.isNaN(Date.parse(s)), "expected a YYYY-MM-DD date");

const isoInstantSchema = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "expected an ISO-8601 instant");

/**
 * Odds are decimal multipliers and never hold money, so a JSON number is the
 * right representation here — unlike prizeMinor below.
 */
const oddsSchema = z
  .number()
  .finite()
  .gt(1, "expected a decimal price greater than 1");

/**
 * Money arrives as a digit string so no float ever touches it. A JSON number
 * is an IEEE-754 double and is rejected outright.
 */
const moneyMinorSchema = z
  .string()
  .regex(
    /^-?\d+$/,
    "expected minor units as a digit string (money is never a JSON number)",
  )
  .transform((s) => BigInt(s));

const rule4PenceSchema = z
  .number()
  .int()
  .min(0, "Rule 4 deduction must be 0-90 pence")
  .max(90, "Rule 4 deduction must be 0-90 pence");

const meetingStatusSchema = z.enum([
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "ABANDONED",
]);

const raceStatusSchema = z.enum([
  "SCHEDULED",
  "OPEN",
  "SUSPENDED",
  "OFF",
  "RESULT",
  "VOID",
  "ABANDONED",
  "POSTPONED",
]);

const raceTypeSchema = z.enum(["FLAT", "HURDLE", "CHASE", "NTF", "HARNESS"]);

const runnerStatusSchema = z.enum([
  "DECLARED",
  "NON_RUNNER",
  "WITHDRAWN",
  "RESERVE",
]);

const resultStatusSchema = z.enum([
  "RESULT",
  "VOID",
  "ABANDONED",
  "POSTPONED",
  "UNDER_REVIEW",
]);

const marketTypeSchema = z.enum(["WIN", "PLACE", "EACH_WAY"]);

// ---------------------------------------------------------------------------
// Stage 1 — the day envelope, everything listMeetings needs
// ---------------------------------------------------------------------------

/**
 * Race summaries keep their unknown keys (runners, odds, result) so the later
 * stages can re-parse the same object without re-reading the file.
 */
const raceSummarySchema = z.looseObject({
  raceId: nonEmptyString,
  name: nonEmptyString,
  offTime: isoInstantSchema,
  status: raceStatusSchema,
});

const meetingEnvelopeSchema = z.looseObject({
  meetingRef: nonEmptyString,
  trackName: nonEmptyString,
  /** A real ISO-3166-1 alpha-2 country, unlike a horse's breeding suffix. */
  countryCode: nonEmptyString,
  timezone: nonEmptyString,
  going: nullable(z.string()),
  status: meetingStatusSchema,
  races: z.array(raceSummarySchema),
});

export const dayEnvelopeSchema = z.object({
  region: z.enum(REGION_CODES),
  date: isoDateSchema,
  meetings: z.array(meetingEnvelopeSchema),
});

export type DayEnvelope = z.infer<typeof dayEnvelopeSchema>;
export type MeetingEnvelope = DayEnvelope["meetings"][number];
export type RaceSummaryEnvelope = MeetingEnvelope["races"][number];

// ---------------------------------------------------------------------------
// Stage 2 — the full race card
// ---------------------------------------------------------------------------

const horseSchema = z.object({
  name: nonEmptyString,
  /** Breeding suffix, not a country — docs/08 D6. */
  breedingSuffix: nullable(z.string()),
  foaledYear: nullable(z.number().int()),
  sex: nullable(z.string()),
  sire: nullable(z.string()),
  dam: nullable(z.string()),
});

const personSchema = nullable(z.object({ name: nonEmptyString }));

const runnerSchema = z
  .object({
    id: nonEmptyString,
    clothNumber: z.number().int(),
    stallDraw: nullable(z.number().int()),
    horse: horseSchema,
    jockey: personSchema,
    trainer: personSchema,
    weightCarriedLb: nullable(z.number().int()),
    officialRating: nullable(z.number().int()),
    status: runnerStatusSchema,
    withdrawnAtOdds: nullable(oddsSchema),
    startingPrice: nullable(oddsSchema),
  })
  .superRefine((runner, ctx) => {
    // Rule 4 is computed from the price the withdrawn horse was trading at. A
    // withdrawal without that price cannot be settled, so it is rejected here
    // rather than producing a silently wrong deduction later.
    if (runner.status === "WITHDRAWN" && runner.withdrawnAtOdds === null) {
      ctx.addIssue({
        code: "custom",
        path: ["withdrawnAtOdds"],
        message:
          "a WITHDRAWN runner must carry the price it was withdrawn at (Rule 4 input)",
      });
    }
  });

export const raceCardSchema = z
  .object({
    raceId: nonEmptyString,
    name: nonEmptyString,
    offTime: isoInstantSchema,
    distanceYards: nullable(z.number().int()),
    raceClass: nullable(z.string()),
    raceType: nullable(raceTypeSchema),
    /**
     * Never defaulted: it selects the each-way place-terms column. A card that
     * does not state it is rejected (docs/08 D3).
     */
    isHandicap: z.boolean({
      error:
        "required: it selects the each-way place-terms column and must not be assumed",
    }),
    ageBand: nullable(z.string()),
    prizeMinor: nullable(moneyMinorSchema),
    declaredRunners: z.number().int(),
    actualRunners: nullable(z.number().int()),
    status: raceStatusSchema,
    rule4DeductionPence: rule4PenceSchema.nullish().transform((v) => v ?? 0),
    runners: z.array(runnerSchema),
  })
  .superRefine((race, ctx) => {
    // actual_runners selects the place-terms row. Unknown while the race is
    // open is fine; unknown once it has a result is a settlement-time crash.
    if (race.status === "RESULT" && race.actualRunners === null) {
      ctx.addIssue({
        code: "custom",
        path: ["actualRunners"],
        message:
          "required once a race has a result: it selects the each-way place-terms row",
      });
    }
  });

export type ParsedRaceCard = z.infer<typeof raceCardSchema>;

// ---------------------------------------------------------------------------
// Stage 3 — odds and results
// ---------------------------------------------------------------------------

export const oddsSnapshotSchema = z.object({
  capturedAt: isoInstantSchema,
  source: nonEmptyString,
  prices: z.array(
    z.object({
      runnerId: nonEmptyString,
      marketType: marketTypeSchema,
      priceDecimal: oddsSchema,
    }),
  ),
});

export const raceResultSchema = z.object({
  status: resultStatusSchema,
  positions: z.array(
    z.object({
      runnerId: nonEmptyString,
      position: z.number().int(),
      /** Other runnerIds tied at this position. Empty means no dead heat. */
      deadHeatWith: z
        .array(nonEmptyString)
        .nullish()
        .transform((v) => v ?? []),
      disqualified: z.boolean(),
    }),
  ),
  nonRunners: z
    .array(nonEmptyString)
    .nullish()
    .transform((v) => v ?? []),
  rule4DeductionPence: rule4PenceSchema,
  amendedAt: nullable(isoInstantSchema),
});

// ---------------------------------------------------------------------------
// Mapping into the canonical domain model
// ---------------------------------------------------------------------------

export function toRunner(
  parsed: z.infer<typeof runnerSchema>,
  raceId: string,
): Runner {
  return {
    id: parsed.id,
    raceId,
    clothNumber: parsed.clothNumber,
    stallDraw: parsed.stallDraw,
    horse: parsed.horse,
    jockey: parsed.jockey,
    trainer: parsed.trainer,
    weightCarriedLb: parsed.weightCarriedLb,
    officialRating: parsed.officialRating,
    status: parsed.status,
    withdrawnAtOdds: parsed.withdrawnAtOdds,
    startingPrice: parsed.startingPrice,
  };
}

export function toRaceResult(
  parsed: z.infer<typeof raceResultSchema>,
  raceId: string,
  payloadHash: string,
): RaceResult {
  return {
    raceId,
    status: parsed.status,
    positions: parsed.positions,
    nonRunners: parsed.nonRunners,
    rule4DeductionPence: parsed.rule4DeductionPence,
    amendedAt: parsed.amendedAt,
    providerPayloadHash: payloadHash,
  };
}
