#!/bin/sh
# Spec Kit `pre_tool_use` handler for the maina extension (mainahq/maina#333).
#
# Spec Kit's event dispatcher runs this with the agent host's hook payload
# on stdin and passes what it prints back to the host. It hands the payload
# to the Maina gate, `maina hook <event>`, named by the payload's
# `hook_event_name` (Claude Code and Codex: PreToolUse; Cursor: preToolUse).
#
# Fail closed: when maina is missing, exits non-zero or prints nothing, it
# prints the host's `ask` answer, byte-identical to the runtime's
# packages/runtime/src/standalone/hook-fallback.ts. It always exits 0, so
# the host reads that answer instead of treating the hook as broken.
#
# MAINA_BIN overrides the maina executable (default: `maina` on PATH).

set -u

payload=$(cat)

# The first "hook_event_name" that names a pre-tool event. Hosts write it
# before `tool_input`, so a key of the same name inside a tool's arguments
# comes later; one inside a string is escaped (\") and cannot match.
event=$(printf '%s\n' "$payload" |
	grep -o '"hook_event_name"[[:space:]]*:[[:space:]]*"[A-Za-z]*"' |
	sed 's/.*"\([A-Za-z]*\)"$/\1/' |
	grep -x -E 'PreToolUse|preToolUse|beforeShellExecution|beforeMCPExecution' |
	head -n 1)
[ -n "$event" ] || event=PreToolUse

fail_closed() {
	ask="maina could not check this action ($1); confirm it yourself."
	case $event in
	PreToolUse)
		printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$ask" ;;
	*) # Cursor: preToolUse, beforeShellExecution, beforeMCPExecution
		printf '{"permission":"ask","user_message":"%s","agent_message":"maina could not check this action; the user must confirm it."}\n' "$ask" ;;
	esac
	exit 0
}

maina=${MAINA_BIN:-maina}
command -v "$maina" >/dev/null 2>&1 || fail_closed gate_unavailable

answer=$(printf '%s\n' "$payload" | "$maina" hook "$event" 2>/dev/null) ||
	fail_closed gate_unavailable
[ -n "$answer" ] || fail_closed gate_unavailable

printf '%s\n' "$answer"
