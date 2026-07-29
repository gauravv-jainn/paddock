import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CapabilityUnavailableError,
  ProviderNotFoundError,
  ProviderPayloadError,
} from "../errors";
import type {
  IsoDate,
  Meeting,
  OddsSnapshot,
  ProviderCapabilities,
  ProviderRaceRef,
  RaceCard,
  RaceResult,
  RacingDataProvider,
  RegionCode,
} from "../types";
import {
  dayEnvelopeSchema,
  oddsSnapshotSchema,
  parseWith,
  raceCardSchema,
  raceResultSchema,
  REGION_CODES,
  toRaceResult,
  toRunner,
  type DayEnvelope,
  type MeetingEnvelope,
  type RaceSummaryEnvelope,
} from "./parse";

/**
 * The archive adapter — docs/01 §3, Phase 0.
 *
 * Reads completed historical meetings from local JSON. No network, no rate
 * limits, no ToS exposure. One file per region per day:
 *
 *   <root>/<REGION>/<YYYY-MM-DD>.json
 *
 * The file shape is documented in src/modules/providers/archive/README.md.
 *
 * There is deliberately no cache, no retry and no circuit breaker: those are
 * Phase 1 concerns for a network provider, and building them against a local
 * file read would be machinery with nothing to protect.
 */

const PROVIDER_ID = "archive" as const;

/**
 * What an archive of completed races can and cannot do.
 *
 * These are read at runtime, not consulted as documentation — see
 * capabilities.ts and the enforcement in each method below.
 */
export const ARCHIVE_CAPABILITIES: ProviderCapabilities = {
  // Completed races. Prices are the recorded SP, captured once, not a feed.
  liveOdds: false,
  oddsLatencySeconds: null,
  // Betfair's traded volume is not in the historical record we assemble.
  tradedVolume: false,
  officialResults: true,
  nonRunnerFeed: true,
  deadHeatFlags: true,
  // The archive is a fixed snapshot; a stewards' amendment after the fact
  // arrives as a new file, not as an update, so there is no amendment feed.
  stewardsAmendments: false,
  supportedRegions: ["GB", "IE"],
  supportedMarkets: ["WIN", "PLACE", "EACH_WAY"],
};

export interface ArchiveProviderOptions {
  /** Directory holding <REGION>/<YYYY-MM-DD>.json. */
  root: string;
  capabilities?: ProviderCapabilities;
}

/** `<REGION>/<date>/<meetingRef>/<raceId>` — opaque outside this module. */
interface DecodedRef {
  region: RegionCode;
  date: IsoDate;
  meetingRef: string;
  raceId: string;
}

function encodeRaceRef(d: DecodedRef): ProviderRaceRef {
  return `${d.region}/${d.date}/${d.meetingRef}/${d.raceId}`;
}

function encodeMeetingRef(
  region: RegionCode,
  date: IsoDate,
  meetingRef: string,
): string {
  return `${region}/${date}/${meetingRef}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, path_: string): void {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ProviderPayloadError(
      PROVIDER_ID,
      path_,
      `expected a YYYY-MM-DD date, got '${value}'`,
    );
  }
}

function decodeRaceRef(raceRef: ProviderRaceRef): DecodedRef {
  const parts = raceRef.split("/");
  if (parts.length !== 4) {
    throw new ProviderPayloadError(
      PROVIDER_ID,
      "raceRef",
      `expected '<REGION>/<YYYY-MM-DD>/<meeting>/<race>', got '${raceRef}'`,
    );
  }
  const [region, date, meetingRef, raceId] = parts as [
    string,
    string,
    string,
    string,
  ];

  if (!(REGION_CODES as readonly string[]).includes(region)) {
    throw new ProviderPayloadError(
      PROVIDER_ID,
      "raceRef.region",
      `unknown region '${region}'`,
    );
  }
  assertIsoDate(date, "raceRef.date");
  // Refs become path segments. A '..' or an absolute segment would escape root.
  for (const segment of [meetingRef, raceId]) {
    if (segment.length === 0 || segment.includes("..") || path.isAbsolute(segment)) {
      throw new ProviderPayloadError(
        PROVIDER_ID,
        "raceRef",
        `illegal path segment '${segment}'`,
      );
    }
  }

  return { region: region as RegionCode, date, meetingRef, raceId };
}

interface LoadedDay {
  region: RegionCode;
  date: IsoDate;
  /** sha256 of the file as it was read. The determinism guarantee. */
  payloadHash: string;
  envelope: DayEnvelope;
}

export class ArchiveProvider implements RacingDataProvider {
  readonly id = PROVIDER_ID;
  readonly capabilities: ProviderCapabilities;
  readonly #root: string;

  constructor(options: ArchiveProviderOptions) {
    this.#root = path.resolve(options.root);
    this.capabilities = options.capabilities ?? ARCHIVE_CAPABILITIES;
  }

  async listMeetings(input: {
    date: IsoDate;
    region: RegionCode;
  }): Promise<Meeting[]> {
    this.#assertRegion(input.region);
    const day = await this.#loadDay(input.region, input.date, false);
    if (!day) {
      return [];
    }
    return day.envelope.meetings.map((meeting) => this.#toMeeting(meeting, day));
  }

  async getRaceCard(input: { raceRef: ProviderRaceRef }): Promise<RaceCard> {
    const ref = decodeRaceRef(input.raceRef);
    this.#assertRegion(ref.region);
    const { race, racePath, day } = await this.#findRace(ref);

    const parsed = parseWith(raceCardSchema, race, racePath);

    return {
      raceRef: encodeRaceRef(ref),
      meetingRef: encodeMeetingRef(day.region, day.date, ref.meetingRef),
      name: parsed.name,
      offTime: parsed.offTime,
      distanceYards: parsed.distanceYards,
      raceClass: parsed.raceClass,
      raceType: parsed.raceType,
      isHandicap: parsed.isHandicap,
      ageBand: parsed.ageBand,
      prizeMinor: parsed.prizeMinor,
      declaredRunners: parsed.declaredRunners,
      actualRunners: parsed.actualRunners,
      status: parsed.status,
      rule4DeductionPence: parsed.rule4DeductionPence,
      runners: parsed.runners.map((runner) => toRunner(runner, ref.raceId)),
    };
  }

  /**
   * The archive records a single price per runner — the starting price. It is
   * returned as a one-shot snapshot, never presented as live.
   */
  async getOdds(input: { raceRef: ProviderRaceRef }): Promise<OddsSnapshot> {
    const ref = decodeRaceRef(input.raceRef);
    this.#assertRegion(ref.region);
    const { race, racePath } = await this.#findRace(ref);

    const odds = race["odds"];
    if (odds === null || odds === undefined) {
      throw new ProviderNotFoundError(PROVIDER_ID, `${input.raceRef} odds`);
    }

    const parsed = parseWith(oddsSnapshotSchema, odds, `${racePath}.odds`);
    return {
      raceRef: input.raceRef,
      capturedAt: parsed.capturedAt,
      source: parsed.source,
      prices: parsed.prices,
    };
  }

  async getResult(input: {
    raceRef: ProviderRaceRef;
  }): Promise<RaceResult | null> {
    // Enforcement, not documentation: an adapter configured without official
    // results must not hand back something that looks like one.
    if (!this.capabilities.officialResults) {
      throw new CapabilityUnavailableError(PROVIDER_ID, "officialResults");
    }

    const ref = decodeRaceRef(input.raceRef);
    this.#assertRegion(ref.region);
    const { race, racePath, day } = await this.#findRace(ref);

    const result = race["result"];
    if (result === null || result === undefined) {
      return null;
    }

    const parsed = toRaceResult(
      parseWith(raceResultSchema, result, `${racePath}.result`),
      ref.raceId,
      day.payloadHash,
    );

    if (!this.capabilities.nonRunnerFeed && parsed.nonRunners.length > 0) {
      throw new CapabilityUnavailableError(
        PROVIDER_ID,
        "nonRunnerFeed",
        `${input.raceRef} has non-runners this provider cannot report`,
      );
    }
    if (
      !this.capabilities.deadHeatFlags &&
      parsed.positions.some((p) => p.deadHeatWith.length > 0)
    ) {
      throw new CapabilityUnavailableError(
        PROVIDER_ID,
        "deadHeatFlags",
        `${input.raceRef} contains a dead heat this provider cannot report`,
      );
    }
    if (!this.capabilities.stewardsAmendments && parsed.amendedAt !== null) {
      throw new CapabilityUnavailableError(
        PROVIDER_ID,
        "stewardsAmendments",
        `${input.raceRef} carries an amendment this provider cannot track`,
      );
    }

    return parsed;
  }

  // subscribeOdds is deliberately absent. capabilities.liveOdds is false, and
  // an adapter over completed races has nothing to stream.

  #assertRegion(region: RegionCode): void {
    if (!this.capabilities.supportedRegions.includes(region)) {
      throw new CapabilityUnavailableError(
        PROVIDER_ID,
        "supportedRegions",
        `region '${region}' (supported: ${this.capabilities.supportedRegions.join(", ")})`,
      );
    }
  }

  async #loadDay(
    region: RegionCode,
    date: IsoDate,
    required: boolean,
  ): Promise<LoadedDay | null> {
    assertIsoDate(date, "date");
    const file = path.join(this.#root, region, `${date}.json`);

    let raw: Buffer;
    try {
      raw = await readFile(file);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        if (required) {
          throw new ProviderNotFoundError(PROVIDER_ID, `${region}/${date}`);
        }
        return null;
      }
      throw error;
    }

    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      throw new ProviderPayloadError(
        PROVIDER_ID,
        `${region}/${date}.json`,
        error instanceof Error ? error.message : "invalid JSON",
      );
    }

    // Envelope only. A malformed race deeper in the file is caught when that
    // race is asked for, so one bad card does not make the day unlistable.
    const envelope = parseWith(dayEnvelopeSchema, body, `${region}/${date}.json`);

    if (envelope.region !== region || envelope.date !== date) {
      throw new ProviderPayloadError(
        PROVIDER_ID,
        `${region}/${date}.json`,
        `file declares ${envelope.region}/${envelope.date}, which is not where it is filed`,
      );
    }

    return {
      region,
      date,
      payloadHash: createHash("sha256").update(raw).digest("hex"),
      envelope,
    };
  }

  async #findRace(ref: DecodedRef): Promise<{
    race: RaceSummaryEnvelope;
    racePath: string;
    day: LoadedDay;
  }> {
    const day = await this.#loadDay(ref.region, ref.date, true);
    if (!day) {
      throw new ProviderNotFoundError(PROVIDER_ID, encodeRaceRef(ref));
    }

    for (const [i, meeting] of day.envelope.meetings.entries()) {
      if (meeting.meetingRef !== ref.meetingRef) {
        continue;
      }
      for (const [j, race] of meeting.races.entries()) {
        if (race.raceId === ref.raceId) {
          return { race, racePath: `meetings[${i}].races[${j}]`, day };
        }
      }
    }

    throw new ProviderNotFoundError(PROVIDER_ID, encodeRaceRef(ref));
  }

  #toMeeting(meeting: MeetingEnvelope, day: LoadedDay): Meeting {
    return {
      meetingRef: encodeMeetingRef(day.region, day.date, meeting.meetingRef),
      trackName: meeting.trackName,
      countryCode: meeting.countryCode,
      region: day.region,
      timezone: meeting.timezone,
      date: day.date,
      going: meeting.going,
      status: meeting.status,
      races: meeting.races.map((race) => ({
        raceRef: encodeRaceRef({
          region: day.region,
          date: day.date,
          meetingRef: meeting.meetingRef,
          raceId: race.raceId,
        }),
        name: race.name,
        offTime: race.offTime,
        status: race.status,
      })),
    };
  }
}

export function createArchiveProvider(
  options: ArchiveProviderOptions,
): ArchiveProvider {
  return new ArchiveProvider(options);
}
