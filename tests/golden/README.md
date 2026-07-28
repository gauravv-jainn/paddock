# Golden vectors — the grader

**This directory is the only thing in the project that can tell you the truth.**

Everything else — the code, the tests the model wrote, the confident summary at
the end of a session — is an opinion. Settlement code that is wrong compiles,
passes self-authored tests, and reads perfectly. The only way to catch a
place-terms band error or an inverted Rule 4 is to check the output against
races whose real settlements you obtained independently.

---

## Rule zero

**Do not ask Claude Code to generate these fixtures.**

A model grading itself against fixtures it invented tells you only that it is
internally consistent. It will happily produce 200 races whose "expected"
returns were computed by the same misunderstanding that is about to go into
`settle()`, and every test will pass.

Assemble them yourself, from real historical results.

Claude Code may:
- write the loader and the test harness
- convert a CSV you supply into this JSON shape
- report which vectors fail

Claude Code may not:
- invent races
- invent expected returns
- edit a fixture to make a test pass

If a fixture and the code disagree, one of them is wrong and **you** decide which.

---

## Required composition

Minimum 200 races. Boundary cases are where the bugs live — test 15 and 16
runners, not 14 and 20.

| Category | Minimum |
|---|---|
| Clean races, no complications | 100 |
| Dead heats (incl. ≥1 three-way, ≥1 for the final paid place) | 10 |
| Rule 4 deductions (incl. ≥1 with multiple withdrawals) | 10 |
| Non-runners (incl. ≥3 that change the place-terms band) | 20 |
| Post-race disqualifications | 5 |
| Abandoned / voided races | 5 |
| Bets placed *after* a withdrawal (Rule 4 must NOT apply) | 5 |

**Field sizes that must all appear, handicap and non-handicap:**
4, 5, 7, 8, 11, 12, 15, 16.

Those are the exact boundaries of the place-terms table in
`docs/05-betting-and-settlement-engine.md` §4.

---

## Fixture format

`races.json`:

```json
[
  {
    "id": "2024-06-19-ascot-1530",
    "source": "https://example-results-source/...",
    "verifiedBy": "gj",
    "verifiedOn": "2026-08-03",
    "race": {
      "declaredRunners": 16,
      "actualRunners": 15,
      "isHandicap": true,
      "raceType": "flat",
      "rule4Pence": 0,
      "status": "RESULT"
    },
    "runners": [
      {
        "clothNumber": 7,
        "status": "DECLARED",
        "startingPrice": 9.0,
        "finishPosition": 3,
        "deadHeatCount": 1,
        "disqualified": false
      },
      {
        "clothNumber": 11,
        "status": "NON_RUNNER",
        "withdrawnAtOdds": null,
        "finishPosition": null
      }
    ],
    "expected": [
      {
        "note": "EW on #7. Field dropped to 15 so terms are 3 places at 1/4, not 4 places.",
        "bet": {
          "type": "EACH_WAY",
          "clothNumber": 7,
          "unitStakeMinor": "1000",
          "oddsTaken": 9.0
        },
        "expectedReturnMinor": "3000",
        "expectedStatus": "PARTIAL"
      }
    ]
  }
]
```

**Notes on the shape.**

- All monetary values are **strings** in the JSON so they survive parsing into
  `bigint` without passing through a float. `JSON.parse` on `3000` gives you a
  `number`; on `"3000"` you can do `BigInt(v)` safely.
- `source` and `verifiedOn` are not decoration. When a vector and the code
  disagree in month four, you need to know where the number came from.
- `note` is what you will read when a test goes red at 1am. Write it for
  that moment.
- One race may carry several `expected` entries — the same result settles
  differently for WIN, PLACE and EACH_WAY, and covering all three from one
  race is cheap.

---

## The worked example to start with

Before assembling 200, hand-compute these four and confirm the engine agrees.
If it fails any of them, it will fail the other 196.

| # | Scenario | Expected |
|---|---|---|
| 1 | £10 WIN at 5.0, clean win | 5000 minor |
| 2 | £10 WIN at 5.0, **two-way dead heat for 1st** | 2500 minor — not 4000 |
| 3 | £10 PLACE at 9.0, 3 places at 1/5, finished 2nd | 2600 minor — `(9.0−1)×0.2+1 = 2.6`, not `9.0×0.2` |
| 4 | £10 WIN at 5.0, Rule 4 of 25p | 4000 minor — deduction hits winnings only, stake returned whole |

Case 3 is the one amateur implementations get wrong most often, and case 2 is
the one users notice fastest.

---

## Where to source results

Historical racecards and results with non-runners, SPs and dead heats flagged
are available from the paid archive tiers discussed in
`docs/01-data-and-api-research.md` §2.2. Twelve years of historical results
is the cheapest legitimate route.

Whatever you use, record it in `source`. "I found it somewhere" is not a
provenance you can act on later.
