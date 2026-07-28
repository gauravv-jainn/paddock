# 01 — Data & Provider Research

**Status:** Complete, evidence-backed
**Verdict:** The brief's assumption ("use only free APIs wherever possible") does not survive contact with the market. A working product requires either a small paid subscription, or acceptance of a delayed/historical-only data model.

---

## 1. Why this document exists first

Every other document is downstream of this one. Bet types, settlement, live odds, analytics, leaderboards and the entire UI are all functions of what the data layer can actually deliver. A platform architecture designed before the data contract is known is fiction.

**The three questions that matter:**
1. Can we get **race cards** (runners, silks, form, going, distance, class) ahead of time?
2. Can we get **odds** — and at what latency?
3. Can we get **official results** including finishing order, non-runners, dead heats, and stewards' amendments?

(3) is the one that most projects fail on. Odds are decorative; results are load-bearing. Without authoritative results you cannot settle, and without settlement you have a UI, not a product.

---

## 2. Provider landscape — verified

### 2.1 Betfair Exchange API

The single most interesting option, because Betfair's own documentation names our exact use case.

| Attribute | Finding |
|---|---|
| Delayed App Key | **Free.** Betfair's docs state the delayed key *must* be used in simulation/practice applications where betting into live markets is not available. |
| Delay | Variable, 1–180 second snapshots |
| Omissions on delayed key | No `totalMatched` traded volume, no `EX_ALL_OFFERS` via `listMarketBook` |
| Live App Key | One-off activation fee — **£299 or £499 depending on which Betfair support page you read** (the figures are inconsistent across their own docs as of mid-2026; assume £499 and treat £299 as legacy) |
| Commercial use | Requires separate approval. App key generation is stated to be for personal betting purposes only; unauthorised commercial usage is identified and blocked |
| **Geographic exclusion** | **Betfair does not accept licence applications from India, Bangladesh, Sri Lanka or the UAE** |
| Historical data | Available separately via the Betfair Historical Data Service (paid) |

**Assessment.** The delayed key is technically a legitimate fit and is free. Three problems:
- The operator is based in India, which is on the excluded list for licence applications. Delayed-key creation still requires a verified, KYC'd Betfair account.
- Commercial deployment (a public multi-user platform) is explicitly outside personal-use terms.
- 1–180s delay is fine for a paper product and arguably *more honest* than pretending to real-time.

**Recommendation:** excellent for **development and backtesting**. Not a foundation for a public launch without written approval.

### 2.2 The Racing API (theracingapi.com)

| Attribute | Finding |
|---|---|
| Positioning | Built for enthusiasts, developers and small companies; explicitly markets ML/LLM/agentic integrations |
| Coverage | Racecards, form data, live results, historical results, odds from multiple bookmakers |
| Cost | Paid subscription, low-cost tiers |
| **Blocking clause** | **Strictly prohibited for use by betting operators and sportsbooks.** Operators are directed to official regional data providers. |

**Assessment.** The most practical option on price and developer experience. The ToS clause is the risk: a paper-trading platform is arguably not a "betting operator" (no wagers, no liability, no payouts), but that is an argument, not a permission. **Get it in writing before building on it.** A one-paragraph email describing the product and asking for confirmation costs nothing and de-risks the entire foundation.

### 2.3 Podium (podiumsports.com)

Genuine industry-grade global coverage, 300+ international racecourses, REST and PUSH. Their own site notes that **multiple rights-owner agreements are needed for full coverage**. That is commercial contracting, not a signup form. Out of scope for a solo project.

### 2.4 Sportbex / OddsMatrix / Sports Game Odds / similar

B2B sportsbook feed vendors. Pricing is quote-based, sales-gated, and targeted at licensed operators. Assume four figures per month minimum. Out of scope.

### 2.5 Official / national bodies

| Body | Notes |
|---|---|
| Equibase (US) | Authoritative US data; heavily licensed, expensive, not developer self-serve |
| Racing Australia | Licensed feed, commercial terms |
| JRA (Japan) | Limited public API surface; strong official web/YouTube presence |
| HKJC (Hong Kong) | Excellent data quality, no open developer programme |
| Indian racing clubs (RWITC, BTC, etc.) | Fragmented, no API, web-only |

### 2.6 Scraping

**Rejected.** Not on squeamishness — on engineering economics. Racing sites are the most aggressively bot-defended category on the web after ticketing. Cloudflare challenges, rotating DOM, and per-meeting layout drift mean a scraper is a permanent part-time job for one person. It also unambiguously violates ToS on every major site, which forecloses ever going public or being acquired. The brief asks for production-grade decisions; scraping is the opposite.

---

## 3. Recommendation

**Phase 0 (weeks 1–4): historical replay, zero cost, zero legal exposure.**

Build the entire engine against **completed historical races**. Ingest a static dataset of past UK/IRE meetings — race cards, starting prices, official results including non-runners and dead heats. Users bet into a "replay" of a real meeting from the archive.

This is not a compromise. It is strictly better as a starting point:
- Settlement logic can be **verified against known correct outcomes**. You cannot unit-test a settlement engine against a live feed; you can test it against 200,000 historical results.
- Zero rate limits, zero ToS risk, zero latency engineering, zero cost.
- Every hard domain problem (Rule 4, dead heats, place terms, non-runners) is present in historical data and must be solved anyway.
- If the product is not compelling as a replay, live odds will not save it. This is the cheapest possible test of the core hypothesis.

**Phase 1 (weeks 5–12): live, one jurisdiction.**
Add The Racing API (pending written ToS confirmation) or Betfair delayed key for UK & Ireland only. The abstraction layer built in Phase 0 makes this an adapter swap, not a rewrite.

**Phase 2+:** additional jurisdictions, each gated on a specific licensed source. Never promise a country before the feed exists.

---

## 4. Provider abstraction layer

The brief is right that this is needed. It is wrong that it should be built speculatively for many providers. Build it for **two** (historical archive + one live provider); a two-implementation interface is genuinely abstract, a one-implementation interface is a fantasy, and a six-implementation interface written before any exist is a liability.

### 4.1 Port interface

```ts
/** All provider adapters implement this. No provider-specific types cross this boundary. */
export interface RacingDataProvider {
  readonly id: ProviderId;                  // 'archive' | 'racingapi' | 'betfair'
  readonly capabilities: ProviderCapabilities;

  listMeetings(input: { date: IsoDate; region: RegionCode }): Promise<Meeting[]>;
  getRaceCard(input: { raceRef: ProviderRaceRef }): Promise<RaceCard>;
  getOdds(input: { raceRef: ProviderRaceRef }): Promise<OddsSnapshot>;
  getResult(input: { raceRef: ProviderRaceRef }): Promise<RaceResult | null>;
  subscribeOdds?(input: { raceRef: ProviderRaceRef }): AsyncIterable<OddsSnapshot>;
}

export interface ProviderCapabilities {
  liveOdds: boolean;
  oddsLatencySeconds: number | null;   // null = unknown/undefined
  tradedVolume: boolean;
  officialResults: boolean;
  nonRunnerFeed: boolean;
  deadHeatFlags: boolean;
  stewardsAmendments: boolean;
  supportedRegions: RegionCode[];
  supportedMarkets: MarketType[];
}
```

**The `capabilities` object is the most important part of this design.** It is not documentation — it is a runtime value that the betting engine reads. If `capabilities.deadHeatFlags === false`, the settlement engine refuses to auto-settle affected races and flags them for review rather than silently settling incorrectly. If `supportedMarkets` lacks `TRIFECTA`, the UI does not render trifecta. Feature availability is derived from the data layer, never hardcoded in the frontend.

This is what actually makes provider-switching real, as opposed to an interface that compiles but produces wrong answers when swapped.

### 4.2 Canonical domain model

Normalise everything at the adapter boundary. Downstream code never sees provider vocabulary.

```ts
type MoneyMinor = bigint;          // always minor units, never float
type OddsDecimal = number;         // canonical internal form; fractional is display-only

interface Runner {
  id: RunnerId;
  raceId: RaceId;
  clothNumber: number;
  stallDraw: number | null;
  horse: HorseRef;
  jockey: PersonRef | null;
  trainer: PersonRef | null;
  weightCarriedLb: number | null;
  status: 'DECLARED' | 'NON_RUNNER' | 'WITHDRAWN' | 'RESERVE';
  withdrawnAtOdds: OddsDecimal | null;   // required input for Rule 4
}

interface RaceResult {
  raceId: RaceId;
  status: 'RESULT' | 'VOID' | 'ABANDONED' | 'POSTPONED' | 'UNDER_REVIEW';
  positions: Array<{
    runnerId: RunnerId;
    position: number;
    deadHeatWith: RunnerId[];      // empty array = no dead heat
    disqualified: boolean;
  }>;
  nonRunners: RunnerId[];
  rule4DeductionPence: number;      // 0–90, per £1
  amendedAt: string | null;         // stewards' enquiry resolution timestamp
  providerPayloadHash: string;      // determinism / replay guarantee
}
```

**Odds canonicalisation.** Store decimal internally. Fractional (`7/2`), American (`+350`) and Hong Kong formats are presentation concerns computed at render time. Storing fractional invites rounding errors that compound through settlement.

### 4.3 Resilience

| Concern | Approach |
|---|---|
| Rate limiting | Token bucket per provider, configured from provider metadata, enforced in the worker not the request path |
| Retries | Exponential backoff with jitter, capped at 3 attempts, **only for idempotent reads** |
| Circuit breaker | Open after 5 consecutive failures; degrade to cached snapshot with a visible staleness indicator in the UI |
| Caching | Race cards: cache until race start. Odds: 10–30s TTL. Results: immutable once `status === 'RESULT'` and `amendedAt` is stable for 30 minutes |
| Staleness honesty | Never render stale odds as live. A visible "delayed 3m" chip is more premium than a lie. This is a product principle, not a technical one |
| Cost control | Every outbound provider call is counted and attributed. A single runaway job must not exhaust a monthly quota |

---

## 5. Data gaps and their product consequences

| Gap | Consequence | Mitigation |
|---|---|---|
| No traded volume on Betfair delayed key | Cannot show market depth or money-flow visualisations | Drop the feature; do not fabricate |
| Historical odds hard to obtain cheaply | Closing Line Value analytics not computable | Mark CLV as Phase 3, gated on data |
| Stewards' amendments arrive late and irregularly | A settled bet may need reversal | Settlement must be reversible by design — see `05`, §7 |
| Exotic market odds (trifecta/superfecta pools) rarely in cheap feeds | Cannot price tote-style exotics accurately | Phase 2 at earliest; compute from own virtual pool instead of real dividends |

**Rule:** if the data does not exist, the feature does not ship. The brief already states this correctly ("do not fabricate live video") — apply the same discipline to odds, dividends, and statistics.
