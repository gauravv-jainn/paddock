# Rule 4 band table — evidence per row

Layer 4 of `docs/08` D20. Runs with `pnpm test`; a row below the threshold
fails the build and prints the competing values.

Threshold: **≥3 independent sources per row.** Six sources encoded, each
transcribed from a verbatim capture in `docs/sources/rule4-*.txt`.

## Why this exists

D20's layers 2 and 3 cannot see a wrong constant. Metamorphic properties hold
for any internally-consistent table, right or wrong — the ten-row error found
earlier was uniformly shifted and therefore still monotonic, so **none of the
nine properties would have caught it**. Differential implementation is worse:
two implementations reading the same wrong table agree perfectly.

Only evidence catches a wrong number. Before this, that evidence was a one-off
cross-check in a markdown file that nothing enforced and nothing re-ran.

## Per-row evidence

`sources` = published tables agreeing with `docs/05` §5.1.
`computed` = third-party worked examples that state a number for this band —
either a total return (usable as a golden vector) or a stated deduction.

| # | Band | Deduction | Sources | Computed | Where |
|---|---|---|---|---|---|
| 1 | 1/9 or shorter | 90p | 6/6 | **0** | — |
| 2 | 2/11 – 2/17 | 85p | 6/6 | **0** | — |
| 3 | 1/4 – 1/5 | 80p | 6/6 | **0** | — |
| 4 | 3/10 – 2/7 | 75p | 6/6 | **0** | — |
| 5 | 2/5 – 1/3 | 70p | 6/6 | **0** | — |
| 6 | 8/15 – 4/9 | 65p | 6/6 | **0** | — |
| 7 | 8/13 – 4/7 | 60p | 5/6 | **0** | horseracingnonrunners corrupt |
| 8 | 4/5 – 4/6 | 55p | 5/6 | **0** | horseracingnonrunners corrupt |
| 9 | 20/21 – 5/6 | 50p | 6/6 | **0** | — |
| 10 | Evens – 6/5 | 45p | 6/6 | 1 | racing-index (deduction) |
| 11 | 5/4 – 6/4 | 40p | 6/6 | 1 | pub-r4-004 (return) |
| 12 | 8/5 – 7/4 | 35p | 6/6 | 1 | racing-index (deduction) |
| 13 | 9/5 – 9/4 | 30p | 6/6 | 2 | pub-r4-003, pub-r4-007 (returns) |
| 14 | 12/5 – 3/1 | 25p | 6/6 | 3 | pub-r4-006, pub-r4-008, pub-r4-009 (returns) |
| 15 | 16/5 – 4/1 | 20p | **4/6** | 1 | racing-index (deduction) |
| 16 | 9/2 – 11/2 | 15p | 6/6 | 2 | pub-r4-006 (return), racing-index (deduction) |
| 17 | 6/1 – 9/1 | 10p | 6/6 | **0** | — |
| 18 | 10/1 – 14/1 | 5p | 6/6 | 2 | pub-r4-005, pub-r4-009 (returns) |
| 19 | over 14/1 | 0p | 6/6 | **0** | — |

**8 of 19 bands have a third-party computed number.** Up from 5 before this
session: rows 10, 12 and 15 are new.

## The weakest rows

**Row 15 (20p) — weakest overall, 4/6 sources.** The only genuine three-way
split in the table:

| Value | Sources | In sequence? |
|---|---|---|
| **16/5** (3.2) ← implemented | geegeez, bettingsites, nonrunnerstoday, horseracingnonrunners | yes |
| 100/30 (3.333) | nonrunnerstomorrow | yes |
| 16/15 (1.067) | racing-index | **no** — below the 12/5 that opens the band above it |

**Rows 1–9 — table consensus, zero computed evidence.** The odds-on bands, and
the most severe deductions in the table. No guide anywhere uses an odds-on
withdrawal as its teaching example, because it is rare. So the rows that move
the most money are the ones no third party has ever computed for us.

**Rows 17 and 19** — 6/6 on the table, no computed number. Row 19 is the "no
deduction" band, so the exposure is small; row 17 (10p) is a real gap.

## What this cannot see

Six guides agreeing may be six copies of one wrong original. Consensus measures
**agreement**, not **truth**, and nothing here distinguishes them. O4 — read one
bookmaker's published table — remains the only thing that would.
