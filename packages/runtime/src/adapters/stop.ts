/**
 * Stop contracts (FR-GATE-7, FR-VER-7): a `session.stop` decision in each
 * host's Stop hook wire format, pinned by `__fixtures__/<host>`.
 *
 *   deny          the stop is blocked with the reason: Claude Code and Codex
 *                 `decision: "block"` + `reason`, Cursor `followup_message`
 *                 (the agent carries on with it)
 *   allow + text  the summary for the user as `systemMessage` (Claude Code,
 *                 Codex); Cursor's stop output has no field for it, so `{}`
 *   otherwise     `{}`: an empty summary, or an `ask` (a degraded runtime),
 *                 never holds up a stop
 *
 * The runtime's stop decision is host-neutral; each host adapter's Stop
 * output is exactly this.
 */

import type { GateDecision } from "../gate";

export type StopHost = "claude-code" | "codex" | "cursor";

type StopOutput = Readonly<Record<string, string>>;

export function renderStop(host: StopHost, decision: GateDecision): StopOutput {
	const { verdict, reason } = decision;
	if (verdict === "deny") {
		return host === "cursor"
			? { followup_message: reason }
			: { decision: "block", reason };
	}
	if (verdict === "allow" && reason !== "" && host !== "cursor") {
		return { systemMessage: reason };
	}
	return {};
}
