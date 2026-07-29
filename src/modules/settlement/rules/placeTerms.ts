import type { RuleTable } from "./rule4";

/**
 * Each-way place terms — `docs/05` §4, as plain versioned data.
 *
 * Two inputs select a row: the number of runners that ACTUALLY STARTED, and
 * whether the race is a handicap. Both were hardened by `docs/08` D3 and D4
 * precisely because they decide how many places are paid.
 *
 * ── EVIDENCE ────────────────────────────────────────────────────────────────
 * Confirmed row for row against docs/sources/place-terms-kickthebookies.txt,
 * the only source fetched that splits the table by handicap status across the
 * full runner range. Partially corroborated by place-terms-others.txt.
 * Checked 2026-07-29. NOT confirmed against any bookmaker — O4 stays open.
 */

export interface PlaceTermsRow {
  /** Inclusive. */
  minRunners: number;
  /** Inclusive. Null means open above. */
  maxRunners: number | null;
  /** Null applies to both handicap and non-handicap. */
  isHandicap: boolean | null;
  places: number;
  /**
   * DENOMINATOR of the place fraction: 4 means 1/4, 5 means 1/5. An integer, so
   * the fraction never becomes a float on its way into the money path.
   * Zero when no places are paid.
   */
  fractionDen: number;
  disputed?: { competing: string; note: string };
}

export const PLACE_TERMS_TABLE: RuleTable<PlaceTermsRow> = {
  effectiveFrom: null,
  checkedOn: "2026-07-29",
  version: "2026-07-29-kickthebookies-confirmed",
  rows: [
    // VERIFY: 1-4 runners is win-only in every source. place-terms-*.txt.
    { minRunners: 1, maxRunners: 4, isHandicap: null, places: 0, fractionDen: 0 },
    // VERIFY: 5-7 pays 2 at 1/4 in both race types. All four sources agree.
    { minRunners: 5, maxRunners: 7, isHandicap: null, places: 2, fractionDen: 4 },
    // VERIFY: handicap 8-11 pays 3 at 1/5. kickthebookies is the only source
    // that states this row explicitly; two others omit it entirely.
    { minRunners: 8, maxRunners: 11, isHandicap: true, places: 3, fractionDen: 5 },
    // VERIFY: handicap 12-15 pays 3 at 1/4. DISPUTED — see below.
    {
      minRunners: 12,
      maxRunners: 15,
      isHandicap: true,
      places: 3,
      fractionDen: 4,
      disputed: {
        competing: "theracelab publishes 8-15 runners at 1/5",
        note:
          "One source against three plus docs/05 §4, and its own table has no " +
          "handicap 12-15 row at all. Recorded rather than dismissed: if it is " +
          "right, every 12-15 runner handicap each-way bet pays 1/5 not 1/4.",
      },
    },
    // VERIFY: handicap 16+ pays 4 at 1/4. All four sources agree.
    { minRunners: 16, maxRunners: null, isHandicap: true, places: 4, fractionDen: 4 },
    // VERIFY: non-handicap 8+ pays 3 at 1/5, with NO upper bound. Two sources
    // cap it (at 11 and at 15 runners), which would leave a large
    // non-handicap field with no row at all; kickthebookies and
    // grandnational.fans state 8+ unbounded, and docs/05 §4 agrees.
    { minRunners: 8, maxRunners: null, isHandicap: false, places: 3, fractionDen: 5 },
  ],
};

export interface PlaceTerms {
  places: number;
  /** Denominator: 4 means 1/4. Zero when no places are paid. */
  fractionDen: number;
  source: "standard" | "enhanced";
  /** Carried through so the settlement detail view can explain the row used. */
  disputed?: PlaceTermsRow["disputed"];
}

/** Commercially enhanced terms — `docs/08` D18. Both fields or neither. */
export interface EnhancedTerms {
  places: number;
  fractionDen: number;
}

export class EnhancedTermsIncompleteError extends Error {
  constructor(detail: string) {
    super(`enhanced place terms are incomplete: ${detail}`);
    this.name = "EnhancedTermsIncompleteError";
  }
}

/**
 * Place terms for a race.
 *
 * `actualRunners` must be the number that STARTED, never the number declared
 * (`docs/05` §4.1). A 16-runner handicap with one non-runner pays 3 places, not
 * 4, and settling on the declared count overpays.
 *
 * Enhanced terms, when both fields are present, apply VERBATIM and the standard
 * table is not consulted at all (D18).
 */
export function lookupPlaceTerms(
  actualRunners: number,
  isHandicap: boolean,
  enhanced?: EnhancedTerms | null,
): PlaceTerms {
  if (enhanced) {
    // Half an override is not a term. The database rejects it too
    // (races_enhanced_terms_complete), so reaching here means someone
    // constructed one in code.
    if (
      !Number.isInteger(enhanced.places) ||
      !Number.isInteger(enhanced.fractionDen) ||
      enhanced.places <= 0 ||
      enhanced.fractionDen <= 0
    ) {
      throw new EnhancedTermsIncompleteError(
        `places=${String(enhanced.places)} fractionDen=${String(enhanced.fractionDen)}`,
      );
    }
    return {
      places: enhanced.places,
      fractionDen: enhanced.fractionDen,
      source: "enhanced",
    };
  }

  if (!Number.isInteger(actualRunners) || actualRunners < 1) {
    throw new RangeError(
      `actualRunners must be a positive integer, got ${String(actualRunners)}`,
    );
  }

  for (const row of PLACE_TERMS_TABLE.rows) {
    if (row.isHandicap !== null && row.isHandicap !== isHandicap) continue;
    if (actualRunners < row.minRunners) continue;
    if (row.maxRunners !== null && actualRunners > row.maxRunners) continue;
    return {
      places: row.places,
      fractionDen: row.fractionDen,
      source: "standard",
      ...(row.disputed === undefined ? {} : { disputed: row.disputed }),
    };
  }

  // Unreachable while the table covers 1..∞ for both race types. Throwing
  // rather than defaulting to win-only: silently paying no places on a race
  // that owed three is the same class of bug as a silent zero deduction.
  throw new Error(
    `no place-terms row for ${actualRunners} runners, isHandicap=${String(isHandicap)}`,
  );
}
