#!/bin/sh
# Spec Kit `pre_tool_use` handler for the maina extension (mainahq/maina#333).
#
# Spec Kit's event dispatcher runs this with the agent host's hook payload
# on stdin and passes what it prints, its stderr and its exit code back to
# the host. It hands the payload to the Maina gate,
# `maina hook --host <host> <event>`, named by the payload's
# `hook_event_name` (Claude Code and Codex: PreToolUse; Cursor: preToolUse).
#
# The host picks the adapter (mainahq/maina#475, #484): Claude Code and
# Codex share PreToolUse but not its answers, since Codex runs a tool whose
# hook asks. Spec Kit writes the same command into every host's config, so
# the handler reads the host from the run itself:
#   - Cursor's events are camelCase: cursor.
#   - A Codex payload always carries `turn_id` (Claude Code's never does):
#     codex.
#   - Claude Code sets CLAUDE_PROJECT_DIR for its hooks (Spec Kit's Claude
#     command needs it): claude.
#   - Anything else names no host, and `maina hook <event>` fails closed as
#     ambiguous. Every miss lands on the stricter answer, never on an ask
#     where the host would run the tool.
#
# Fail closed: when maina is missing, fails or prints nothing, the handler
# prints the host's fail-closed answer and exits with its code, byte-
# identical to failClosedHook(host, event, cause) in
# packages/runtime/src/standalone/hook-fallback.ts. A deny exits 2 with its
# reason on stderr. A deny from maina itself (exit 2) passes through as is.
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

# A `turn_id` key anywhere counts: in a tool's arguments it only routes a
# Claude Code payload to Codex, whose answers are stricter.
host=
case $event in
PreToolUse)
	if printf '%s\n' "$payload" | grep -q '"turn_id"[[:space:]]*:'; then
		host=codex
	elif [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
		host=claude
	fi ;;
*) host=cursor ;;
esac

# Keep these outputs and exit codes byte-identical to failClosedHook (the
# pre-tool events only: the handler answers no other event).
fail_closed() {
	ask="maina could not check this action ($1); confirm it yourself."
	deny="maina could not check this action ($1), so it blocked it; ask the user to confirm before trying another way."
	code=0
	case $event in
	PreToolUse)
		if [ "$host" = claude ]; then
			printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$ask"
		else
			printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$deny"
			code=2
		fi ;;
	preToolUse)
		printf '{"permission":"deny","user_message":"%s","agent_message":"maina could not check this action, so it blocked it; ask the user to confirm it."}\n' "$deny"
		code=2 ;;
	*) # beforeShellExecution, beforeMCPExecution
		printf '{"permission":"ask","user_message":"%s","agent_message":"maina could not check this action; the user must confirm it."}\n' "$ask" ;;
	esac
	[ $code -eq 0 ] || printf '%s\n' "$deny" >&2
	exit $code
}

maina=${MAINA_BIN:-maina}
command -v "$maina" >/dev/null 2>&1 || fail_closed gate_unavailable

# maina's stderr matters only for a deny; anything else it says is dropped.
errors=$(mktemp "${TMPDIR:-/tmp}/maina-hook.XXXXXX" 2>/dev/null) || errors=
trap '[ -z "$errors" ] || rm -f "$errors"' EXIT

if [ -n "$host" ]; then
	answer=$(printf '%s\n' "$payload" | "$maina" hook --host "$host" "$event" 2>"${errors:-/dev/null}")
else
	answer=$(printf '%s\n' "$payload" | "$maina" hook "$event" 2>"${errors:-/dev/null}")
fi
code=$?

case $code in
0) [ -n "$answer" ] || fail_closed gate_unavailable ;;
2) # A deny: exit 2 blocks in every host, whatever else was printed.
	[ -z "$answer" ] || printf '%s\n' "$answer"
	[ -z "$errors" ] || cat "$errors" >&2
	exit 2 ;;
*) fail_closed gate_unavailable ;;
esac

printf '%s\n' "$answer"
