# PaperHorse — Horse Racing Paper Trading Platform
## Documentation Set v0.1

> Working codename: **PaperHorse**. Rename before any public artefact exists.

---

## Read this first

This set contains **7 documents**, not the 20 requested. That is a deliberate decision, not an omission.

The 20-document list in the original brief includes documents that **cannot be written truthfully yet** because they depend on facts nobody has established:

| Requested doc | Why it is blocked |
|---|---|
| UI/UX Specification | Depends on what data fields actually exist in the provider payload. Writing screen specs before seeing a real racecard means designing around invented fields. |
| Component Library | Downstream of the above. |
| Design System | Can be written any time; produces zero learning; is the easiest thing to procrastinate with. Deliberately deferred to Phase 1. |
| Social System | Not in Phase 0 or 1 scope. Writing it now guarantees rework. |
| Notifications | Same. |
| Admin Panel | Same. Requires knowing what actually needs moderating. |
| Deployment / DevOps | Meaningful only once the runtime shape is proven. Stubbed in `03-system-architecture`. |
| Testing Strategy | Stubbed in `03-system-architecture`; full doc after the settlement engine has real test vectors. |

**The failure mode being avoided:** a large language model will produce twenty fluent, internally consistent, confident architecture documents built entirely on assumptions about data that has never been fetched. They will read like the output of a strong engineering org. They will be wrong in ways that are invisible until integration, at which point all twenty need rewriting. Volume of documentation is not a proxy for readiness.

**The order that works:** prove the data spine → write the specs the data supports → build → then design-system the surface.

---

## The documents

| # | Document | Status | Purpose |
|---|---|---|---|
| 01 | Data & Provider Research | **Complete, evidence-backed** | Which racing data actually exists, what it costs, what the ToS permits. This is the document that determines whether the product is possible. |
| 02 | Product Requirements | **Complete for Phase 0–1** | Scoped feature set with explicit non-goals and phase gates. |
| 03 | System Architecture & Stack | **Complete** | Runtime shape, technology choices with trade-offs, service boundaries. |
| 04 | Database Design | **Complete for Phase 0–1** | Schema, ledger model, indexing, partitioning. |
| 05 | Betting & Settlement Engine | **Complete** | The actual hard problem. Bet lifecycle, settlement rules, Rule 4, dead heats, each-way terms, non-runners. |
| 06 | Livestream Integration | **Complete** | YouTube discovery, quota economics, embeddability, fallback ladder. |
| 07 | Development Roadmap | **Complete** | Phase gates, kill criteria, realistic effort estimates. |

---

## Three findings that change the brief

### 1. There is no free global horse racing data feed
Verified. Every viable source carries either a fee, a licensing restriction, a geographic exclusion, or a terms-of-service clause that a betting-shaped product plausibly violates. Notably, Betfair's developer programme states it does not accept licence applications from India — the operator's home jurisdiction. See `01-data-and-api-research.md`.

**Consequence:** the country list (UK, US, AU, JP, HK, IN, IE, FR, ZA, UAE, SG) is not achievable. Phase 0 targets **one** jurisdiction.

### 2. YouTube livestreaming is partially viable, but not automatically
Some racetracks genuinely broadcast full live cards on their own YouTube channels — Keeneland (US) is a confirmed example. Most premium racing (UK/IRE) is paywalled behind Racing TV and Sky Sports Racing and will never be on public YouTube.

Fully automatic discovery is constrained by hard API economics: `search.list` costs 100 quota units and the default project allocation is 10,000 units/day — **100 searches per day, total, across the whole platform**, with no self-service paid upgrade. See `06-livestream-integration.md` for the design that works within this.

**Consequence:** "never require manual updates" is replaced with a curated channel registry plus cheap polling. Human curation of ~40 channels, automated resolution of thousands of races.

### 3. The hard engineering is settlement, not the interface
Each-way place terms vary by field size and handicap status. Rule 4 deductions apply when a horse is withdrawn after the market forms. Dead heats divide stakes. Non-runners void legs of multiples and reduce the leg count of accumulators. Getting these wrong is what makes a simulator feel fake — and no amount of glass blur compensates.

`05-betting-and-settlement-engine.md` is the longest document for this reason.

---

## Non-negotiable constraints carried into every document

1. **No real money.** No deposits, withdrawals, payment rails, crypto, or cash-equivalent transfer between accounts. Virtual balances are non-transferable by design, enforced at the ledger layer.
2. **Double-entry ledger.** Balances are derived, never a mutable integer column. Every credit has a matching debit.
3. **Integer minor units.** All monetary values stored as `BIGINT` cents. No floats anywhere in the money path.
4. **Provider-agnostic.** No provider-specific field names past the adapter boundary.
5. **Deterministic settlement.** Given a stored result payload, settlement must produce identical output on replay. Settlement is a pure function over persisted inputs.

---

## Open questions requiring a human decision

| # | Question | Blocking |
|---|---|---|
| Q1 | Which single jurisdiction for Phase 0? Recommendation: **UK & Ireland** (best structured data, richest bet-type vocabulary, cheapest legitimate feed). | Everything |
| Q2 | Budget ceiling for data. Is £20–50/month acceptable? If the answer is £0, the product is historical-replay only. | `01`, `07` |
| Q3 | Legal review of distribution. App-store simulated-gambling policies and the Indian online gaming regime both need a lawyer's opinion, not a developer's guess. | Public launch only |
| Q4 | Single-operator hobby project or intended commercial entity? This changes which provider ToS apply. | `01` |
