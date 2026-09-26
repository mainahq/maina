/**
 * Fail-closed hook output (spec §6.1 rule 2; ADR 0045; mainahq/maina#475).
 *
 * What a hook prints when maina cannot evaluate the event, in the wire
 * format of the host it was registered for (pinned by
 * `src/adapters/__fixtures__`). Events are the hosts' native names: Claude
 * Code and Codex share PascalCase names, Cursor uses camelCase, so the host
 * only matters for PascalCase events.
 *
 * - A pre-tool event asks where the host enforces `ask`, and denies (exit 2,
 *   the reason on stderr) where it does not: Codex runs a tool whose
 *   PreToolUse hook asks, and Cursor does not enforce `ask` on preToolUse
 *   (#469). A PascalCase event with no known host gets the deny, which is
 *   closed in both Claude Code and Codex.
 * - Session start adds a notice to the agent's context.
 * - Every other event (and any unknown one) prints `{}`, which leaves the
 *   host's own flow in place: its permission prompt stands and a stop is
 *   never blocked by a gate that cannot run.
 *
 * `launcher/launch.sh` and `launcher/launch.ps1` print the same bytes and
 * exit with the same code; the launcher tests hold them to this function.
 */

/** The hosts maina answers hooks for (`maina hook --host <host> <event>`). */
export type HookHost = "claude" | "codex" | "cursor";

type FailClosedOutput = Readonly<{
	/** One JSON line for stdout, without the newline. */
	line: string;
	/** The reason for a deny (with a newline), or empty. */
	stderr: string;
	exitCode: number;
}>;

const askMessage = (cause: string): string =>
	`maina could not check this action (${cause}); confirm it yourself.`;

const denyMessage = (cause: string): string =>
	`maina could not check this action (${cause}), so it blocked it; ask the user to confirm before trying another way.`;

const sessionMessage = (cause: string): string =>
	`maina guardrails are unavailable (${cause}); risky actions will ask for confirmation.`;

const answer = (value: unknown): FailClosedOutput => ({
	line: JSON.stringify(value),
	stderr: "",
	exitCode: 0,
});

const denied = (value: unknown, reason: string): FailClosedOutput => ({
	line: JSON.stringify(value),
	stderr: `${reason}\n`,
	exitCode: 2,
});

function preToolUse(host: HookHost | undefined, cause: string) {
	if (host === "claude") {
		return answer({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
				permissionDecisionReason: askMessage(cause),
			},
		});
	}
	const reason = denyMessage(cause);
	return denied(
		{
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		},
		reason,
	);
}

/**
 * The fail-closed output for `event` from a hook registered for `host`
 * (undefined when the host is unknown or ambiguous).
 */
export function failClosedHook(
	host: HookHost | undefined,
	event: string,
	cause: string,
): FailClosedOutput {
	switch (event) {
		case "PreToolUse":
			return preToolUse(host, cause);
		case "SessionStart":
			return answer({
				hookSpecificOutput: {
					hookEventName: "SessionStart",
					additionalContext: sessionMessage(cause),
				},
			});
		case "beforeShellExecution":
		case "beforeMCPExecution":
			return answer({
				permission: "ask",
				user_message: askMessage(cause),
				agent_message:
					"maina could not check this action; the user must confirm it.",
			});
		case "preToolUse":
			return denied(
				{
					permission: "deny",
					user_message: denyMessage(cause),
					agent_message:
						"maina could not check this action, so it blocked it; ask the user to confirm it.",
				},
				denyMessage(cause),
			);
		case "sessionStart":
			return answer({ additional_context: sessionMessage(cause) });
		default:
			return answer({});
	}
}
