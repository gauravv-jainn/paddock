import type { EvidenceConfidence } from "./rules/rule4";
import type { Fraction } from "./rules/fraction";

/**
 * Inputs and outputs for settle(). No database rows, no provider types — a
 * pure function's inputs are values, so it can be replayed from persisted
 * state alone (docs/00, determinism).
 */

export type BetType = "WIN" | "PLACE" | "EACH_WAY";

export type BetStatus = "WON" | "LOST" | "VOID" | "PARTIAL";

export interface SettlementBet {
  type: BetType;
  /** Per part. EACH_WAY stakes this twice. */
  unitStakeMinor: bigint;
  /** unit for WIN/PLACE, unit x 2 for EACH_WAY. */
  totalStakeMinor: bigint;
  /** Decimal, frozen at placement. Must exceed 1. */
  oddsTaken: number;
}

export interface SettlementRunner {
  status: "DECLARED" | "NON_RUNNER" | "WITHDRAWN" | "RESERVE";
  /** Null when the horse did not finish. */
  finishPosition: number | null;
  /** 1 = clean. 2 = two-way dead heat, and so on. */
  deadHeatCount: number;
  disqualified: boolean;
}

/** A withdrawal in the race the bet was struck on — docs/08 D14, D17. */
export interface Withdrawal {
  /**
   * The SOLE Rule 4 lookup input (D14). Null means the feed gave a decimal
   * that is not on the fractional ladder, or gave nothing.
   */
  fraction: Fraction | null;
  /** `runners.status`. A non_runner voids; only a withdrawn runner deducts. */
  runnerStatus: "withdrawn" | "non_runner";
}

export interface SettlementRace {
  status: "RESULT" | "VOID" | "ABANDONED" | "POSTPONED" | "UNDER_REVIEW";
  /** Runners that actually STARTED. Selects the place-terms row. */
  actualRunners: number | null;
  isHandicap: boolean;
  /** docs/08 D18. Both or neither. */
  enhancedPlaces?: number | null;
  enhancedFractionDen?: number | null;
  /**
   * A deduction the feed announced outright. When present it is authoritative
   * and the band table is not consulted — the archive's historical rows carry
   * this and no withdrawal prices (docs/08 D20).
   */
  announcedRule4Pence: number | null;
  withdrawals: Withdrawal[];
}

export type ReviewReason =
  | "RULE4_PRICE_NOT_ON_LADDER"
  | "AMBIGUOUS_WITHDRAWAL"
  | "MISSING_ACTUAL_RUNNERS";

/** An exact rational carried until the single rounding at the end. */
export interface Rational {
  num: bigint;
  den: bigint;
}

export interface PartCalculation {
  part: "WIN" | "PLACE";
  stakeMinor: bigint;
  /** placesPaid and the fraction denominator, for the PLACE part only. */
  placesPaid?: number;
  placeFractionDen?: number;
  placeTermsSource?: "standard" | "enhanced";
  placeTermsDisputed?: string;
  /** Tied runners and positions available at that finishing position. */
  deadHeatTied: number;
  deadHeatPositionsAvailable: number;
  /** Effective stake after the dead-heat divisor, as an exact rational. */
  effectiveStake: Rational;
  /** Winnings before Rule 4, exact. */
  grossWinnings: Rational;
  rule4Pence: number;
  /** Winnings after Rule 4, exact. */
  netWinnings: Rational;
  /** effectiveStake + netWinnings, exact. */
  partReturn: Rational;
  /** The part's own single rounding. docs/05 §3.3: each part is its own bet. */
  partReturnMinor: string;
  outcome: "won" | "lost" | "void";
}

export interface Rule4Calculation {
  applied: boolean;
  totalPence: number;
  cappedAt90: boolean;
  source: "announced" | "band-table" | "none";
  bands: Array<{
    price: string;
    deduction: number;
    sourceCount: number;
    computedCount: number;
    /** docs/08 D21. */
    evidenceConfidence: EvidenceConfidence;
    disputed?: string;
  }>;
  /** D21. The weakest confidence across every band used. */
  weakestConfidence: EvidenceConfidence | null;
}

export interface Calculation {
  version: 1;
  betType: BetType;
  oddsTaken: number;
  totalStakeMinor: string;
  race: {
    status: SettlementRace["status"];
    actualRunners: number | null;
    isHandicap: boolean;
  };
  runner: {
    status: SettlementRunner["status"];
    finishPosition: number | null;
    deadHeatCount: number;
    disqualified: boolean;
  };
  /** Ordered list of the rules that fired, in the order money.md mandates. */
  rulesApplied: string[];
  placeTermsReducedByFieldSize?: {
    declaredWouldHavePaid: number;
    actualPays: number;
    note: string;
  };
  rule4: Rule4Calculation;
  parts: PartCalculation[];
  /** The single rounding. */
  rounding: {
    exactNumerator: string;
    exactDenominator: string;
    mode: "half-up, ties in the user's favour";
    roundedMinor: string;
  };
  returnMinor: string;
}

export type SettlementOutcome =
  | {
      kind: "SETTLED";
      status: BetStatus;
      returnMinor: bigint;
      calculation: Calculation;
    }
  | {
      kind: "NEEDS_REVIEW";
      reason: ReviewReason;
      detail: string;
      calculation: Calculation;
    };
