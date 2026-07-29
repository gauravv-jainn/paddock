# 03 — System Architecture & Technical Stack

**Status:** Complete for Phase 0–1.

---

## 1. Architectural principle

The brief instructs: *"Never choose the fastest solution. Always choose the most scalable."*

This document does not follow that instruction, and the reason matters.

"Never choose the fastest" is an anti-instruction. Applied literally by an autonomous coding agent it reliably produces event sourcing, CQRS, a microservice mesh, a provider plugin registry, and a materialised-view layer for a system with zero users — architecture that is not more scalable, only more expensive to change. Premature abstraction is the most common cause of death for solo-built products, well ahead of insufficient scale.

**The replacement principle:** choose the simplest architecture that does not foreclose the scalable one. Specifically —

- **Foreclosing decisions** (schema shape, money representation, ledger model, provider boundary) are made carefully now, because they are expensive to reverse.
- **Non-foreclosing decisions** (hosting, queue implementation, cache vendor, CSS approach) are made for speed now, because swapping them later is a week's work.

The one place this document *does* over-engineer relative to a normal MVP is the **ledger and settlement layer**, because incorrect money history is genuinely unrecoverable.

---

## 2. Shape

Modular monolith. Two deployables.

```
┌──────────────────────────────────────────────────────────┐
│                        CLIENTS                           │
│      Web / PWA          (Phase 2: Capacitor, Tauri)      │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTPS / WebSocket
┌──────────────────────────▼───────────────────────────────┐
│  APP  (Next.js, App Router)                              │
│  ├── /app          RSC pages, streaming                  │
│  ├── /api          REST, OpenAPI-generated               │
│  └── /modules      ← the real architecture               │
│      identity · wallet · catalog · betting               │
│      settlement · analytics · media · admin              │
└──────┬───────────────────────────────────┬───────────────┘
       │                                   │
┌──────▼────────┐  ┌──────────────┐  ┌────▼─────────────────┐
│  PostgreSQL   │  │ Redis        │  │  WORKER (separate)   │
│  source of    │  │ cache, rate  │  │  ingest · odds poll  │
│  truth        │  │ limit,       │  │  settlement · media  │
│               │  │ pub/sub      │  │  discovery           │
└───────────────┘  └──────────────┘  └────┬─────────────────┘
                                          │
                              ┌───────────▼──────────────┐
                              │  PROVIDER ADAPTERS       │
                              │  archive · racing feed   │
                              │  youtube                 │
                              └──────────────────────────┘
```

**Module boundaries are enforced, deployment boundaries are not.** Each module owns its tables and exposes a typed service interface; cross-module access goes through that interface, never through another module's tables. Enforced in CI with `dependency-cruiser`. This is what makes future service extraction a refactor rather than a rewrite — and it costs nothing today.

**Why the worker is a separate deployable from day one.** Settlement and ingestion must not run on serverless request handlers. They are long-running, need durable retries, must not be duplicated across concurrent invocations, and must survive deploys mid-race. This is the one split worth paying for immediately.

---

## 3. Stack

| Layer | Choice | Why | What it costs |
|---|---|---|---|
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | Non-negotiable for a money system | — |
| Framework | Next.js (App Router) | RSC suits data-heavy racecards; one codebase for web + PWA | Vendor gravity toward Vercel |
| DB | PostgreSQL 16 (Neon or Supabase) | Transactions, partitioning, JSONB for raw payloads, `NUMERIC` where needed | — |
| ORM | Drizzle | SQL-first, real migrations, no hidden query behaviour in the money path | Smaller ecosystem than Prisma |
| Cache / bus | Redis (Upstash) | Rate limit buckets, odds cache, pub/sub for fan-out | — |
| Jobs | BullMQ on the worker | Durable, delayed jobs, retries, dead-letter. Settlement scheduling needs delayed jobs. | Requires a persistent process |
| Realtime | Server-Sent Events for Phase 0–1 | Odds are server→client only. SSE is one-way, cheap, survives proxies, no connection state to manage. | Upgrade to WS only when bidirectional need appears |
| Auth | Better Auth (or Auth.js) | Self-hosted sessions, OAuth, later passkeys/2FA. Keeps the user table in our DB — critical, because ledger FKs point at it. | More setup than Clerk |
| Styling | Tailwind + CSS custom properties | Design tokens as CSS vars enables theming and the reduced-transparency fallback in §6 | — |
| Animation | Motion (Framer Motion successor) | Spring physics, layout animation, respects `prefers-reduced-motion` natively | Bundle weight — code-split it |
| Charts | visx or uPlot | Equity curves with 10k+ points; uPlot is dramatically faster than Recharts at this size | Lower-level API |
| Validation | Zod, at every boundary | Provider payloads are untrusted input | — |
| Errors | Sentry | — | — |

### Explicitly rejected

| Rejected | Why |
|---|---|
| Electron | The brief asks for Windows/macOS/Linux desktop. A PWA covers this need at a fraction of the cost. Revisit with Tauri only if a real user asks. |
| React Native / Expo | Duplicating the UI layer before product-market fit is the single most expensive mistake available here. PWA first. |
| GraphQL | The access patterns are known and few. REST + typed client is less machinery. |
| Event sourcing (globally) | Used **only** in the ledger, where it is genuinely right. Applying it system-wide triples the code for no benefit. |
| Kubernetes | Two deployables. |
| Microservices | One developer. |

---

## 4. Critical path: bet placement

The single most correctness-sensitive flow. Everything else can be eventually consistent; this cannot.

```
POST /api/bets
  │
  ├─ 1. Authenticate; resolve user
  ├─ 2. Zod-validate payload
  ├─ 3. Idempotency check — client-supplied UUID, unique index on bets.idempotency_key
  │        duplicate → return the original bet, 200, do not re-debit
  │
  └─ 4. BEGIN TRANSACTION  (SERIALIZABLE)
       ├─ SELECT race FOR SHARE
       │    reject unless status = 'OPEN' and now() < off_time
       ├─ SELECT runner; reject if status != 'DECLARED'
       ├─ Re-fetch current odds; if moved beyond user's accepted tolerance → reject 409
       ├─ Compute balance = SUM(ledger_entries.amount_minor) WHERE wallet_id = ?
       ├─ Reject if balance < total_stake_minor
       ├─ INSERT bet (status = 'OPEN', odds_taken = <price at this instant>)
       ├─ INSERT ledger_entry (wallet,  -stake, ref = bet_id, type = 'STAKE')
       ├─ INSERT ledger_entry (house,   +stake, ref = bet_id, type = 'STAKE')
       └─ COMMIT
```

**Design notes.**

- **Balance is computed, never stored.** A `balance` column is a denormalisation that will eventually disagree with the ledger, and when it does you cannot tell which is right. If the aggregate becomes slow, add a periodically-reconciled materialised balance with the ledger remaining authoritative — but not before it is measurably slow.
- **`odds_taken` is captured at placement and frozen.** The bet settles at the price the user accepted, exactly like a real fixed-odds bet. Odds moving afterwards is information, not a settlement input.
- **`SERIALIZABLE`, not optimistic locking.** Wallet contention per user is low; correctness matters more than a few milliseconds.
- **Idempotency at the API layer.** Mobile networks retry. A double-charged stake is the fastest way to lose a user's trust permanently.

---

## 5. Settlement pipeline

```
result published (poll or webhook)
   │
   ├─ persist raw payload + sha256 hash          ← immutable, enables replay
   ├─ normalise → RaceResult
   ├─ enqueue settle_race(raceId, resultVersion)
   │
   └─ worker: settle_race
        FOR each open bet on race:
           outcome = settle(bet, result)          ← pure function, no I/O
           write settlement row + ledger entries
        idempotent on (bet_id, result_version)
```

**The settlement function is pure.** It takes a bet and a result and returns ledger entries. No database access, no network, no clock. This is what makes it exhaustively testable against historical data — see `05`, §8.

**Re-settlement on amendment.** Stewards overturn results. When `result_version` increments, the pipeline re-runs, computes the delta against prior settlement, and writes **compensating ledger entries**. It never mutates or deletes history. The user sees "Race amended — bet re-settled" with both states visible. This is why the ledger is append-only.

---

## 6. The accessibility problem with Liquid Glass — read before building the UI

The brief asks for large amounts of glass, dynamic blur, layered depth, subtle reflections, and WCAG-grade accessibility. These are in direct tension, and the tension is usually discovered late, after the design system is built.

| Problem | Reality |
|---|---|
| Contrast | Text over a translucent blurred layer has *variable* contrast depending on what is behind it. WCAG 2.2 AA requires 4.5:1 **at all times**, not on average. A racecard scrolling under a glass header will fail intermittently. |
| Performance | `backdrop-filter` is GPU-expensive and compositing cost scales with layer count and area. The 120fps target and "large amounts of glass" are not simultaneously achievable on mid-range Android. |
| Motion sensitivity | Liquid morphing and parallax trigger vestibular symptoms. `prefers-reduced-motion` is mandatory, not optional. |
| OS-level opt-out | Users can enable Reduce Transparency at the OS level. The design must have a fully-specified opaque mode, not a degraded one. |

**Required approach.**
1. Every glass surface has a **guaranteed-contrast scrim**: a solid colour layer at defined opacity beneath the blur, so contrast is computed against a known value rather than arbitrary content.
2. Glass is applied to **chrome only** — navigation, sheets, floating controls. Never to surfaces containing dense tabular data. Racecards and odds ladders sit on opaque surfaces. This is also what real premium financial software does; Bloomberg is not translucent.
3. `@media (prefers-reduced-transparency: reduce)` and `(prefers-reduced-motion: reduce)` are first-class themes with their own token set, tested in CI, not afterthoughts.
4. Budget: **maximum 3 blurred layers composited simultaneously**, enforced by review. Measure on a mid-range Android device, not a MacBook.

**Blunt version:** the aesthetic in the brief, taken literally, produces a beautiful, slow, partially-illegible app. Applied as chrome over opaque data surfaces, it produces something that genuinely feels like Apple software — because that is what Apple actually does.

---

## 7. Security (Phase 0–1 baseline)

| Control | Implementation |
|---|---|
| Session | HttpOnly, Secure, SameSite=Lax cookies; server-side sessions; rotation on privilege change |
| CSRF | Origin check + double-submit token on mutations |
| XSS | React default escaping; no `dangerouslySetInnerHTML`; strict CSP with nonces |
| SQL injection | Drizzle parameterisation only; raw SQL forbidden by lint rule outside `/db/migrations` |
| Rate limiting | Redis token bucket per IP and per user; strict limits on `/api/bets` |
| Secrets | Platform secret store; Zod-validated env schema that fails fast at boot |
| Authorization | Deny-by-default policy layer; every query scoped by `user_id` at the repository level, never at the route |
| Audit | Append-only `audit_log` for admin actions, settlement overrides, bankroll resets |

**Deliberately deferred to Phase 2:** RBAC beyond `user`/`admin`, device management, SMS, WAF, penetration testing. A two-user permission model is correct for a two-role product; building an enterprise RBAC engine now is architecture theatre.

---

## 8. Testing (summary; full document after Phase 0)

| Layer | Tool | Bar |
|---|---|---|
| Settlement | Vitest, table-driven + Stryker | **100% branch coverage AND ≥90% mutation score. Non-negotiable.** ≥200 historical races as golden vectors. See `docs/05` §8 — coverage alone proved insufficient. |
| Ledger invariants | Property-based (fast-check) | For any sequence of operations, ledger sums to zero |
| Adapters | Recorded provider fixtures | Every documented response shape, including malformed |
| Integration | Testcontainers + real Postgres | Concurrent bet placement, balance race conditions |
| E2E | Playwright | Register → bet → settle → analytics |
| Accessibility | axe-core in CI | Zero violations, including in reduced-transparency mode |
| Visual regression | Deferred to Phase 1 | Meaningless before the design system exists |

## 9. Deployment (Phase 0–1)

App on Vercel. Worker on Fly.io or Railway (needs a persistent process; serverless cannot host BullMQ). Postgres on Neon with PITR. Redis on Upstash. GitHub Actions: typecheck → lint → unit → integration → migrate → deploy. Migrations run separately from and before app deploy, and must be backward-compatible for one version to allow rollback.

Deliberately deferred: Docker, Kubernetes, multi-region, blue-green, disaster-recovery runbooks. Written when there is something to recover.
