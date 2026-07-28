# PaperHorse

A paper-trading platform for horse racing. Virtual bankroll, real races, real
settlement rules, **no real money anywhere in the system**.

## Start here

1. `SESSIONS.md` — the fourteen Phase 0 sessions, in order, copy-paste ready
2. `tests/golden/README.md` — read before writing any settlement code
3. `docs/00-README.md` — index to the specification set

## What's in this repo right now

Specification and agent configuration. No application code yet — that starts
at session S1.

```
CLAUDE.md              loaded into every Claude Code session
SESSIONS.md            the Phase 0 session sequence
.claude/
  settings.json        two enforcement hooks
  rules/money.md       loads only for settlement / wallet / betting code
  rules/modules.md     loads only for module code
  commands/            /scope-check  /verify  /explain-failure
scripts/
  guard-commit.sh      blocks commits while golden vectors are red
  guard-money-path.sh  blocks float arithmetic in the money path
docs/                  the seven specification documents
tests/golden/          the grader — you assemble this, not the agent
```

## Why the hooks exist

`CLAUDE.md` and `.claude/rules/` are context, not enforcement — Claude reads
them and tries to follow them, with no guarantee. The two hooks in
`.claude/settings.json` run as shell commands at fixed lifecycle events and
apply regardless of what the model decides. A `PreToolUse` hook exiting with
code 2 blocks the tool call outright.

That is why the two rules that must never bend — no commits on red settlement
tests, no floats in the money path — are hooks rather than instructions.

## Current phase

**Phase 0 — Replay Engine.** Historical UK & Ireland races only. Email+password
auth. WIN, PLACE, EACH_WAY. Correct settlement. Basic analytics. Plain UI.

No live data. No social features. No design system. See `docs/02` for the full
non-goals list and `docs/07` for why the ordering is what it is.
