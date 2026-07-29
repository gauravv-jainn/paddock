# Archive file format

The archive adapter reads completed historical UK & Ireland meetings from local
JSON. **You assemble these files.** The adapter will not invent a field it is
not given — every missing or malformed value is a hard error, by design
(CLAUDE.md: *no fabricated data*).

## Layout

```
<ARCHIVE_ROOT>/
  GB/
    2024-06-18.json
    2024-06-19.json
  IE/
    2024-06-19.json
```

One file per region per day. `ARCHIVE_ROOT` is passed to
`createArchiveProvider({ root })`; the ingestion command reads it from the
`ARCHIVE_ROOT` environment variable.

A race is addressed by an opaque `raceRef` of the form
`<REGION>/<YYYY-MM-DD>/<meetingRef>/<raceId>`. That structure is internal to
this adapter — nothing outside `src/modules/providers/` may parse it.

## File shape

```jsonc
{
  "region": "GB",              // must match the directory it is filed under
  "date": "2024-06-19",        // must match the filename
  "meetings": [
    {
      "meetingRef": "ascot",   // unique within the file
      "trackName": "Ascot",
      "countryCode": "GB",     // ISO-3166-1 alpha-2
      "timezone": "Europe/London",
      "going": "Good To Firm", // or null
      "status": "COMPLETED",   // SCHEDULED | IN_PROGRESS | COMPLETED | ABANDONED
      "races": [
        {
          "raceId": "1530",    // unique within the meeting
          "name": "Queen Anne Stakes",
          "offTime": "2024-06-19T14:30:00+01:00",
          "distanceYards": 1760,     // or null
          "raceClass": "1",          // or null
          "raceType": "FLAT",        // FLAT | HURDLE | CHASE | NTF | HARNESS | null
          "isHandicap": false,       // REQUIRED. See below.
          "ageBand": "4yo+",         // or null
          "prizeMinor": "56710000",  // digit STRING in minor units, or null
          "declaredRunners": 12,
          "actualRunners": 11,       // REQUIRED once status is RESULT. See below.
          "status": "RESULT",        // SCHEDULED | OPEN | SUSPENDED | OFF | RESULT | VOID | ABANDONED | POSTPONED
          "rule4DeductionPence": 0,  // 0-90, optional (defaults to 0)

          "runners": [
            {
              "id": "1",             // unique within the race
              "clothNumber": 1,
              "stallDraw": 5,                    // or null
              "horse": {
                "name": "Charyn",
                "countryCode": "IRE",            // breeding suffix, or null
                "foaledYear": 2020,              // or null
                "sex": "c",                      // or null
                "sire": null,
                "dam": null
              },
              "jockey":  { "name": "S De Sousa" },  // or null
              "trainer": { "name": "R Varian" },    // or null
              "weightCarriedLb": 133,               // or null
              "officialRating": 118,                // or null
              "status": "DECLARED",   // DECLARED | NON_RUNNER | WITHDRAWN | RESERVE
              "withdrawnAtOdds": null,// REQUIRED when status is WITHDRAWN
              "startingPrice": 4.5    // decimal, or null
            }
          ],

          "odds": {                   // optional; omit or null if not recorded
            "capturedAt": "2024-06-19T14:30:00+01:00",
            "source": "SP",
            "prices": [
              { "runnerId": "1", "marketType": "WIN", "priceDecimal": 4.5 }
            ]
          },

          "result": {                 // omit or null for a race with no result
            "status": "RESULT",       // RESULT | VOID | ABANDONED | POSTPONED | UNDER_REVIEW
            "positions": [
              {
                "runnerId": "1",
                "position": 1,
                "deadHeatWith": [],   // other runnerIds tied at this position
                "disqualified": false
              }
            ],
            "nonRunners": ["7"],
            "rule4DeductionPence": 0,
            "amendedAt": null         // ISO instant if stewards amended it
          }
        }
      ]
    }
  ]
}
```

## The three fields that are not optional metadata

**`isHandicap`** — selects the handicap or non-handicap column of the each-way
place-terms table. There is no default. A card without it is rejected, because
guessing `false` quietly pays fewer places on some field sizes.

**`actualRunners`** — the number that actually started, after non-runners. It
selects the row of the place-terms table. Required as soon as `status` is
`RESULT`. This is enforced twice: here, and by a `CHECK` constraint on `races`.

**`withdrawnAtOdds`** — the price a withdrawn horse was trading at, and the only
input from which a Rule 4 deduction can be computed. Required whenever a runner
has `status: "WITHDRAWN"`.

## Money and odds

- Money (`prizeMinor`) is a **digit string in minor units**, never a JSON
  number. JSON numbers are IEEE-754 doubles and money never touches a float.
- Odds are decimal JSON numbers greater than 1. They are multipliers only and
  never hold money. Fractional and American forms are display concerns.

## Determinism

`RaceResult.providerPayloadHash` is the sha256 of the day file exactly as read.
Re-running settlement over the same file reproduces the same hash, and editing
the file changes it — which is the point.
