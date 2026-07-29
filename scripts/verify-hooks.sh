#!/usr/bin/env bash
# Reports whether the hooks in .claude/settings.json are actually firing.
#
# docs/08 D22. The two guards are described in README.md as rules that "apply
# regardless of what the model decides". That claim is only true if the harness
# invokes them, and for the whole of this project it did not — a file
# containing .toFixed( was written into src/modules/settlement/ unblocked, and
# a commit went through with a deliberately broken vector.
#
# The SessionStart hook is a canary: it appends a line at the start of every
# session. If this log has lines, hooks are registered and firing. If it is
# empty or missing, they are not, and no amount of fixing the scripts helps.
#
#   ./scripts/verify-hooks.sh
set -uo pipefail

LOG="/tmp/paperhorse-hooks.log"
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

echo "PaperHorse hook check"
echo "====================="
echo

# ---------------------------------------------------------------- the canary
if [ -s "$LOG" ]; then
  lines=$(wc -l < "$LOG" | tr -d ' ')
  echo "CANARY: FIRING — $lines session start(s) recorded"
  echo "  most recent: $(tail -1 "$LOG")"
  echo "  -> hooks are registered. The guards below are ENFORCED."
  canary=0
else
  echo "CANARY: SILENT — $LOG is missing or empty"
  echo "  -> hooks are NOT firing. The guards below are ADVISORY ONLY."
  echo "  -> Run /hooks in an interactive \`claude\` session to check registration."
  echo
  echo "  NOTE: the canary can only fire at the START of a session. If it was"
  echo "  added during this one, it will stay silent until the next session"
  echo "  begins. Silence here is not yet proof of failure — it is proof of"
  echo "  'not yet observed'."
  canary=1
fi

echo
echo "--- the guards themselves, run directly ---"

# ------------------------------------------------- money path, dirty payload
dirty='{"tool_input":{"file_path":"src/modules/settlement/probe.ts","content":"const f=(n:number)=>n.toFixed(2);"}}'
printf '%s' "$dirty" | bash "$ROOT/scripts/guard-money-path.sh" >/dev/null 2>&1
if [ $? -eq 2 ]; then
  echo "money-path  BLOCKS a float in the money path        (exit 2) OK"
else
  echo "money-path  FAILED TO BLOCK a float                          BROKEN"
fi

# ------------------------------------------------- money path, clean payload
clean='{"tool_input":{"file_path":"src/modules/settlement/probe.ts","content":"const f=(n:bigint)=>n*2n;"}}'
printf '%s' "$clean" | bash "$ROOT/scripts/guard-money-path.sh" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "money-path  ALLOWS clean bigint code                (exit 0) OK"
else
  echo "money-path  BLOCKED clean code                               BROKEN"
fi

# ------------------------------------------------------------- commit guard
if [ -s "$ROOT/tests/golden/published.json" ]; then
  echo "commit      grader present (tests/golden/published.json)      OK"
else
  echo "commit      grader MISSING — guard will block every commit"
fi

echo
if [ "$canary" -eq 0 ]; then
  echo "VERDICT: enforced."
else
  echo "VERDICT: advisory. The scripts are correct; nothing is invoking them."
  echo "         CLAUDE.md and README.md must not claim otherwise until the"
  echo "         canary fires. See docs/08 D22."
fi

exit 0
