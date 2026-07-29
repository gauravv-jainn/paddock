# 09 — Rule Verification Memo (O4)

**Verified:** 29 July 2026
**Scope:** the two rule tables in `docs/05` §4 and §5 that decide every payout.
**Status:** place terms **confirmed**. Rule 4 mechanics **confirmed**. Rule 4
band boundaries **disputed — one confirmed error in `docs/05`.**

---

## 1. What "verified" means here, and what it doesn't

The sources below are betting guides, settlement calculators and bookmaker
explainers. They are consistent enough to establish the shape of both tables
with confidence, and they surfaced a real defect. They are **not** the operative
document.

The authoritative text is the **Tattersalls Committee's own published Rules on
Betting**, and — more practically — **the published betting rules of the
bookmaker whose prices you settle against**. Settlement disputes are arbitrated
against those, not against a guide.

**This memo narrows the work; it does not close it.** The remaining step is to
open the published rules page of the firm supplying your odds and reconcile
§3 below against it. That is a single page read, not two hours.

---

## 2. Each-way place terms — CONFIRMED

Five independent sources agree exactly with `docs/05` §4. No changes required.

| Runners | Race type | Places | Fraction |
|---|---|---|---|
| 1–4 | any | 0 (win only) | — |
| 5–7 | non-handicap | 2 | 1/4 |
| 5–7 | handicap | 2 | 1/4 |
| 8+ | non-handicap | 3 | 1/5 |
| 8–11 | handicap | 3 | 1/5 |
| 12–15 | handicap | 3 | 1/4 |
| 16+ | handicap | 4 | 1/4 |

Sporting Life's breakdown matches row for row: <cite index="25-1">five to seven runners in a non-handicap pay 1/4 odds on first and second; eight or more in a non-handicap pay 1/5 on the first three; five to seven in a handicap pay 1/4 on two places; eight to eleven handicap runners pay 1/5 on three; twelve to fifteen pay 1/4 on three; and sixteen or more pay 1/4 on four places.</cite> KickTheBookies, grandnational.fans and placebethorseracing.com give the same table independently.

**`VERIFY:` comment to attach to the rule table:**
```
VERIFY: UK/IRE standard place terms. Confirmed against Sporting Life,
KickTheBookies, placebethorseracing.com, grandnational.fans (2026-07-29).
Pending reconciliation with the settling bookmaker's published rules.
```

### 2.1 One thing the table cannot capture

<cite index="29-1">On a handful of marquee races each season — the Grand National meeting, Cheltenham, Royal Ascot, the Ebor, the Stewards' Cup, the Lincoln — UK bookmakers commonly pay enhanced place terms of five, six, seven or eight places.</cite> These are commercial promotions, not rule changes.

**Decision required:** Phase 0 settles at standard terms only. Any historical
race in `tests/golden/` that ran under an extra-place promotion will settle
differently from the real bookmaker. Either exclude such races from the fixture
set, or add an `enhancedPlaces` override on the race and record the real terms
per fixture. **Excluding them is cheaper and is the recommendation.**

---

## 3. Rule 4 — mechanics confirmed, bands disputed

### 3.1 Mechanics — all sources agree, matches `docs/05` §5.2

- Applied to **winnings only**; <cite index="15-1">the deduction is applied to winnings only, not to stake, and is quoted in pence per pound.</cite>
- Stake always returned in full.
- Multiple withdrawals **accumulate**, and <cite index="21-1">combined deductions are capped at 90p in the pound.</cite>
- Range runs <cite index="18-1">from 5p in the pound for long-priced non-runners to 90p for odds-on favourites, with fixed steps in between and no bookmaker discretion.</cite>

### 3.2 CONFIRMED ERROR — the 2/1 band

`docs/05` §5.1 places decimal 2.76–3.25 at **35p**. Decimal 3.0 is 2/1.

Two independent sources say a 2/1 withdrawal triggers **30p**:
- <cite index="15-1">a withdrawal at 2/1 triggers a deduction of 30 pence in the pound of winnings.</cite>
- <cite index="17-1">a 2/1 withdrawal triggers a 30p in the £1 deduction.</cite>

**`docs/05` §5.1 is wrong at this row.** 2/1 is one of the most common
withdrawal prices in racing, so this would have been a recurring settlement
error, not an edge case.

### 3.3 Sources disagree with each other elsewhere

At evens (decimal 2.0), one source implies **55p** <cite index="19-1">(55 pence for evens to 5/6)</cite> while another states **50p** <cite index="20-1">(a horse withdrawn at evens triggers a 50p-in-the-pound deduction)</cite>. `docs/05` says 50p.

The same source that gives 55p at evens also omits the 85p band entirely and
appears offset by one step across the short-price range.

**Conclusion:** the secondary sources are not reliable enough to fix the band
boundaries. `docs/05` §5.1 must be replaced wholesale from a primary source, not
patched row by row.

### 3.4 Two rules `docs/05` is missing

1. **Rule 4 applies to both parts of an each-way bet.** <cite index="27-1">If a horse is withdrawn shortly before the off, a Rule 4 deduction is applied to your winnings on both the win and place parts.</cite> `docs/05` §3.3 does not say this. `settle()` must apply the deduction to the place part's winnings as well as the win part's.

2. **Early withdrawal voids rather than deducts.** <cite index="19-1">If a horse withdraws before the morning of race day, bookmakers typically void bets on that runner and reform the market — no Rule 4 applies; withdrawals on race day after betting opens trigger the deduction.</cite> `docs/05` §5.2 covers only the "bet placed after withdrawal" case. Whether a new market was formed is a settlement input the archive feed must supply, and if it cannot, those races are excluded from the fixture set.

---

## 4. What is now blocked, and on what

| Item | Status |
|---|---|
| Place terms table (`docs/05` §4) | **Ready.** Implement as written. |
| Rule 4 mechanics (`docs/05` §5.2) | **Ready**, with the two additions in §3.4 above. |
| Rule 4 band table (`docs/05` §5.1) | **Blocked.** Do not implement. Replace from the settling bookmaker's published rules. |
| Dead heat divisor (`docs/05` §6) | **Confirmed.** <cite index="27-1">When two or more horses tie for a place, the place stake is paid on a reduced fraction — places divided by the number tying.</cite> Matches the specified formula. |

**Consequence for S8.** S8 can build the place-terms table now. It must leave
the Rule 4 band table as a typed stub that throws on use, with the `VERIFY:`
comment stating it is unverified, until §3.3 is resolved.

**Consequence for S7.** Golden vectors covering Rule 4 cannot have their
expected returns computed yet. Build the fixture set in two passes: everything
except Rule 4 races first, then the Rule 4 races once the band table is settled.

---

## 5. Remaining human step

Open the published betting rules page of the firm whose prices the archive
supplies. Find the Rule 4 deduction table. Reconcile it against `docs/05` §5.1
row by row, correct the file, and fill in the `VERIFY:` comment with the URL and
today's date.

Ten minutes, one page. It is now the only thing standing between the project and
a settlement engine whose every rule has a named source.
