/** Settlement module — the rule tables (S8) and settle() (S9). */
export { settle } from "./settle";
export type {
  BetStatus,
  BetType,
  Calculation,
  PartCalculation,
  Rational,
  ReviewReason,
  Rule4Calculation,
  SettlementBet,
  SettlementOutcome,
  SettlementRace,
  SettlementRunner,
  Withdrawal,
} from "./types";

export {
  compareFractions,
  formatFraction,
  fractionsEqual,
  toDecimalForDisplay,
  type Fraction,
} from "./rules/fraction";

export {
  lookupRule4Band,
  RULE4_TABLE,
  type EvidenceConfidence,
  type Rule4Band,
  type RuleTable,
} from "./rules/rule4";

export {
  EnhancedTermsIncompleteError,
  lookupPlaceTerms,
  PLACE_TERMS_TABLE,
  type EnhancedTerms,
  type PlaceTerms,
  type PlaceTermsRow,
} from "./rules/placeTerms";

export {
  settleRace,
  type BetSettlementReport,
  type SettleRaceOutcome,
  type SettleRaceRefusal,
  type SettleRaceReport,
  type SettleRaceStatus,
} from "./settleRace";
export { settlements, SETTLEMENT_OUTCOMES, type Settlement } from "./schema";
