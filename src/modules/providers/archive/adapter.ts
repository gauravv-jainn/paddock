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
import { parse, parseOddsPrices, parseResult, parseRunner } from "./parse";

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

  if (!(parse.REGION_CODES as readonly string[]).includes(region)) {
    throw new ProviderPayloadError(
      PROVIDER_ID,
      "raceRef.region",
      `unknown region '${region}'`,
    );
  }
  parse.isoDate(date, "raceRef.date");
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
  meetings: unknown[];
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
    return day.meetings.map((entry, i) =>
      this.#toMeeting(entry, `meetings[${i}]`, day),
    );
  }

  async getRaceCard(input: { raceRef: ProviderRaceRef }): Promise<RaceCard> {
    const ref = decodeRaceRef(input.raceRef);
    this.#assertRegion(ref.region);
    const { race, racePath, day } = await this.#findRace(ref);
    return this.#toRaceCard(race, racePath, ref, day);
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
    const o = parse.object(odds, `${racePath}.odds`);

    return {
      raceRef: input.raceRef,
      capturedAt: parse.isoInstant(o["capturedAt"], `${racePath}.odds.capturedAt`),
      source: parse.str(o["source"], `${racePath}.odds.source`),
      prices: parseOddsPrices(o["prices"], `${racePath}.odds.prices`),
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

    const parsed = parseResult(
      result,
      `${racePath}.result`,
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
    parse.isoDate(date, "date");
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

    const doc = parse.object(body, `${region}/${date}.json`);
    const declaredRegion = parse.oneOf(doc["region"], "region", parse.REGION_CODES);
    const declaredDate = parse.isoDate(doc["date"], "date");
    if (declaredRegion !== region || declaredDate !== date) {
      parse.fail(
        `${region}/${date}.json`,
        `file declares ${declaredRegion}/${declaredDate}, which is not where it is filed`,
      );
    }

    return {
      region,
      date,
      payloadHash: createHash("sha256").update(raw).digest("hex"),
      meetings: parse.array(doc["meetings"], "meetings"),
    };
  }

  async #findRace(ref: DecodedRef): Promise<{
    race: Record<string, unknown>;
    racePath: string;
    day: LoadedDay;
  }> {
    const day = await this.#loadDay(ref.region, ref.date, true);
    if (!day) {
      throw new ProviderNotFoundError(PROVIDER_ID, encodeRaceRef(ref));
    }

    for (const [i, entry] of day.meetings.entries()) {
      const meeting = parse.object(entry, `meetings[${i}]`);
      if (parse.str(meeting["meetingRef"], `meetings[${i}].meetingRef`) !== ref.meetingRef) {
        continue;
      }
      const races = parse.array(meeting["races"], `meetings[${i}].races`);
      for (const [j, raceEntry] of races.entries()) {
        const racePath = `meetings[${i}].races[${j}]`;
        const race = parse.object(raceEntry, racePath);
        if (parse.str(race["raceId"], `${racePath}.raceId`) === ref.raceId) {
          return { race, racePath, day };
        }
      }
    }

    throw new ProviderNotFoundError(PROVIDER_ID, encodeRaceRef(ref));
  }

  #toMeeting(value: unknown, meetingPath: string, day: LoadedDay): Meeting {
    const m = parse.object(value, meetingPath);
    const meetingRef = parse.str(m["meetingRef"], `${meetingPath}.meetingRef`);
    const races = parse.array(m["races"], `${meetingPath}.races`);

    return {
      meetingRef: encodeMeetingRef(day.region, day.date, meetingRef),
      trackName: parse.str(m["trackName"], `${meetingPath}.trackName`),
      countryCode: parse.str(m["countryCode"], `${meetingPath}.countryCode`),
      region: day.region,
      timezone: parse.str(m["timezone"], `${meetingPath}.timezone`),
      date: day.date,
      going: parse.nullableStr(m["going"], `${meetingPath}.going`),
      status: parse.oneOf(
        m["status"],
        `${meetingPath}.status`,
        parse.MEETING_STATUSES,
      ),
      races: races.map((entry, j) => {
        const racePath = `${meetingPath}.races[${j}]`;
        const race = parse.object(entry, racePath);
        return {
          raceRef: encodeRaceRef({
            region: day.region,
            date: day.date,
            meetingRef,
            raceId: parse.str(race["raceId"], `${racePath}.raceId`),
          }),
          name: parse.str(race["name"], `${racePath}.name`),
          offTime: parse.isoInstant(race["offTime"], `${racePath}.offTime`),
          status: parse.oneOf(
            race["status"],
            `${racePath}.status`,
            parse.RACE_STATUSES,
          ),
        };
      }),
    };
  }

  #toRaceCard(
    race: Record<string, unknown>,
    racePath: string,
    ref: DecodedRef,
    day: LoadedDay,
  ): RaceCard {
    const status = parse.oneOf(
      race["status"],
      `${racePath}.status`,
      parse.RACE_STATUSES,
    );
    const runners = parse
      .array(race["runners"], `${racePath}.runners`)
      .map((entry, k) =>
        parseRunner(entry, `${racePath}.runners[${k}]`, ref.raceId),
      );

    // isHandicap selects the place-terms column and actualRunners selects the
    // row. Neither is ever defaulted here — a card that does not state the
    // handicap status is rejected, and a finished race without a starter count
    // is rejected, because each-way settlement cannot be computed without them.
    if (race["isHandicap"] === undefined || race["isHandicap"] === null) {
      parse.fail(
        `${racePath}.isHandicap`,
        "required: it selects the each-way place-terms column and must not be assumed",
      );
    }
    const actualRunners = parse.nullableInt(
      race["actualRunners"],
      `${racePath}.actualRunners`,
    );
    if (status === "RESULT" && actualRunners === null) {
      parse.fail(
        `${racePath}.actualRunners`,
        "required once a race has a result: it selects the each-way place-terms row",
      );
    }

    return {
      raceRef: encodeRaceRef(ref),
      meetingRef: encodeMeetingRef(day.region, day.date, ref.meetingRef),
      name: parse.str(race["name"], `${racePath}.name`),
      offTime: parse.isoInstant(race["offTime"], `${racePath}.offTime`),
      distanceYards: parse.nullableInt(
        race["distanceYards"],
        `${racePath}.distanceYards`,
      ),
      raceClass: parse.nullableStr(race["raceClass"], `${racePath}.raceClass`),
      raceType: parse.nullableOneOf(
        race["raceType"],
        `${racePath}.raceType`,
        parse.RACE_TYPES,
      ),
      isHandicap: parse.bool(race["isHandicap"], `${racePath}.isHandicap`),
      ageBand: parse.nullableStr(race["ageBand"], `${racePath}.ageBand`),
      prizeMinor: parse.nullableMoneyMinor(
        race["prizeMinor"],
        `${racePath}.prizeMinor`,
      ),
      declaredRunners: parse.int(
        race["declaredRunners"],
        `${racePath}.declaredRunners`,
      ),
      actualRunners,
      status,
      rule4DeductionPence: parse.rule4Pence(
        race["rule4DeductionPence"] ?? 0,
        `${racePath}.rule4DeductionPence`,
      ),
      runners,
    };
  }
}

export function createArchiveProvider(
  options: ArchiveProviderOptions,
): ArchiveProvider {
  return new ArchiveProvider(options);
}
