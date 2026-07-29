/**
 * Deriving `is_handicap` from a race name.
 *
 * The recommended dataset (`docs/sources/datasets.md`) has no handicap column,
 * and `is_handicap` selects the each-way place-terms COLUMN — get it wrong and
 * the race pays the wrong number of places. `docs/08` D3 removed its database
 * default for exactly this reason.
 *
 * So this never guesses. A name that does not match a rule is REFUSED and the
 * race is skipped with its reason recorded — the same shape as D14 (an
 * off-ladder withdrawn price refuses) and D17 (an ambiguous withdrawal refuses).
 */

export type HandicapDerivation =
  | { ok: true; isHandicap: boolean; rule: string; matched: string }
  | { ok: false; reason: string };

/**
 * Rule 1 — positive markers. Checked FIRST, so "Novice Handicap Chase" and
 * "Handicap Stakes" resolve to handicap rather than being caught by rule 2.
 */
const HANDICAP_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bhandicaps?\b/i, "handicap"],
  [/\bh['’]?caps?\b/i, "h'cap"],
];

/** Rule 2 — negative markers. Race types that are not handicaps. */
const NON_HANDICAP_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmaidens?\b/i, "maiden"],
  [/\bnovices?\b/i, "novice"],
  [/\bclaiming\b/i, "claiming"],
  [/\bselling\b/i, "selling"],
  [/\bauction\b/i, "auction"],
  [/\bconditions?\b/i, "conditions"],
  [/\bgroup\s*[123]\b/i, "group"],
  [/\blisted\b/i, "listed"],
  [/\bclassified\b/i, "classified"],
  [/\bbumper\b/i, "bumper"],
  [/\bnational\s+hunt\s+flat\b/i, "national hunt flat"],
  [/\bn\.?h\.?f\.?\b/i, "nhf"],
  // Deliberately last: "Stakes" is the broadest and most likely to appear
  // inside a handicap's name, so rule 1 must have had its chance first.
  [/\bstakes\b/i, "stakes"],
];

/**
 * Rule 3 — known-ambiguous, refused with a specific reason rather than falling
 * through to the generic one.
 *
 * `nursery`: widely described as a two-year-old handicap, which would make it
 * rule 1. That is a racing fact this project has not sourced, and unsourced
 * racing facts are what put a ten-row error into `docs/05` §5.1. Nearly every
 * nursery is named "... Nursery Handicap" and is caught by rule 1 anyway.
 */
const KNOWN_AMBIGUOUS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\bnursery\b/i,
    "'nursery' is believed to be a two-year-old handicap but that is unsourced; " +
      "a race named '... Nursery Handicap' is caught by rule 1 instead",
  ],
];

export function deriveIsHandicap(raceName: string): HandicapDerivation {
  const name = raceName.trim();
  if (name.length === 0) {
    return { ok: false, reason: "empty race name" };
  }

  for (const [pattern, label] of HANDICAP_MARKERS) {
    const m = pattern.exec(name);
    if (m) {
      return { ok: true, isHandicap: true, rule: "1-handicap-marker", matched: label };
    }
  }

  for (const [pattern, reason] of KNOWN_AMBIGUOUS) {
    if (pattern.test(name)) {
      return { ok: false, reason };
    }
  }

  for (const [pattern, label] of NON_HANDICAP_MARKERS) {
    if (pattern.test(name)) {
      return {
        ok: true,
        isHandicap: false,
        rule: "2-non-handicap-marker",
        matched: label,
      };
    }
  }

  return {
    ok: false,
    reason:
      "no handicap or non-handicap marker in the race name; refusing rather " +
      "than defaulting (docs/08 D3)",
  };
}
