/**
 * Settlement module — S8 delivers the RULE TABLES ONLY.
 *
 * There is no `settle()` here yet. That is S9, and `tests/metamorphic/` is
 * already written against its interface and fails until it exists.
 */
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
