# Rule 4 and place terms — source comparison

Fetched 2026-07-29. Raw material in the sibling `.txt` files.

---

## 1. What could not be obtained

**No UK bookmaker's published rules page was retrievable.** Sixteen attempts,
all blocked — full log with status codes in `BLOCKED-bookmakers.txt`. bet365,
William Hill, Paddy Power, Sky Bet, Betfred, BoyleSports, Ladbrokes and Coral
all refuse automated fetches, as do the Betfair, Sky Bet, Paddy Power and
Smarkets help centres.

WebFetch is not broken — every source below was retrieved with it the same day.
The blocking is specific to gambling operators.

**So the four-way bookmaker cross-check that was asked for did not happen.**
What follows compares six third-party guides and calculators. That is a weaker
class of evidence, and two of the six are provably wrong. Read section 4 before
using any of it.

---

## 2. Rule 4 — the comparison

Sources: **GG** geegeez · **BS** bettingsites.org.uk · **NR**
nonrunnerstodayracing · **HN** horseracingnonrunners · **RA** racingalpha ·
**OW** oddsworks. `docs/05` is the table currently in the repo.

RA and OW are decimal-primary and structurally incompatible with the other
four; they are handled in section 3 rather than shoehorned into this table.

| Withdrawn price | GG | BS | NR | HN | Agreed? | docs/05 said |
|---|---|---|---|---|---|---|
| 1/9 or shorter | 90p | 90p | 90p | 90p | ✅ | 90p |
| 2/11 – 2/17 | 85p | 85p | 85p | 85p | ✅ | 85p |
| 1/4 – 1/5 | 80p | 80p | 80p | 80p | ✅ | 80p |
| 3/10 – 2/7 | 75p | 75p | 75p | 75p | ✅ | 75p |
| 2/5 – 1/3 | 70p | 70p | 70p | 70p | ✅ | 70p |
| 8/15 – 4/9 | 65p | 65p | 65p | 65p | ✅ | 65p |
| 8/13 – 4/7 | 60p | 60p | 60p | ⚠️ corrupt | 3 of 4 | 60p |
| 4/5 – 4/6 | 55p | 55p | 55p | ⚠️ corrupt | 3 of 4 | 55p |
| 20/21 – 5/6 | 50p | 50p | 50p | 50p | ✅ | — |
| Evens – 6/5 | 45p | 45p | 45p | 45p | ✅ | **50p** ❌ |
| 5/4 – 6/4 | 40p | 40p | 40p | 40p | ✅ | **45p** ❌ |
| 8/5 – 7/4 | 35p | 35p | 35p | 35p | ✅ | **40p** ❌ |
| 9/5 – 9/4 | 30p | 30p | 30p | 30p | ✅ | **35p** ❌ |
| 12/5 – 3/1 | 25p | 25p | 25p | 25p | ✅ | **30p** ❌ |
| 16/5 – 4/1 | 20p | 20p | 20p | 20p | ✅ | **25p** ❌ |
| 9/2 – 11/2 | 15p | 15p | 15p | 15p | ✅ | **20p** ❌ |
| 6/1 – 9/1 | 10p | 10p | 10p | 10p | ✅ | **15p** ❌ |
| 10/1 – 14/1 | 5p | 5p | 5p | 5p | ✅ | **10p** ❌ |
| Over 14/1 | 0p | 0p | 0p | 0p | ✅ | 0p (>15.0) |

**17 of 19 rows are unanimous across four sources. The other two are unanimous
across three, with the fourth self-evidently corrupt** (HN repeats `8/15` as the
lower bound of two consecutive rows — see its file note).

### The finding that matters

**`docs/05` §5.1 is wrong from "Evens" upward — every band is one step too
severe.** It has no `20/21 – 5/6 → 50p` row, so everything below that point
shifts by one rung: what should be 45p it calls 50p, what should be 5p it calls
10p, and so on for ten consecutive bands.

Concretely: a £100 win bet at 4/1 with an evens horse withdrawn returns £320 on
the current table and £340 on the four-source table. Not a rounding
disagreement — £20 on a £100 bet.

Two independent worked examples confirm the four-source reading against
`docs/05`:

- OW: *"a withdrawal at 2/1 triggers a deduction of 30 pence"* — 2/1 sits in
  `9/5 – 9/4`, which the four sources put at 30p and `docs/05` puts at 35p.
- HN: *"the 6/4 joint-favourite is withdrawn… a 40p deduction"* — 6/4 sits in
  `5/4 – 6/4`, which the four sources put at 40p and `docs/05` puts at 45p.

Both examples come from sources whose own tables I do not otherwise trust, which
is what makes them useful: they were computed by someone else, and they land on
the consensus rather than on `docs/05`.

### Disagreements — not resolved here

| Row | Disagreement | Status |
|---|---|---|
| `8/13 – 4/7 → 60p` | HN's table is corrupt at this row | **Flagged.** 3 sources agree; not calling it settled on 3. |
| `4/5 – 4/6 → 55p` | HN's table is corrupt at this row | **Flagged.** Same. |
| `10/1 – 14/1 → 5p` | GG footnotes *"Not all bookmakers apply deductions at this level"* | **Flagged.** May be operator-specific, which is exactly what a bookmaker source would settle. |
| Whole table | RA and OW disagree wholesale | See section 3 |

---

## 3. The decimal problem — the most important finding here

The four agreeing sources publish **fractional** bands. `docs/05` §5.1 publishes
**decimal** bands. They are not interchangeable, and this is the root cause of
the discrepancy.

Fractional prices are discrete, so a fractional band table has **gaps** when
converted to decimal. Between `20/21` (1.952) and `Evens` (2.00) there is no
fractional price at all. The four-source table converts to:

```
… 1.83 – 1.95 → 50p        [gap 1.96 – 1.99]
   2.00 – 2.20 → 45p        [gap 2.21 – 2.24]
   2.25 – 2.50 → 40p        [gap 2.51 – 2.59]
   2.60 – 2.75 → 35p        [gap 2.76 – 2.79]
   2.80 – 3.25 → 30p        [gap 3.26 – 3.39]
   3.40 – 4.00 → 25p …
```

`docs/05` closed those gaps by extending each band upward, and in doing so
shifted every band by one rung. RA closed them differently again, extending
downward — which is why RA puts decimal 3.25 at 25p while the other four put
9/4 (= 3.25) at 30p. **A direct contradiction at an exact boundary value.**

This is not academic. Phase 0 stores `runners.withdrawn_at_odds` as
`NUMERIC(10,3)` decimal, and `docs/01` §4.2 makes decimal the canonical internal
form. A Betfair-style decimal price of 2.32 does not exist in the fractional
table at all, and each source resolves it to a different deduction.

**Consequence for S8:** the rule table must be keyed on **fractional** bands,
with an explicit, documented rule for mapping an arbitrary decimal price into
one. That decision is not mine to make and is not made here.

---

## 4. Sources that failed their own cross-check

**OW (oddsworks)** — 8 rows where every other source has 19. Puts 1/5 at 90p
(four sources: 80p), Evens at 55p (four sources: 45p), 6/1 at 0p (four sources:
10p). Contradicts its own worked example, which applies 30p to a 2/1 withdrawal
— a band absent from its table. **Table discarded; worked example retained.**

**RA (racingalpha)** — decimal bands that contradict the fractional consensus at
boundaries, and a fractional column that overlaps itself (`4/11` is both the top
of the 75p row and the bottom of the 70p row). **Table discarded; worked example
retained** (5/1 with a 3.0 non-runner at 30p, consistent with the consensus).

Both are kept in this directory. A source that is wrong is evidence about how
reliable this class of source is, and that is worth recording.

---

## 5. Each-way place terms

| Runners | Type | Places | Fraction | KTB | MBS | TRL | GNF | docs/05 §4 |
|---|---|---|---|---|---|---|---|---|
| 1–4 | any | 0 | — | ✅ | ✅ | ✅ | ✅ | ✅ agrees |
| 5–7 | any | 2 | 1/4 | ✅ | ✅ | ✅ | ✅ | ✅ agrees |
| 8+ | non-handicap | 3 | 1/5 | ✅ | ⚠️ capped at 11 | ⚠️ capped at 15 | ✅ | ✅ agrees |
| 8–11 | handicap | 3 | 1/5 | ✅ | ❌ absent | ❌ absent | ❌ absent | ✅ agrees |
| 12–15 | handicap | 3 | 1/4 | ✅ | ✅ | ❌ says 1/5 | ✅ | ✅ agrees |
| 16+ | handicap | 4 | 1/4 | ✅ | ✅ | ✅ | ✅ | ✅ agrees |

KTB kickthebookies · MBS mybettingsites · TRL theracelab · GNF grandnational.fans

**`docs/05` §4 is confirmed and needs no correction.** KickTheBookies is the
only source that splits the table by handicap status across the full range, and
it matches §4 row for row.

The other three are each incomplete in a different way — MBS caps non-handicap
at 11 runners, TRL has no handicap 12–15 row and puts 8–15 at 1/5 outright, GNF
has no handicap 8–11 row. None of them contradicts §4 on a row it actually
states, except TRL's 8–15 → 1/5.

**Flagged, not settled:** TRL is the lone dissenter on handicap 12–15. One
source against three plus `docs/05`, and its table has an acknowledged hole, so
the weight is against it — but it is recorded rather than dismissed.

The `docs/05` §4.1 rule — terms come from runners that **actually start**, not
declared — is corroborated: MBS states *"the number of places a betting site
pays is dictated by the number of horses that actually start the race, not the
number of horses listed when you placed your bet."*

---

## 6. What is still open

O4 in `docs/08` — verifying these tables against an authoritative source — is
**not closed by this document**. What changed is that `docs/05` §5.1 went from
unsourced-and-wrong to four-sources-agreeing-and-flagged. It still needs a
bookmaker's published table, or the Tattersalls Committee's own rule, to be
called verified.

The three things a bookmaker source would settle:

1. The two rows where only three of four sources agree (60p, 55p).
2. Whether the 5p band at 10/1 – 14/1 is universal or operator-specific.
3. **How an arbitrary decimal price maps into a fractional band** — the
   question in section 3, which no third-party source addresses and which S8
   cannot be written without.
