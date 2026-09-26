/**
 * What the remote connector serves (FR-REM-5): the `packages/mcp` tool
 * definitions minus the local-only ones, over a runtime pinned to the
 * service's own workspace and without the action gate.
 *
 * Every MCP tool is classified here, so a new tool fails to compile until
 * someone decides whether it may run remotely. A tool is `local` when it
 * only makes sense on the developer's machine: it gates the agent's
 * actions, writes to the working tree or reads the host's session. Every
 * v1 tool is a read over a repository, so all are `remote` today; the
 * action gate lives in the hook runtime and behind `decide`'s gate types,
 * which the remote runtime refuses.
 */

import type { DecisionType } from "@mainahq/core";
import {
	ALL_TOOLS,
	DEFAULT_TOOLS,
	type McpRuntime,
	type ToolName,
} from "@mainahq/mcp";

type Reach = "remote" | "local";

const REACH: Readonly<Record<ToolName, Reach>> = {
	verify: "remote",
	decide: "remote",
	impact: "remote",
	context: "remote",
	review_triage: "remote",
	spec_check: "remote",
	receipt: "remote",
	status: "remote",
	ask_question: "remote",
	read_wiki_structure: "remote",
	read_wiki_contents: "remote",
};

const servable = (tool: ToolName): boolean => REACH[tool] === "remote";

/** The tools the service registers when no allow-list is given. */
export const REMOTE_TOOLS: readonly ToolName[] = DEFAULT_TOOLS.filter(servable);

/** Decision types that belong to the action gate: never answered remotely. */
export const GATE_DECISION_TYPES: readonly DecisionType[] = ["action.risk"];

/**
 * The remote tools an allow-list names, in catalog order: `default` stands
 * for `REMOTE_TOOLS`; unknown and local-only names are dropped.
 */
export function remoteTools(requested: readonly string[]): ToolName[] {
	const wanted = new Set(
		requested.flatMap((n) => (n === "default" ? [...REMOTE_TOOLS] : [n])),
	);
	return ALL_TOOLS.filter((t) => wanted.has(t) && servable(t));
}

const trimSlashes = (path: string): string =>
	path.length > 1 ? path.replace(/\/+$/, "") : path;

/**
 * `base` as the remote service exposes it: every call acts on `root` (a
 * caller-supplied root anywhere else is refused, so a client cannot point
 * a tool at the host's filesystem) and `decide` refuses the gate's types.
 */
export function remoteRuntime(base: McpRuntime, root: string): McpRuntime {
	const pinned = trimSlashes(root);
	return {
		...base,
		resolveRoot: async (explicit) =>
			explicit === undefined || trimSlashes(explicit) === pinned
				? { ok: true, value: pinned }
				: {
						ok: false,
						error: {
							kind: "invalid_input",
							message:
								"the remote service acts on its own workspace; omit `root`",
						},
					},
		decide: async (call) =>
			GATE_DECISION_TYPES.includes(call.request.type)
				? {
						ok: false,
						error: {
							kind: "invalid_input",
							message: `${call.request.type} belongs to the local action gate and is not served remotely`,
						},
					}
				: base.decide(call),
	};
}
