#!/usr/bin/env bash
# The verification pipeline, with every exit code actually checked.
#
#   ./scripts/verify.sh          full gate
#   ./scripts/verify.sh --fast   skip mutation testing (~2 minutes faster)
#
# WHY THIS EXISTS. `pnpm lint 2>&1 | tail -2` reports tail's exit status, not
# lint's. A real lint failure sailed through a && chain because of exactly
# that, and it was the THIRD check in this project found to be checking
# nothing — after the append-only trigger tests that ran against an empty
# table, and the commit hook that gated on a file docs/08 D20 had retired.
#
# So: no pipes around anything whose status matters. Output goes to a log and
# is tailed only on failure, after the status has been captured.
set -uo pipefail

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$(mktemp -d)"
FAILED=0
declare -a RESULTS=()

run() {
  local label="$1"; shift
  local log="$LOG_DIR/${label// /_}.log"
  printf '  %-26s ' "$label"
  # No pipe. The status below is the command's own.
  if "$@" >"$log" 2>&1; then
    printf 'PASS\n'
    RESULTS+=("PASS  $label")
  else
    local code=$?
    printf 'FAIL (exit %d)\n' "$code"
    RESULTS+=("FAIL  $label (exit $code)")
    FAILED=1
    echo "    --- last 15 lines ---"
    tail -15 "$log" | sed 's/^/    /'
  fi
}

echo "PaperHorse verification"
echo "======================="
echo

run "typecheck"            pnpm typecheck
run "lint"                 pnpm lint
run "test"                 pnpm test
run "build"                pnpm build

if [ "$FAST" -eq 0 ]; then
  # docs/08 D24. Gate A is the payout-deciding one and breaks at <100%.
  # Gate B is not score-gated; it runs for its report only.
  run "mutation gate A"    pnpm mutation:a
  run "mutation gate B"    pnpm mutation:b
else
  RESULTS+=("SKIP  mutation (--fast)")
fi

echo
echo "Summary"
echo "-------"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo
if [ "$FAILED" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "PIPELINE RED. Logs: $LOG_DIR"
fi
exit "$FAILED"
