# 02 — Product Requirements

**Status:** Complete for Phase 0–1. Phases 2–3 are intentionally sketched, not specified.

---

## 1. Product statement

A paper-trading platform for horse racing. Users receive a virtual bankroll, place simulated wagers on real races, and are settled against real results using real bookmaking rules. The product's value is the accuracy of the simulation and the quality of the analytics — not the excitement of the wager.

**One-line positioning:** *A trading journal that happens to run on horses.*

## 2. The tension in the original brief, stated plainly

The brief asks for two things that pull against each other:

- **Calm, premium, Bloomberg-terminal restraint.** Anti-casino, anti-neon, anti-fake-excitement.
- **Leaderboards, challenges, achievements, friend activity, live odds, streaks.**

The second list is the engagement architecture of a social casino. Restrained typography does not change what a mechanic teaches. If this product is genuinely for people who want to test staking strategies and read equity curves, the leaderboard is at best noise and at worst the feature that redefines the product as a game.

**This document resolves the tension by phase-gating the social layer behind a working analytics product**, so the decision is made with evidence rather than assumption. If the analytics are compelling on their own, competitive features are optional. If they are not, no leaderboard will rescue them.

This is a product judgement, and it is reversible. It is recorded here so it is a choice rather than a drift.

---

## 3. Users

**Primary — the Strategist.** Has a staking or selection method. Wants to know if it works before risking money. Cares about ROI, drawdown, sample size, closing line value. Will forgive an ugly screen; will abandon over an incorrect settlement.

**Secondary — the Learner.** Interested in racing, does not understand the bet types. Wants to learn each-way, place terms, and exotics without losing money. Cares about clarity and explanation.

**Explicitly not the target — the Thrill-Seeker.** Wants the sensation of gambling without cost. Serving this user well requires exactly the casino patterns the brief rejects. Designing for them will produce a worse product for both groups above.

## 4. Phase 0 — Replay Engine (target: 4 weeks)

**Hypothesis under test:** does a correctly-settled paper bet on a real race feel meaningful?

### In scope
| ID | Requirement |
|---|---|
| P0-01 | Email + password auth, session management. Nothing else. |
| P0-02 | Single virtual wallet per user, £100,000 opening balance, double-entry ledger |
| P0-03 | Ingest historical UK/IRE meetings from static archive |
| P0-04 | Browse meetings → race card → runner list with form, draw, weight, jockey, trainer |
| P0-05 | Place bets: **Win, Place, Each-Way** only |
| P0-06 | Correct settlement: finishing order, non-runners, dead heats, Rule 4, each-way place terms |
| P0-07 | Bet history with settled state and full settlement audit trail |
| P0-08 | Core analytics: P&L, ROI, strike rate, average odds, equity curve |
| P0-09 | Web responsive. One codebase. |

### Explicitly out of scope
Live data. Live odds. Streaming. Social. Leaderboards. Exotics. Multiples. Push notifications. Admin panel. Mobile apps. Desktop apps. OAuth. Passkeys. 2FA. Multi-currency. Achievements. Any country outside UK/IRE.

### Exit criteria (all must pass)
1. Settlement engine passes a regression suite of **≥200 historical races** including at least 10 dead heats, 10 Rule 4 races, and 20 races with non-runners, with **zero** incorrect settlements.
2. Ledger invariant holds: sum of all entries = 0, for every user, at every point in history.
3. Five real users complete ≥20 bets each without reporting a settlement dispute.
4. Answer honestly: is this interesting? If no, stop. That is a successful £0 outcome, not a failure.

---

## 5. Phase 1 — Live (target: +8 weeks)

| ID | Requirement |
|---|---|
| P1-01 | Live provider adapter behind the Phase 0 port |
| P1-02 | Today's UK/IRE racecards, auto-refreshing |
| P1-03 | Odds with **explicit latency disclosure** — never present delayed as live |
| P1-04 | Automatic settlement on result publication, with reversal path for stewards' amendments |
| P1-05 | Bet cancellation window: cancellable until the market is suspended, never after |
| P1-06 | Abandoned/postponed race handling: void and refund |
| P1-07 | Google + Apple OAuth |
| P1-08 | PWA: installable, offline-readable bet history |
| P1-09 | Design system pass — this is where the Liquid Glass work belongs |
| P1-10 | Livestream embedding per `06-livestream-integration.md` |

### Exit criteria
Live settlement matches official results for 30 consecutive race days with zero manual intervention required.

---

## 6. Phase 2 — Depth (sketch)

Exotics (Exacta, Trifecta, Quinella) with **virtual pool pricing**, since real dividends are unavailable at this budget. Multiples and accumulators with correct non-runner leg-voiding. Second jurisdiction. Full analytics suite: profit by track / trainer / jockey / going / distance, calendar heatmap, drawdown analysis, CSV export.

## 7. Phase 3 — Social (sketch, conditional)

Gated on Phase 1 exit criteria **plus** an explicit decision on §2. If it ships: profiles, followers, public portfolios, private leagues. Leaderboards ranked by **ROI at minimum sample size**, never by raw profit — ranking by profit rewards reckless staking and teaches exactly the wrong lesson, which is the failure mode of every social betting product.

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Correctness | Settlement is the product. A wrong settlement is a P0 incident. |
| Determinism | Replaying stored provider payloads reproduces identical settlements, byte for byte |
| Auditability | Every ledger entry traceable to a bet, a settlement, and a source payload hash |
| Latency | Racecard p95 < 400ms. Bet placement p95 < 200ms. |
| Availability | 99.5% Phase 0–1. Racing is not 24/7; maintenance windows are cheap. |
| Accessibility | WCAG 2.2 AA. Non-negotiable, and materially harder with heavy glass/blur — see `03`, §6. |
| Money handling | Integer minor units end to end. No float in the money path. Enforced by lint rule. |

## 9. Hard product constraints

1. No real money in, out, or between accounts. Balances non-transferable at the ledger layer.
2. No mechanism that converts virtual balance into anything of value.
3. Age gate and jurisdiction disclosure before public launch, pending legal advice.
4. No loss-chasing mechanics: no "double your last stake" shortcut, no loss-triggered bonuses, no top-up-on-bust without a cooldown.
5. Bankroll reset is available, logged, and resets analytics history to a new tracked period — so the equity curve cannot lie.
