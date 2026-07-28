---
description: Run the full correctness gate and report honestly
allowed-tools: Bash, Read
---

Run, in order, and report the raw result of each:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm test:settlement`

Then report:

- Branch coverage on `src/modules/settlement/` — the bar is 100%.
- Any golden vector in `tests/golden/` that is failing, with expected vs actual.
- Whether the ledger property test ran and passed.

Do not fix anything in this command. Do not describe failures as minor.
If something is red, say it is red.
