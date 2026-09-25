/**
 * Codex over ACP: `codex-acp`. Headless fallback: `codex exec --json`,
 * reading the task from stdin (`-`).
 */

import type { WorkerDefinition } from "./spec";

export const codex: WorkerDefinition = {
	name: "codex",
	adapterPackage: "@agentclientprotocol/codex-acp",
	acp: {
		binaries: ["codex-acp"],
		args: [],
		install: "npm install -g @agentclientprotocol/codex-acp",
		// Seatbelt on macOS, Landlock on Linux; on by default. codex-acp sets
		// the sandbox per session from its mode, overriding config, so only
		// starting in `agent-full-access` turns it off, and that mode's
		// approval policy is `never`: the agent stops asking.
		innerSandbox: {
			kind: "os",
			enabledByDefault: true,
			disable: {
				env: { INITIAL_AGENT_MODE: "agent-full-access" },
				stopsPermissionRequests: true,
			},
		},
	},
	headless: {
		binaries: ["codex"],
		args: ["exec", "--json", "-"],
		taskVia: "stdin",
		install: "npm install -g @openai/codex",
		// `-c` is a root flag, so it goes before `exec`.
		innerSandbox: {
			kind: "os",
			enabledByDefault: true,
			disable: { args: ["-c", 'sandbox_mode="danger-full-access"'] },
		},
	},
};
