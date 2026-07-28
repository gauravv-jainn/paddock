---
description: Audit the working diff for scope creep and out-of-scope work
allowed-tools: Bash, Read, Grep, Glob
---

Review the current uncommitted diff (`git diff` and `git status`).

Report, as a plain list:

1. Every file touched that lies outside the module named in this session's task.
2. Every item that appears on the "What NOT to build" list in `CLAUDE.md`.
3. Every new dependency added to `package.json`.
4. Every new abstraction — interface, factory, registry, config layer, cache —
   that the task did not explicitly require.
5. Any use of `number` or float arithmetic in `src/modules/settlement/`,
   `src/modules/wallet/`, or `src/modules/betting/`.

If all five are empty, say "clean" and nothing else.

Do not fix anything. Report only.
