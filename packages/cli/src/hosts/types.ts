/**
 * Types shared across the `maina mcp add/remove/list` machinery.
 *
 * Where each host keeps its MCP config lives in `./targets.ts`; how the
 * maina entry is merged in and removed again lives in `./merge.ts` and
 * `./uninstall.ts`. This module describes the hosts themselves.
 */

import type { HostAction } from "./merge";

export type McpClientId =
	| "claude"
	| "cursor"
	| "windsurf"
	| "cline"
	| "codex"
	| "continue"
	| "gemini"
	| "zed";

export type McpScope = "global" | "project" | "both";

export interface McpClientInfo {
	readonly id: McpClientId;
	readonly label: string;
	/** Heuristic for "is this client installed/used on this machine?". */
	readonly detect: () => Promise<boolean>;
	/** Build the maina entry in the shape this client expects. */
	readonly buildEntry: () => unknown;
}

export interface ApplyResult {
	readonly clientId: McpClientId;
	readonly configPath: string;
	readonly scope: "global" | "project";
	readonly action: HostAction;
	readonly dryRun: boolean;
	readonly error?: string;
}

export interface RunOptions {
	readonly clients?: McpClientId[];
	readonly scope: McpScope;
	readonly dryRun: boolean;
	readonly cwd: string;
	/** Override `os.homedir()` — primarily for tests. */
	readonly home?: string;
}
