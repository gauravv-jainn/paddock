/**
 * The provider port and the canonical domain model — docs/01 §4.
 *
 * Nothing downstream of this module may reference a provider-specific field
 * name, header, error code or ID format. Adapters normalise into these types
 * and the rest of the system speaks only these types.
 */

export type ProviderId = "archive" | "racingapi" | "betfair";

/** YYYY-MM-DD. */
export type IsoDate = string;

/** ISO-8601 instant with an offset. */
export type IsoInstant = string;

/** Phase 0 is UK & Ireland only. */
export type RegionCode = "GB" | "IE";

/** Phase 0 bet types. Anything else is out of scope (CLAUDE.md). */
export type MarketType = "WIN" | "PLACE" | "EACH_WAY";

/** Opaque provider handles. Their internal structure belongs to the adapter. */
export type ProviderMeetingRef = string;
export type ProviderRaceRef = string;
export type RunnerId = string;
export type RaceId = string;

/** Decimal form is canonical. Fractional and American are display concerns. */
export type OddsDecimal = number;

/** Always minor units, never float. */
export type MoneyMinor = bigint;

export interface HorseRef {
  name: string;
  /**
   * Breeding suffix, e.g. 'IRE', 'USA'. Not a country code — see docs/08 D6.
   * `Meeting.countryCode` is a real ISO-3166-1 alpha-2 country; this is not.
   */
  breedingSuffix: string | null;
  foaledYear: number | null;
  sex: string | null;
  sire: string | null;
  dam: string | null;
}

export interface PersonRef {
  name: string;
}

export interface Runner {
  id: RunnerId;
  raceId: RaceId;
  clothNumber: number;
  stallDraw: number | null;
  horse: HorseRef;
  jockey: PersonRef | null;
  trainer: PersonRef | null;
  weightCarriedLb: number | null;
  officialRating: number | null;
  status: "DECLARED" | "NON_RUNNER" | "WITHDRAWN" | "RESERVE";
  /** Required input for Rule 4. Null unless status is WITHDRAWN. */
  withdrawnAtOdds: OddsDecimal | null;
  startingPrice: OddsDecimal | null;
}

export type MeetingStatus =
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "ABANDONED";

export type RaceStatus =
  | "SCHEDULED"
  | "OPEN"
  | "SUSPENDED"
  | "OFF"
  | "RESULT"
  | "VOID"
  | "ABANDONED"
  | "POSTPONED";

export type RaceType = "FLAT" | "HURDLE" | "CHASE" | "NTF" | "HARNESS";

/** A race as it appears in the meeting listing, without the runner detail. */
export interface RaceSummary {
  raceRef: ProviderRaceRef;
  name: string;
  offTime: IsoInstant;
  status: RaceStatus;
}

export interface Meeting {
  meetingRef: ProviderMeetingRef;
  trackName: string;
  /** ISO-3166-1 alpha-2. */
  countryCode: string;
  region: RegionCode;
  /** IANA zone, e.g. 'Europe/London'. */
  timezone: string;
  date: IsoDate;
  going: string | null;
  status: MeetingStatus;
  races: RaceSummary[];
}

export interface RaceCard {
  raceRef: ProviderRaceRef;
  meetingRef: ProviderMeetingRef;
  name: string;
  offTime: IsoInstant;
  distanceYards: number | null;
  raceClass: string | null;
  raceType: RaceType | null;
  /**
   * Settlement input. Never defaulted — an adapter that cannot state this
   * must fail rather than guess, because it selects the place-terms column.
   */
  isHandicap: boolean;
  ageBand: string | null;
  prizeMinor: MoneyMinor | null;
  declaredRunners: number;
  /** Settlement input. Null until the race is off. */
  actualRunners: number | null;
  status: RaceStatus;
  /** 0–90 pence in the pound, deducted from winnings only. */
  rule4DeductionPence: number;
  runners: Runner[];
}

export interface OddsPrice {
  runnerId: RunnerId;
  marketType: MarketType;
  priceDecimal: OddsDecimal;
}

export interface OddsSnapshot {
  raceRef: ProviderRaceRef;
  capturedAt: IsoInstant;
  source: string;
  prices: OddsPrice[];
}

export interface RaceResult {
  raceId: RaceId;
  status: "RESULT" | "VOID" | "ABANDONED" | "POSTPONED" | "UNDER_REVIEW";
  positions: Array<{
    runnerId: RunnerId;
    position: number;
    /** Empty array means no dead heat. */
    deadHeatWith: RunnerId[];
    disqualified: boolean;
  }>;
  nonRunners: RunnerId[];
  /** 0–90, per £1 of winnings. */
  rule4DeductionPence: number;
  /** Stewards' enquiry resolution timestamp. */
  amendedAt: IsoInstant | null;
  /** Determinism / replay guarantee. */
  providerPayloadHash: string;
}

/**
 * Not documentation. This is a runtime value the rest of the system reads
 * before it acts: a false flag disables the corresponding behaviour rather
 * than describing it. See capabilities.ts.
 */
export interface ProviderCapabilities {
  liveOdds: boolean;
  /** null = unknown or not applicable. */
  oddsLatencySeconds: number | null;
  tradedVolume: boolean;
  officialResults: boolean;
  nonRunnerFeed: boolean;
  deadHeatFlags: boolean;
  stewardsAmendments: boolean;
  supportedRegions: RegionCode[];
  supportedMarkets: MarketType[];
}

/** All provider adapters implement this. No provider types cross this boundary. */
export interface RacingDataProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  listMeetings(input: { date: IsoDate; region: RegionCode }): Promise<Meeting[]>;
  getRaceCard(input: { raceRef: ProviderRaceRef }): Promise<RaceCard>;
  getOdds(input: { raceRef: ProviderRaceRef }): Promise<OddsSnapshot>;
  getResult(input: { raceRef: ProviderRaceRef }): Promise<RaceResult | null>;
  subscribeOdds?(input: {
    raceRef: ProviderRaceRef;
  }): AsyncIterable<OddsSnapshot>;
}
