/**
 * Every fetched Rule 4 table, encoded row for row as data.
 *
 * Layer 4 of the verification strategy in `docs/08` D20: **table consensus as
 * a permanent test**. D20's layers 2 and 3 (metamorphic, differential) are
 * both blind to a wrong constant — two implementations reading the same wrong
 * band agree perfectly. Only evidence catches a wrong number, and until now
 * that evidence was a one-off cross-check in a markdown file that nothing
 * enforced.
 *
 * This makes it a regression guard: every row of `docs/05` §5.1 must be backed
 * by at least three independent sources, or the build fails and names the
 * competing values.
 *
 * TRANSCRIPTION RULE: these are copied from the verbatim captures in
 * `docs/sources/rule4-*.txt` and from nowhere else. If a value here disagrees
 * with its source file, the source file wins and this is a transcription bug.
 */

import { RULE4_TABLE, type Fraction } from "@/modules/settlement";

export type { Fraction };

export interface Band {
  /** Pence in the pound. Unique per row, so it doubles as the row key. */
  deduction: number;
  /** Shorter end. Null on row 1 ("1/9 or shorter"). */
  from: Fraction | null;
  /** Longer end. Null on row 19 ("over 14/1"). */
  to: Fraction | null;
  /**
   * True when `from` is EXCLUSIVE. Only row 19: "over 14/1" shares its bound
   * with the 5p band, which ends AT 14/1 inclusive. Without this the two bands
   * look like they overlap at exactly 14/1 when in fact they abut.
   */
  fromExclusive?: boolean;
  /** Exactly as the source prints it, for the failure message. */
  published: string;
}

export interface Source {
  id: string;
  url: string;
  file: string;
  fetched: string;
  bands: Band[];
}

const f = (num: number, den: number): Fraction => ({ num, den });

/**
 * The shape shared by five of the six sources. Only the disputed row 15 and
 * the two corrupt rows in horseracingnonrunners differ, so the agreeing rows
 * are written once and overridden per source. Writing all 114 rows out by hand
 * would invite exactly the transcription errors this file exists to catch.
 */
function standardBands(overrides: Partial<Record<number, Band>> = {}): Band[] {
  const base: Band[] = [
    { deduction: 90, from: null, to: f(1, 9), published: "1/9 or shorter" },
    { deduction: 85, from: f(2, 17), to: f(2, 11), published: "2/11 - 2/17" },
    { deduction: 80, from: f(1, 5), to: f(1, 4), published: "1/4 - 1/5" },
    { deduction: 75, from: f(2, 7), to: f(3, 10), published: "3/10 - 2/7" },
    { deduction: 70, from: f(1, 3), to: f(2, 5), published: "2/5 - 1/3" },
    { deduction: 65, from: f(4, 9), to: f(8, 15), published: "8/15 - 4/9" },
    { deduction: 60, from: f(4, 7), to: f(8, 13), published: "8/13 - 4/7" },
    { deduction: 55, from: f(4, 6), to: f(4, 5), published: "4/5 - 4/6" },
    { deduction: 50, from: f(5, 6), to: f(20, 21), published: "20/21 - 5/6" },
    { deduction: 45, from: f(1, 1), to: f(6, 5), published: "Evens - 6/5" },
    { deduction: 40, from: f(5, 4), to: f(6, 4), published: "5/4 - 6/4" },
    { deduction: 35, from: f(8, 5), to: f(7, 4), published: "8/5 - 7/4" },
    { deduction: 30, from: f(9, 5), to: f(9, 4), published: "9/5 - 9/4" },
    { deduction: 25, from: f(12, 5), to: f(3, 1), published: "12/5 - 3/1" },
    { deduction: 20, from: f(16, 5), to: f(4, 1), published: "16/5 - 4/1" },
    { deduction: 15, from: f(9, 2), to: f(11, 2), published: "9/2 - 11/2" },
    { deduction: 10, from: f(6, 1), to: f(9, 1), published: "6/1 - 9/1" },
    { deduction: 5, from: f(10, 1), to: f(14, 1), published: "10/1 - 14/1" },
    {
      deduction: 0,
      from: f(14, 1),
      to: null,
      fromExclusive: true,
      published: "over 14/1",
    },
  ];
  return base.map((b) => overrides[b.deduction] ?? b);
}

export const SOURCES: Source[] = [
  {
    id: "geegeez",
    url: "https://www.geegeez.co.uk/geegeez-faq/rule-4-deductions-chart/",
    file: "docs/sources/rule4-geegeez.txt",
    fetched: "2026-07-29",
    bands: standardBands(),
  },
  {
    id: "bettingsites",
    url: "https://www.bettingsites.org.uk/sports/horse-racing/rule-4/",
    file: "docs/sources/rule4-bettingsites.txt",
    fetched: "2026-07-29",
    bands: standardBands(),
  },
  {
    id: "nonrunnerstoday",
    url: "https://nonrunnerstodayracing.com/articles/rule-4-deduction-table/",
    file: "docs/sources/rule4-nonrunnerstoday.txt",
    fetched: "2026-07-29",
    bands: standardBands(),
  },
  {
    id: "horseracingnonrunners",
    url: "https://horseracingnonrunners.com/rule-4-deductions/",
    file: "docs/sources/rule4-horseracingnonrunners.txt",
    fetched: "2026-07-29",
    // Corrupt at exactly two rows: it repeats "8/15" as the lower bound of two
    // consecutive bands, and its 55p row's bounds match no other source.
    bands: standardBands({
      60: { deduction: 60, from: f(4, 7), to: f(8, 15), published: "8/15 - 4/7" },
      55: { deduction: 55, from: f(4, 6), to: f(8, 13), published: "8/13 - 4/6" },
    }),
  },
  {
    id: "racing-index",
    url: "https://www.racing-index.com/bookmakers/bettingguide/rule4deductions.html",
    file: "docs/sources/rule4-racing-index.txt",
    fetched: "2026-07-29",
    // Row 15 out of sequence: 16/15 is 1.067, below the 12/5 band above it.
    // Almost certainly a typo for 16/5 — inserting a '1' produces it exactly.
    bands: standardBands({
      20: { deduction: 20, from: f(16, 15), to: f(4, 1), published: "16/15 - 4/1" },
    }),
  },
  {
    id: "nonrunnerstomorrow",
    url: "https://nonrunnerstomorrow.com/rule-4-deductions/",
    file: "docs/sources/rule4-nonrunnerstomorrow.txt",
    fetched: "2026-07-29",
    // Row 15 lower bound 100/30 (3.333) rather than 16/5 (3.2). Both are in
    // sequence, so this is a real disagreement rather than a typo.
    bands: standardBands({
      20: { deduction: 20, from: f(100, 30), to: f(4, 1), published: "100/30 - 4/1" },
    }),
  },
];

/**
 * What the consensus is checked against: **the table that actually settles
 * bets**, imported from src/modules/settlement/rules/rule4.ts.
 *
 * This used to be a local copy of docs/05 §5.1. A copy can drift from the
 * shipped constants silently and the gate would still pass, which would have
 * made this whole directory decorative. Now the six sources hold the real
 * settlement data to account on every run.
 */
export const IMPLEMENTED: Band[] = RULE4_TABLE.rows.map((r) => ({
  deduction: r.deduction,
  from: r.from,
  to: r.to,
  ...(r.fromExclusive === undefined ? {} : { fromExclusive: r.fromExclusive }),
  published: r.published,
}));
