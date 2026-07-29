#!/usr/bin/env bash
# PreToolUse / Write|Edit|MultiEdit hook.
# Rejects float arithmetic in the money path. Money is bigint minor units.
#
# docs/08 D22: this was a PostToolUse hook until 2026-07-30, which could never
# have worked. PostToolUse runs AFTER the write lands, so exit 2 there rejects
# a tool call whose effect is already on disk. It has to inspect the PROPOSED
# content before it is written, which is what PreToolUse gives it.
#
# So this reads the content out of the tool payload on stdin, not off disk:
#   Write      tool_input.content
#   Edit       tool_input.new_string
#   MultiEdit  every tool_input.edits[].new_string
#
# Exit 2 = block the tool call. Exit 0 = allow.
set -uo pipefail

python3 -c '
import sys, json, re

# A hook that crashes must not block honest work. Anything unparseable exits 0.
try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)

ti = payload.get("tool_input") or {}
path = ti.get("file_path") or ""

# The money path only. Everything else is none of this guard business.
if not re.search(r"src/modules/(settlement|wallet|betting)/", path):
    sys.exit(0)

chunks = []

content = ti.get("content")
if isinstance(content, str):
    chunks.append(("content", content))

new_string = ti.get("new_string")
if isinstance(new_string, str):
    chunks.append(("new_string", new_string))

edits = ti.get("edits")
if isinstance(edits, list):
    for i, edit in enumerate(edits):
        if isinstance(edit, dict) and isinstance(edit.get("new_string"), str):
            chunks.append(("edits[%d].new_string" % i, edit["new_string"]))

# Nothing proposed (a read-shaped payload, or a delete). Nothing to judge.
if not chunks:
    sys.exit(0)

pattern = re.compile(r"parseFloat|\.toFixed\(")

hits = []
for label, text in chunks:
    for n, line in enumerate(text.splitlines(), 1):
        if pattern.search(line):
            hits.append("  %s line %d: %s" % (label, n, line.strip()))

if not hits:
    sys.exit(0)

sys.stderr.write("MONEY PATH VIOLATION in %s\n" % path)
sys.stderr.write("\n".join(hits) + "\n\n")
sys.stderr.write(
    "Money is bigint minor units - GBP pence (docs/08 D1). No float arithmetic\n"
    "in settlement, wallet, or betting code. Round once, at the end, on\n"
    "bigints. See .claude/rules/money.md.\n"
)
sys.exit(2)
'
