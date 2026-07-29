import { compareFractions, type Fraction } from "./fraction";

/**
 * Tattersalls Rule 4 deduction bands — `docs/05` §5.1, as plain versioned data.
 *
 * `.claude/rules/money.md`: these live here as data, never as conditionals
 * scattered through settlement code, and are never edited without a
 * corresponding test. `tests/consensus/` re-checks this table against six
 * published sources on every run and fails the build if any row drops below
 * three agreeing sources.
 *
 * The lookup input is a FRACTION (`docs/08` D14). Comparison is integer-only.
 *
 * ── EVIDENCE ────────────────────────────────────────────────────────────────
 * Six sources, all captured verbatim under docs/sources/:
 *   rule4-geegeez.txt · rule4-bettingsites.txt · rule4-nonrunnerstoday.txt
 *   rule4-horseracingnonrunners.txt · rule4-racing-index.txt
 *   rule4-nonrunnerstomorrow.txt
 * Per-row tally, including which rows have a third-party COMPUTED number:
 *   tests/consensus/README.md
 *
 * NOT confirmed against any bookmaker's published table. All sixteen attempts
 * were blocked (docs/sources/BLOCKED-bookmakers.txt). O4 stays open.
 */

const f = (num: number, den: number): Fraction => ({ num, den });

/**
 * How well evidenced a band is — `docs/08` D21.
 *
 * `consensus-only` means published tables agree but NO third party has ever
 * shown a worked calculation for it. settle() still settles those bands, and
 * says so in the calculation object rather than hiding it.
 */
export type EvidenceConfidence = "consensus-only" | "computed-confirmed";

export interface Rule4Band {
  /** Pence in the pound of WINNINGS. Unique per row, so it doubles as the key. */
  deduction: number;
  /** Shorter end, inclusive. Null on row 1 ("1/9 or shorter"). */
  from: Fraction | null;
  /** Longer end, inclusive. Null on row 19 ("over 14/1"). */
  to: Fraction | null;
  /**
   * True only on row 19: "over 14/1" abuts the 5p band, which ends AT 14/1
   * inclusive. Without this the two look like they overlap at exactly 14/1.
   */
  fromExclusive?: boolean;
  /** As the sources print it. */
  published: string;
  /** Published tables agreeing with this row, of six. */
  sourceCount: number;
  /** Third-party worked examples stating a number for this band. */
  computedCount: number;
  /** D21. Derived from computedCount; asserted in rule4.test.ts. */
  evidenceConfidence: EvidenceConfidence;
  /** Set where sources publish different bounds for this row. */
  disputed?: { competing: string[]; note: string };
}

export interface RuleTable<T> {
  /**
   * money.md asks for versioning by effective date. The date the Tattersalls
   * scale took effect appears in NONE of the six sources, so this is null
   * rather than invented — an unsourced racing fact is exactly what put the
   * ten-row error into docs/05 §5.1. `checkedOn` is what is actually known.
   */
  effectiveFrom: string | null;
  checkedOn: string;
  version: string;
  rows: T[];
}

export const RULE4_TABLE: RuleTable<Rule4Band> = {
  effectiveFrom: null,
  checkedOn: "2026-07-29",
  version: "2026-07-29-six-source-consensus",
  rows: [
    // VERIFY: 6/6 sources. No third-party worked example exists for any
    // odds-on band — rows 1-9 are consensus-only (docs/08 D21). These are the
    // largest deductions in the table and the least independently confirmed.
    {
      deduction: 90,
      from: null,
      to: f(1, 9),
      published: "1/9 or shorter",
      sourceCount: 6,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    {
      deduction: 85,
      from: f(2, 17),
      to: f(2, 11),
      published: "2/11 - 2/17",
      sourceCount: 6,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    {
      deduction: 80,
      from: f(1, 5),
      to: f(1, 4),
      published: "1/4 - 1/5",
      sourceCount: 6,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    {
      deduction: 75,
      from: f(2, 7),
      to: f(3, 10),
      published: "3/10 - 2/7",
      sourceCount: 6,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    {
      deduction: 70,
      from: f(1, 3),
      to: f(2, 5),
      published: "2/5 - 1/3",
      sourceCount: 6,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    {
      deduction: 65,
      from: f(4, 9),
      to: f(8, 15),
      published: "8/15 - 4/9",
      sourceCount: 6,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    // VERIFY: 5/6 — docs/sources/rule4-horseracingnonrunners.txt is corrupt at
    // this row, repeating "8/15" as the lower bound of two consecutive bands.
    {
      deduction: 60,
      from: f(4, 7),
      to: f(8, 13),
      published: "8/13 - 4/7",
      sourceCount: 5,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    // VERIFY: 5/6 — same source, corrupt at the same place.
    {
      deduction: 55,
      from: f(4, 6),
      to: f(4, 5),
      published: "4/5 - 4/6",
      sourceCount: 5,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    {
      deduction: 50,
      from: f(5, 6),
      to: f(20, 21),
      published: "20/21 - 5/6",
      sourceCount: 6,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    // VERIFY: 6/6 sources, plus docs/sources/rule4-racing-index.txt stating
    // "the evens favourite ... a R4 deduction of 45p". docs/08 D19 adopted 45p
    // over two rival readings (50p from the old unsourced table, 55p via
    // docs/09 §3.3); O6 stays open until a primary source is read.
    {
      deduction: 45,
      from: f(1, 1),
      to: f(6, 5),
      published: "Evens - 6/5",
      sourceCount: 6,
      computedCount: 1,
      evidenceConfidence: "computed-confirmed",
    },
    // VERIFY: 6/6, plus pub-r4-004 (6/4 withdrawn -> 40p, stated return £68).
    {
      deduction: 40,
      from: f(5, 4),
      to: f(6, 4),
      published: "5/4 - 6/4",
      sourceCount: 6,
      computedCount: 1,
      evidenceConfidence: "computed-confirmed",
    },
    // VERIFY: 6/6, plus racing-index "a horse at 7/4 ... 35p".
    {
      deduction: 35,
      from: f(8, 5),
      to: f(7, 4),
      published: "8/5 - 7/4",
      sourceCount: 6,
      computedCount: 1,
      evidenceConfidence: "computed-confirmed",
    },
    // VERIFY: 6/6, plus pub-r4-003 and pub-r4-007 (2/1 -> 30p, stated returns).
    {
      deduction: 30,
      from: f(9, 5),
      to: f(9, 4),
      published: "9/5 - 9/4",
      sourceCount: 6,
      computedCount: 2,
      evidenceConfidence: "computed-confirmed",
    },
    // VERIFY: 6/6, plus pub-r4-006, pub-r4-008, pub-r4-009 (3/1 -> 25p).
    // The best-evidenced row in the table.
    {
      deduction: 25,
      from: f(12, 5),
      to: f(3, 1),
      published: "12/5 - 3/1",
      sourceCount: 6,
      computedCount: 3,
      evidenceConfidence: "computed-confirmed",
    },
    // VERIFY: 4/6 — the WEAKEST row on source count, and the only three-way
    // split in the table. racing-index publishes 16/15, which is 1.067 and
    // therefore below the 12/5 that opens the band above it: a table cannot run
    // 12/5 -> 16/15 -> 9/2, so it is a typo (inserting a '1' into "16/5"
    // produces it exactly). nonrunnerstomorrow publishes 100/30, which IS in
    // sequence and so is a real disagreement, losing 4 to 1 on count.
    // Computed once by racing-index ("a horse at 4/1 ... 20p").
    {
      deduction: 20,
      from: f(16, 5),
      to: f(4, 1),
      published: "16/5 - 4/1",
      sourceCount: 4,
      computedCount: 1,
      evidenceConfidence: "computed-confirmed",
      disputed: {
        competing: ["16/5 (4 sources, adopted)", "100/30 (1)", "16/15 (1, out of sequence)"],
        note:
          "Weakest row in the table on source count. computedCount is 1, so " +
          "evidenceConfidence reads computed-confirmed and would otherwise hide " +
          "that. Surfaced separately for docs/08 D21's purpose: tell the user " +
          "what is known and what is not.",
      },
    },
    // VERIFY: 6/6, plus pub-r4-006 (5/1 -> 15p) and racing-index "at odds of
    // 5/1 the R4 deduction would only be 15p".
    {
      deduction: 15,
      from: f(9, 2),
      to: f(11, 2),
      published: "9/2 - 11/2",
      sourceCount: 6,
      computedCount: 2,
      evidenceConfidence: "computed-confirmed",
    },
    // VERIFY: 6/6, no computed example. A real gap at a common price range.
    {
      deduction: 10,
      from: f(6, 1),
      to: f(9, 1),
      published: "6/1 - 9/1",
      sourceCount: 6,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
    // VERIFY: 6/6, plus pub-r4-005 and pub-r4-009. geegeez footnotes that not
    // all bookmakers apply a deduction at this level, so it may be
    // operator-specific — another thing only a primary source settles.
    {
      deduction: 5,
      from: f(10, 1),
      to: f(14, 1),
      published: "10/1 - 14/1",
      sourceCount: 6,
      computedCount: 2,
      evidenceConfidence: "computed-confirmed",
    },
    // VERIFY: 6/6. Exposure is nil — the deduction is zero — so consensus-only
    // is acceptable here in a way it is not for rows 1-9.
    {
      deduction: 0,
      from: f(14, 1),
      to: null,
      fromExclusive: true,
      published: "over 14/1",
      sourceCount: 6,
      computedCount: 0,
      evidenceConfidence: "consensus-only",
    },
  ],
};

/**
 * The band a withdrawn price falls in.
 *
 * Every price resolves — the table is total. The refusal cases in `docs/08` D14
 * (a decimal not on the ladder) and D17 (an ambiguous withdrawal) are about a
 * MISSING fraction, which is settle()'s decision in S9, not this table's.
 */
export function lookupRule4Band(price: Fraction): Rule4Band {
  for (const band of RULE4_TABLE.rows) {
    const aboveFloor =
      band.from === null ||
      (band.fromExclusive === true
        ? compareFractions(price, band.from) > 0
        : compareFractions(price, band.from) >= 0);
    const belowCeiling = band.to === null || compareFractions(price, band.to) <= 0;
    if (aboveFloor && belowCeiling) return band;
  }

  // Unreachable: row 1 is open below and row 19 open above, and the bands are
  // contiguous. Throwing rather than defaulting to 0p — a silent zero here is
  // a full payout on a race that owed a deduction.
  throw new Error(
    `no Rule 4 band for ${price.num}/${price.den} — the table has a hole`,
  );
}
