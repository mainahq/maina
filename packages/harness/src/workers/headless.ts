/**
 * The headless fallback (FR-HAR-7): an agent's own non-interactive print
 * mode (`claude -p`, `codex exec`, ...) for when its ACP adapter is not an
 * option. Nothing in that mode asks before a tool runs, so the gate cannot
 * deny a call: the worker is marked `sandbox-only` and only the sandbox it
 * runs in enforces the policy.
 */

import type { WorkerDefinition, WorkerSpec } from "./spec";

/** Names the headless fallback of an agent: `headless:claude`. */
export const HEADLESS_PREFIX = "headless:";

export function headlessSpec(
	definition: WorkerDefinition,
	command: string,
): WorkerSpec {
	const { headless } = definition;
	const name = `${HEADLESS_PREFIX}${definition.name}`;
	return {
		name,
		launch: { name, command, args: [...headless.args] },
		protocol: "headless",
		enforcement: "sandbox-only",
		taskVia: headless.taskVia,
		capabilities: { permissionRequests: false, toolCallReports: false },
		innerSandbox: headless.innerSandbox,
	};
}
