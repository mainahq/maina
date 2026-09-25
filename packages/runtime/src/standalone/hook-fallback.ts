/**
 * Fail-closed hook output (spec §6.1 rule 2; ADR 0045).
 *
 * What a hook prints when maina cannot evaluate the event, in the host's own
 * wire format (pinned by `src/adapters/__fixtures__`). Events are the hosts'
 * native names: Claude Code and Codex use PascalCase and share one output
 * shape; Cursor uses camelCase.
 *
 * - Pre-tool events ask: a degraded gate never allows.
 * - Session start adds a notice to the agent's context.
 * - Every other event (and any unknown one) prints `{}`, which leaves the
 *   host's own flow in place: its permission prompt stands and a stop is
 *   never blocked by a gate that cannot run.
 *
 * `launcher/launch.sh` and `launcher/launch.ps1` print the same bytes; the
 * launcher tests hold them to this function.
 */

const decisionMessage = (cause: string): string =>
	`maina could not check this action (${cause}); confirm it yourself.`;

const sessionMessage = (cause: string): string =>
	`maina guardrails are unavailable (${cause}); risky actions will ask for confirmation.`;

/** The host's fail-closed output for `event`, as one JSON line. */
export function failClosedHookOutput(event: string, cause: string): string {
	switch (event) {
		case "PreToolUse":
			return JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "ask",
					permissionDecisionReason: decisionMessage(cause),
				},
			});
		case "SessionStart":
			return JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "SessionStart",
					additionalContext: sessionMessage(cause),
				},
			});
		case "beforeShellExecution":
		case "beforeMCPExecution":
		case "preToolUse":
			return JSON.stringify({
				permission: "ask",
				user_message: decisionMessage(cause),
				agent_message:
					"maina could not check this action; the user must confirm it.",
			});
		case "sessionStart":
			return JSON.stringify({ additional_context: sessionMessage(cause) });
		default:
			return "{}";
	}
}
