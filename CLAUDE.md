# PaperHorse — Horse Racing Paper Trading Platform

<!-- Keep this file under 200 lines. It loads into context every session. -->
<!-- Do NOT @import the /docs set here — 1600 lines would load every launch. -->
<!-- Reference doc paths in backticks so Claude reads them on demand only. -->

## What this is

A paper-trading platform for horse racing. Users get a virtual bankroll, place
simulated bets on real races, and are settled against real results using real
bookmaking rules. **No real money exists anywhere in this system.**

The product is the accuracy of the settlement engine. Everything else is
replaceable.

## Specification documents

Read these on demand — do not assume their contents:

| Topic | File |
|---|---|
| Provider research, ToS constraints | `docs/01-data-and-api-research.md` |
| Scope, phases, non-goals | `docs/02-product-requirements.md` |
| Architecture, stack, trade-offs | `docs/03-system-architecture.md` |
| Schema, ledger, indexes | `docs/04-database-design.md` |
| **Settlement rules — read before touching money code** | `docs/05-betting-and-settlement-engine.md` |
| YouTube streams | `docs/06-livestream-integration.md` |
| Phase plan | `docs/07-development-roadmap.md` |

## Commands

```bash
pnpm dev              # app
pnpm worker           # background worker (separate process)
pnpm test             # vitest
pnpm test:settlement  # golden-vector regression — MUST be green before any commit
pnpm typecheck        # tsc --noEmit
pnpm lint
pnpm db:generate      # drizzle migration from schema
pnpm db:migrate
```

## Non-negotiable rules

1. **Money is `bigint` minor units.** Never `number`, never `float`, never
   `parseFloat` in the money path. If you need a ratio, use it as a multiplier
   on a bigint and round once at the end.
2. **The ledger is append-only.** No UPDATE, no DELETE on `ledger_entries`.
   Corrections are compensating entries.
3. **Balance is derived** with `SUM(amount_minor)`. Never add a `balance` column.
4. **`settle()` is a pure function.** No I/O, no `Date.now()`, no randomness,
   no database access. Inputs in, ledger entries out.
5. **Every economic transaction balances to zero** across its ledger entries.
6. **Provider vocabulary stops at the adapter.** Nothing downstream of
   `src/modules/providers/` may reference a provider-specific field name.
7. **All timestamps are `TIMESTAMPTZ`.** Racing crosses time zones and DST.

## Architecture

Modular monolith. Two deployables: Next.js app, and a separate worker process.

```
src/modules/
  identity/     auth, sessions, users
  wallet/       ledger, balances
  catalog/      tracks, meetings, races, runners, horses, people
  providers/    adapters + the RacingDataProvider port
  betting/      bet placement, validation, idempotency
  settlement/   settle() and the rule tables    ← the product
  analytics/    P&L, ROI, equity curve
  media/        YouTube discovery and embedding
```

**Modules own their tables.** Cross-module access goes through the module's
exported service interface, never by querying another module's tables directly.

## Workflow rules

- **Use plan mode for anything touching `src/modules/settlement/`,
  `src/modules/wallet/`, or database migrations.** Show me the plan first.
- **One module per session.** Do not touch files outside the module named in
  the task without asking.
- **Do not add dependencies without asking.**
- **Do not create abstraction layers, plugin registries, caching, or
  configuration systems that the current task does not require.** If you think
  one is needed, say so and wait — do not build it speculatively.
- **End every task with a list of assumptions you had to make.** This is
  required output, not optional.
- **Never mark work complete on the basis of tests you wrote yourself passing.**
  Settlement correctness is measured against `tests/golden/` fixtures only.

## What NOT to build

Do not implement any of the following unless the task explicitly names it.
They are out of scope for the current phase and adding them is a defect:

- Social features, leaderboards, followers, leagues, challenges, achievements
- Admin panel, RBAC beyond `user`/`admin`, feature flags
- Notifications of any kind
- Bet types beyond WIN, PLACE, EACH_WAY
- Any jurisdiction other than UK & Ireland
- Live data (Phase 0 is historical replay only)
- Native mobile apps, Electron, Tauri
- Event sourcing outside the ledger, CQRS, microservices, message buses
- Multi-currency accounting (display conversion only, USD base)

## Hard prohibitions

- **No real money.** No payment gateways, no deposits, no withdrawals, no
  crypto, no balance transfer between users. If a task appears to ask for one,
  stop and ask.
- **No scraping.** Data comes from licensed providers or the local archive.
- **No fabricated data.** If a feed does not supply a field, the feature does
  not ship. Never generate plausible-looking odds, dividends, or results.
- **No `dangerouslySetInnerHTML`.**
- **No raw SQL outside `src/db/migrations/`.**

## Domain vocabulary

| Term | Meaning |
|---|---|
| Non-runner | Declared horse that does not start. Bets on it are VOID. |
| Rule 4 | Deduction from **winnings** when a horse is withdrawn late. |
| Each-way | Two equal bets: one win, one place. Stake is `2 × unit`. |
| Place terms | Places paid and odds fraction — a function of **actual** runners and handicap status. |
| Dead heat | Tied finish. Stake divided by `tied ÷ positions available`. |
| SP | Starting Price — the price at the off. |
| Going | Ground condition (firm, good, soft, heavy). |

## Current phase

**Phase 0 — Replay Engine.** Historical UK/IRE races only. Email+password auth.
WIN, PLACE, EACH_WAY. Correct settlement. Basic analytics. Plain UI.

**No design system work yet.** Glass, motion, and the visual language come in
Phase 1 weeks 8–10, after the data shapes are known.
