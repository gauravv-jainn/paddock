---
description: Diagnose a failing golden vector before any code changes
allowed-tools: Read, Grep, Glob, Bash
---

A golden vector is failing: $ARGUMENTS

Do not change any code yet.

Work through this in order and show your reasoning:

1. Restate the race: field size, handicap status, non-runners, withdrawals,
   dead heats, finishing position of the backed runner.
2. Name the settlement rule that governs the expected value, and quote the
   relevant section of `docs/05-betting-and-settlement-engine.md`.
3. Compute the expected return by hand, step by step, showing every
   intermediate value.
4. State exactly which step in `settle()` diverges, and why.
5. Only then propose a fix — and state whether the bug is in the code, in the
   rule table, or in the fixture itself.

If you cannot explain the discrepancy in terms of a named rule, say so and stop.
A fix without an explanation is a patch over a misunderstanding.
