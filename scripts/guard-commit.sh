#!/usr/bin/env bash
# PreToolUse / Bash hook.
# Blocks `git commit` while the settlement regression suite is red.
# Exit 2 = block the tool call. Exit 0 = allow. Exit 1 = warn only.
#
# docs/08 O10: this used to gate on tests/golden/races.json, which docs/08 D20
# retired and which was never assembled. The gate therefore exited 0 on every
# commit for the whole project — it warned about a missing file instead of
# running anything. It now gates on the graders that actually exist.
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

# The grader. docs/08 D20 replaced hand-computed vectors with third-party
# published ones; this is the file that must exist for a commit to be graded.
if [ ! -s "$ROOT/tests/golden/published.json" ]; then
  echo "BLOCKED: tests/golden/published.json is missing or empty." >&2
  echo "The settlement engine has no independent grader. See docs/08 D20 and" >&2
  echo "tests/golden/README.md." >&2
  exit 2
fi

# pnpm test:settlement covers src/modules/settlement, tests/golden and
# tests/consensus — the rule tables, the published vectors that grade them, and
# the six-source consensus on the band table.
if ! (cd "$ROOT" && pnpm test:settlement) > /tmp/paperhorse-settlement.log 2>&1; then
  echo "BLOCKED: the settlement regression suite is failing." >&2
  echo "Commits are not permitted while the graders are red." >&2
  echo "--- last 25 lines ---" >&2
  tail -25 /tmp/paperhorse-settlement.log >&2
  exit 2
fi

exit 0
