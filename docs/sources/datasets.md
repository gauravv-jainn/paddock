# Free historical results datasets — survey and recommendation

Researched 2026-07-29 under `docs/08` D20. **Nothing has been downloaded.** This
is the report-first step; the licence and field findings below come from each
dataset's own published metadata.

---

## 1. What settlement actually needs

From `docs/05` and the catalogue schema, in priority order:

| Need | Why | Consequence if absent |
|---|---|---|
| `finish_position` | every outcome | no settlement at all |
| `actual_runners` | selects the place-terms **row** (`docs/05` §4) | each-way cannot ship; `races_result_requires_actual_runners` rejects the row |
| `is_handicap` | selects the place-terms **column** | each-way pays the wrong number of places (`docs/08` D3) |
| `starting_price` | the price settled at | no returns |
| dead-heat marker | divides the stake | overpays every tied finish |
| race/meeting/track/date | identity | cannot address a race |
| non-runners, withdrawn price, Rule 4 | `docs/05` §5 | **out of scope by D20** — archive races settle at `rule4 = 0` |

---

## 2. Candidates

### 2.1 `deltaromeo/horse-racing-results-ukireland-2015-2025` — **RECOMMENDED**

Kaggle. Despite the slug, the metadata says **1988–2026**, updated to 3 June 2026.

**Licence: Community Data License Agreement – Sharing – Version 1.0.**
Permits commercial use; the share-alike obligation attaches to *publishing the
data*. D20 says ingest, do not redistribute, so the obligation does not bite —
but it is the reason `.gitignore` must keep `archive/` out of the repo.

SQLite3 `raceform.db`, one `data` table, 40 columns.

| Settlement need | Column | Status |
|---|---|---|
| finishing position | `pos` | ✅ direct |
| **runner count** | **`ran`** | ✅ **direct — no derivation** |
| starting price | `sp` | ✅ direct |
| race identity | `date`, `course`, `race_id`, `off` | ✅ direct |
| race name | `race_name` | ✅ — the handicap derivation input |
| going / distance / class | `going`, `dist`, `class`, `pattern` | ✅ |
| horse / jockey / trainer | `horse`, `jockey`, `trainer`, `age`, `sex`, `wgt` | ✅ |
| **is_handicap** | **absent** | ⚠️ **must be derived from `race_name`** |
| dead heat | absent | ⚠️ derive from duplicate `pos` within a `race_id` |
| non-runners / Rule 4 | absent | ⛔ out of scope by D20 |

`rating_band` is also present and is a plausible corroborating signal for
handicap status — a band like `0-95` implies one. **Not wired in**, because that
would be building on an assumption about a file nobody has opened yet.

### 2.2 `hwaitt/horse-racing` — rejected on licence

Kaggle, 1990–2020, ~760 MB, paired `races`/`horses` CSVs per year.

**Licence: CC BY-NC 4.0.** The author states: *"Please, do not use this data for
any commercial purposes."*

Rejected primarily on that: D20 calls this a public portfolio piece, and a
non-commercial licence forecloses the project ever becoming anything else. Two
further marks against it:

- **No runner count.** Would have to be derived by counting `horses` rows per
  `rid` — which silently miscounts if the file omits non-finishers.
- **`decimalPrice` is documented as `1/Decimal price`** — a reciprocal, not a
  price. Anything reading it as decimal odds is wrong by construction, on every
  row. Exactly the class of trap `docs/08` D14 was written about.

Also global rather than UK/IRE, so it needs filtering on `countryCode`.

### 2.3 `adamcorren/horse_racing_data_analyzer` — **DISQUALIFIED**

MIT-licensed code, but its README states it **scrapes** Sporting Life, Timeform
and Betfair Exchange, and that the data is the property of those sites.

`CLAUDE.md` hard prohibition: *"No scraping. Data comes from licensed providers
or the local archive."* The MIT licence covers the code, not the data it takes.
Not usable, at any price.

### 2.4 RacingFormBook — unresolved

Free UK/IRE results CSVs from 2016 behind a registration wall. The column list
and terms are not published on the public pages, and the download requires an
account. **Cannot be assessed without registering**, which is a decision for a
human, not something to do unprompted.

---

## 3. Recommendation

**`deltaromeo/horse-racing-results-ukireland-2015-2025`.**

1. **Licence.** CDLA-Sharing-1.0 does not foreclose commercial use; CC BY-NC does.
2. **`ran` is a real column.** It is the settlement input that `docs/08` D3 and
   D4 spent two sessions hardening, and getting it from the source rather than
   from a `COUNT(*)` removes a whole class of silent error.
3. **Scope match.** UK/IRE only, which is exactly Phase 0.
4. **Current.** Runs to June 2026.

Its one real gap is `is_handicap`, which §4 below handles by deriving it and
**refusing** where the derivation is ambiguous.

---

## 4. The `is_handicap` derivation

There is no handicap column, so it comes from `race_name`. The rules are in
`src/modules/providers/archive/import/handicap.ts`, with a unit test per rule.

| Rule | Match | Result |
|---|---|---|
| 1 | `handicap`, `h'cap`, `hcap` | **handicap** |
| 2 | `maiden`, `novice`, `stakes`, `claiming`, `selling`, `auction`, `conditions`, `group N`, `listed`, `classified`, `bumper`, `national hunt flat`, `nhf` | **not handicap** |
| 3 | anything else, including bare `nursery` | **REFUSE** |

Rule 1 is checked first, so `Novice Handicap Chase` and `Handicap Stakes`
resolve to handicap rather than being caught by rule 2.

**Bare `Nursery` refuses on purpose.** A nursery is widely described as a
two-year-old handicap, which would make it rule 1 — but that is a racing fact
this project has not sourced, and unsourced racing facts are what put a ten-row
error into `docs/05` §5.1. Almost every nursery is named `... Nursery Handicap`
and is caught by rule 1 anyway, so refusing the bare form costs little. If a
primary source confirms it, move it to rule 1 and delete this paragraph.

A refused race is **skipped with its reason recorded**, never defaulted. Same
pattern as D3 (`is_handicap` has no default), D14 (an off-ladder price refuses)
and D17 (an ambiguous withdrawal refuses).

---

## 5. Before the first download — human steps

1. **Read the licence on the dataset page itself** and save it to
   `docs/sources/licence-raceform.txt`. D20 requires the licence recorded, and
   the API metadata above is not the licence text.
2. **Confirm the 40-column schema** against the real `raceform.db`. Everything
   in §2.1 comes from the author's own description; nobody has opened the file.
   The importer will fail loudly on a column mismatch rather than guess.
3. **Keep `archive/` and `*.db` out of git.** Ingest, do not redistribute.
