---
paths:
  - "src/modules/**/*.ts"
  - "src/modules/**/*.tsx"
---

# Module boundary rules

## Ownership

Each module owns its own tables. A module may only read or write tables it owns.

| Module | Owns |
|---|---|
| `identity` | users, sessions, oauth_accounts |
| `wallet` | wallets, ledger_entries |
| `catalog` | tracks, meetings, races, runners, horses, people |
| `providers` | provider_payloads |
| `betting` | bets, bet_legs |
| `settlement` | settlements |
| `analytics` | (read-only views; owns no tables) |
| `media` | stream_channels, race_streams |

## Cross-module access

Go through the owning module's exported service interface in `index.ts`.
Never import another module's schema, repository, or internal files.

```ts
// WRONG
import { ledgerEntries } from "../wallet/schema";

// RIGHT
import { walletService } from "../wallet";
```

If a module needs something another module does not expose, extend that
module's interface deliberately — do not reach around it.

## Provider vocabulary

Nothing outside `src/modules/providers/` may reference a provider-specific
field name, header, error code, or ID format. The adapter normalises; the rest
of the system speaks only the canonical domain model in
`docs/01-data-and-api-research.md` §4.2.

## New modules

Do not create a new module without asking. If a task seems to need one, say so
and stop.
