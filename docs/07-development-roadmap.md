# 07 — Development Roadmap

**Status:** Complete.
**Assumption:** one developer, working with an agentic coding tool, part-time alongside a degree, an internship, and freelance work.

---

## 1. The estimate nobody wants

The original brief, built fully, is on the order of **15–30 engineer-months** at a competent company. That is 4–8 people for six months. It includes a betting engine, a social network, an analytics suite, an enterprise admin panel, a notification platform, multi-jurisdiction data integration, and native apps on six platforms.

An agentic coding tool changes the constant factor on code production. It does not change:
- the time to obtain and validate data licences
- the time to discover that the provider's `runners` field means something different from what was assumed
- the time to find the settlement bug that only manifests on 16-runner handicaps with a non-runner
- the time to make heavy `backdrop-filter` run at 60fps on a mid-range Android
- the number of hours in a week that are not already spoken for

**Realistic single-developer estimate for the full brief: 18–36 months.** Realistic estimate for a genuinely impressive, correct, narrow product: **3–4 months.**

The roadmap below optimises for the second.

---

## 2. Phase 0 — Replay Engine (4 weeks)

**Goal:** prove that a correctly-settled paper bet on a real race feels like something.

| Week | Deliverable |
|---|---|
| **1** | Repo, TypeScript strict, Postgres + Drizzle, migrations, CI. Ledger schema with immutability triggers and the balance-invariant test. Auth: email + password only. |
| **2** | Historical archive ingestion. Racing catalogue tables populated with real UK/IRE meetings. Racecard read model. **No UI beyond raw lists.** |
| **3** | **The settlement engine.** `settle()` as a pure function. Win, Place, Each-Way. Place-terms table. Rule 4. Dead heats. Non-runners. 200 golden vectors. 100% branch coverage AND >=90% mutation score (`docs/05` §8). This week is the entire project. |
| **4** | Bet placement API with idempotency and serialisable transactions. Bet history. Basic analytics: P&L, ROI, strike rate, equity curve. A plain, well-typeset UI — no glass yet. |

**Week 3 is not negotiable and is not compressible.** Everything else in this document is replaceable; the settlement engine is the product. If week 3 slips, weeks 1, 2 and 4 were wasted.

### Gate — all must pass before Phase 1
- [ ] 200 historical races settle correctly, zero errors
- [ ] Ledger sums to zero across every wallet at every point in history
- [ ] Property tests pass, including settlement idempotence
- [ ] 5 real users, 20 bets each, no settlement dispute
- [ ] **Honest answer: is this interesting?**

**Kill criterion.** If the answer to the last question is no, stop. Four weeks and £0 spent to learn something true is a good outcome, not a failure. The alternative is six months building a beautiful interface over a product nobody wants.

---

## 3. Phase 1 — Live & Beautiful (8 weeks)

| Weeks | Deliverable |
|---|---|
| **5–6** | Provider abstraction hardening. Live adapter behind the Phase 0 port. Ingestion worker, rate limiting, circuit breaker, caching. Today's UK/IRE cards. |
| **7** | Live settlement pipeline. Result polling, `result_version` handling, re-settlement with compensating entries. Abandonment and postponement handling. |
| **8–10** | **Design system and UI.** Now the Liquid Glass work happens — after there is something worth looking at. Tokens, contrast scrims, reduced-transparency and reduced-motion themes, motion system, the racecard, the bet slip, the analytics views. |
| **11** | PWA: installable, offline bet history, push scaffolding. Google + Apple OAuth. |
| **12** | Livestream integration per doc 06. Accessibility audit. Performance budget enforcement on real mid-range Android hardware. |

**Note the ordering.** Design comes at weeks 8–10, not week 1. This will feel wrong — the design is the fun part and the part that produces something to show people. Doing it first means designing screens for data whose shape is still unknown, then rebuilding them. Doing it after Phase 0 means designing screens for data that exists, with real content, real edge cases, and real 24-runner fields that break every layout assumption.

### Gate
- [ ] 30 consecutive race days settled automatically with zero manual intervention
- [ ] Lighthouse ≥ 90 on mid-range Android
- [ ] Zero axe-core violations, including reduced-transparency mode
- [ ] Written confirmation from the data provider that the use case is permitted

---

## 4. Phase 2 — Depth (10 weeks, conditional)

Exotics with virtual pool pricing. Multiples and accumulators with correct leg-voiding. Second jurisdiction. Full analytics: profit by track / trainer / jockey / going / distance, drawdown, calendar heatmap, saved views, CSV export. Admin panel scoped to what actually needs administering.

## 5. Phase 3 — Social (conditional on an explicit decision)

Gated on doc `02`, §2. If it ships: profiles, followers, public portfolios, private leagues. **Leaderboards ranked by ROI at a minimum sample size**, never by raw profit.

## 6. Deliberately never (unless a user asks)

Native iOS and Android apps. Electron desktop. SMS notifications. Cryptocurrency anything. Real-money integration of any kind. Achievements and streaks. Eleven simultaneous jurisdictions.

---

## 7. How to actually drive the coding agent

The original master prompt has four properties that make it produce worse output:

| Problem | Fix |
|---|---|
| **Role stacking** — "You are CTO, PM, QA lead, DevOps, Security Engineer, Designer" | One role per session. Role stacking averages the personas into generic competence rather than combining their strengths. |
| **"Never choose the fastest solution"** | Replace with: *"Choose the simplest solution that does not foreclose the scalable one. Justify anything more complex than the obvious approach."* The original instruction reliably produces event sourcing and a plugin registry for a system with zero users. |
| **"Do not start coding; produce 20 documents first"** | Produce the documents the data supports, then build, then document what was built. Specification written before the first real API response is speculation with formatting. |
| **Everything in one prompt** | One document or one module per session, each with the relevant existing docs as context. A 4,000-word prompt spreads the model's attention across fifty topics; a 400-word prompt on one topic goes deep. |

### Session template that works

```
CONTEXT: [paste 01-data-and-api-research.md and 04-database-design.md]

TASK: Implement the pure settlement function for WIN, PLACE and
EACH_WAY bets as specified in 05-betting-and-settlement-engine.md §3-6.

CONSTRAINTS:
- Pure function. No I/O, no clock, no randomness.
- All money as bigint minor units. No floats anywhere.
- Every rule application recorded in the returned calculation object.
- 100% branch coverage AND a >=90% Stryker mutation score over
  `src/modules/settlement/`, every survivor recorded. Table-driven tests.
  Coverage alone is not the bar — see `docs/05` §8.

DO NOT:
- Add caching, abstraction layers, or provider handling.
- Touch the database.
- Implement bet types beyond the three named.

DELIVERABLE: settle.ts, settle.test.ts, and a list of every
assumption you had to make.
```

Narrow scope, explicit constraints, explicit prohibitions, and a request for assumptions. That last line is the highest-value sentence in the prompt — it surfaces the places where the model filled a gap, which is exactly where the bugs will be.

---

## 8. Weekly discipline

- **One gate per phase, checked honestly.** A gate that is waived is not a gate.
- **The settlement regression suite runs on every commit.** If it is red, nothing else ships.
- **Ledger reconciliation runs daily in production** from day one. Two lines of SQL, catches an entire bug class.
- **Track hours actually worked, not planned.** The estimates above assume roughly 15 hours per week. If the real number is 6, multiply everything by 2.5 and re-plan rather than slipping silently.
