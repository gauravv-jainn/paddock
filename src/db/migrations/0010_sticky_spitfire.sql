-- Decision log D14 (docs/08-decision-log.md) — Rule 4's input is a fractional
-- price, not a decimal one.
--
-- The bands are published fractionally because the deduction is set from the
-- bookmaker's announced board price, which lives on the fractional ladder by
-- construction. withdrawn_at_odds NUMERIC(10,3) cannot even hold much of that
-- ladder exactly: 8/13 is 1.6153846..., 4/7 is 1.5714285..., 20/21 is
-- 1.9523809... Twelve of the forty-three ladder prices below are inexact at
-- this scale. That is the argument for these columns in one line.
--
-- withdrawn_at_odds is kept for display and analytics and is never read by
-- settle().

ALTER TABLE "runners" ADD COLUMN "withdrawn_at_fraction_num" integer;--> statement-breakpoint
ALTER TABLE "runners" ADD COLUMN "withdrawn_at_fraction_den" integer;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_withdrawn_fraction_complete" CHECK (("runners"."withdrawn_at_fraction_num" is null) = ("runners"."withdrawn_at_fraction_den" is null));--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_withdrawn_fraction_positive" CHECK ("runners"."withdrawn_at_fraction_num" is null or ("runners"."withdrawn_at_fraction_num" > 0 and "runners"."withdrawn_at_fraction_den" > 0));
--> statement-breakpoint

-- Backfill, exact ladder matches ONLY (D14).
--
-- The ladder is every price a fetched source actually states: the 35 band
-- boundaries of the four-source table in docs/05 section 5.1, plus the 8
-- prices appearing in the harvested worked examples. Provenance per row.
--
-- It is deliberately INCOMPLETE. A price not listed leaves the fraction NULL,
-- which means "refuse to auto-settle and flag for review" -- never "no
-- deduction". An incomplete ladder therefore errs toward refusing, which is
-- the safe direction and the point of D14's last clause.
--
-- Matching is on the decimal rounded to the column's own scale, because the
-- column cannot represent 12 of these prices any other way. Verified at
-- authoring time: no two ladder entries collide at 3 decimal places, so the
-- match is unambiguous for this ladder. Adding a price requires re-checking.
UPDATE runners r
   SET withdrawn_at_fraction_num = ladder.num,
       withdrawn_at_fraction_den = ladder.den
  FROM (VALUES
    (1, 9, 1.111),  --    1/9  boundary
    (2, 17, 1.118),  --   2/17  boundary
    (2, 11, 1.182),  --   2/11  boundary
    (1, 5, 1.200),  --    1/5  boundary
    (1, 4, 1.250),  --    1/4  boundary
    (2, 7, 1.286),  --    2/7  boundary
    (3, 10, 1.300),  --   3/10  boundary
    (1, 3, 1.333),  --    1/3  boundary
    (2, 5, 1.400),  --    2/5  boundary
    (4, 9, 1.444),  --    4/9  boundary
    (8, 15, 1.533),  --   8/15  boundary
    (4, 7, 1.571),  --    4/7  boundary
    (8, 13, 1.615),  --   8/13  boundary
    (4, 6, 1.667),  --    4/6  boundary
    (4, 5, 1.800),  --    4/5  boundary
    (5, 6, 1.833),  --    5/6  boundary
    (20, 21, 1.952),  --  20/21  boundary
    (1, 1, 2.000),  --    1/1  boundary
    (11, 10, 2.100),  --  11/10  example
    (6, 5, 2.200),  --    6/5  boundary
    (5, 4, 2.250),  --    5/4  boundary
    (6, 4, 2.500),  --    6/4  boundary
    (8, 5, 2.600),  --    8/5  boundary
    (7, 4, 2.750),  --    7/4  boundary
    (9, 5, 2.800),  --    9/5  boundary
    (2, 1, 3.000),  --    2/1  example
    (9, 4, 3.250),  --    9/4  boundary
    (12, 5, 3.400),  --   12/5  boundary
    (3, 1, 4.000),  --    3/1  boundary
    (16, 5, 4.200),  --   16/5  boundary
    (4, 1, 5.000),  --    4/1  boundary
    (9, 2, 5.500),  --    9/2  boundary
    (5, 1, 6.000),  --    5/1  example
    (11, 2, 6.500),  --   11/2  boundary
    (6, 1, 7.000),  --    6/1  boundary
    (8, 1, 9.000),  --    8/1  example
    (9, 1, 10.000),  --    9/1  boundary
    (10, 1, 11.000),  --   10/1  boundary
    (12, 1, 13.000),  --   12/1  example
    (14, 1, 15.000),  --   14/1  boundary
    (20, 1, 21.000),  --   20/1  example
    (40, 1, 41.000),  --   40/1  example
    (100, 1, 101.000)   --  100/1  example
  ) AS ladder(num, den, dec)
 WHERE r.withdrawn_at_odds IS NOT NULL
   AND r.withdrawn_at_fraction_num IS NULL
   AND r.withdrawn_at_odds = ladder.dec;
