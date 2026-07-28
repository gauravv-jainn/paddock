#!/usr/bin/env bash
# PreToolUse / Bash hook.
# Blocks `git commit` while the settlement regression suite is red.
# Exit 2 = block the tool call. Exit 0 = allow. Exit 1 = warn only.
set -uo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | python3 -c \
  'import sys,json;print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' \
  2>/dev/null || true)"

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Week 1: no fixtures yet. Warn loudly, do not block.
if [ ! -s "$ROOT/tests/golden/races.json" ]; then
  echo "WARNING: tests/golden/races.json is missing or empty." >&2
  echo "The settlement engine has no independent grader yet." >&2
  echo "See tests/golden/README.md before writing settlement code." >&2
  exit 0
fi

if ! (cd "$ROOT" && pnpm test:settlement) > /tmp/paperhorse-settlement.log 2>&1; then
  echo "BLOCKED: the settlement regression suite is failing." >&2
  echo "Commits are not permitted while golden vectors are red." >&2
  echo "--- last 25 lines ---" >&2
  tail -25 /tmp/paperhorse-settlement.log >&2
  exit 2
fi

exit 0
