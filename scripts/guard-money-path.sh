#!/usr/bin/env bash
# PostToolUse / Write|Edit hook.
# Rejects float arithmetic in the money path. Money is bigint minor units.
set -uo pipefail

input="$(cat)"
file="$(printf '%s' "$input" | python3 -c \
  'import sys,json;print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' \
  2>/dev/null || true)"

case "$file" in
  *src/modules/settlement/*|*src/modules/wallet/*|*src/modules/betting/*) ;;
  *) exit 0 ;;
esac

[ -f "$file" ] || exit 0

hits="$(grep -nE 'parseFloat|\.toFixed\(' "$file" || true)"

if [ -n "$hits" ]; then
  echo "MONEY PATH VIOLATION in $file" >&2
  echo "$hits" >&2
  echo "" >&2
  echo "Money is bigint minor units. No float arithmetic in settlement," >&2
  echo "wallet, or betting code. See .claude/rules/money.md." >&2
  exit 2
fi

exit 0
