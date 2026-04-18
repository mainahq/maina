/**
 * Types shared across the `maina mcp add/remove/list` machinery.
 *
 * The goal of this module: write the maina MCP server entry into the
 * GLOBAL config of any AI client the user has installed, so that
 * `maina --mcp` is reachable from every project without per-repo setup.
 * The setup wizard already writes per-project configs (`.mcp.json`,
 * `.claude/settings.json`); this is the cross-project counterpart.
 */

import type { Result } from "../db/index";

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

export type ConfigFormat = "json" | "toml";

/** Description of where a client keeps the field that lists MCP servers. */
export interface ClientMcpShape {
	/** Top-level (or dotted) path to the MCP servers container. */
	path: string[];
	/** Whether the container is an object keyed by server name, or an array. */
	container: "object" | "array";
	/** The key the maina entry should use when container is "object". */
	entryKey: string;
}

export interface McpClientInfo {
	id: McpClientId;
	label: string;
	configFormat: ConfigFormat;
	/** Absolute path to the global config file (resolves `~` + platform). */
	globalConfigPath: () => string;
	/** Optional project-scoped config path (relative to cwd). */
	projectConfigPath?: (cwd: string) => string;
	/** Heuristic for "is this client installed/used on this machine?". */
	detect: () => Promise<boolean>;
	shape: ClientMcpShape;
	/** Build the maina entry in the shape this client expects. */
	buildEntry: () => unknown;
	/** True if the client expects an MCP entry only when the file already exists. */
	requiresExistingFile?: boolean;
}

export interface ApplyResult {
	clientId: McpClientId;
	configPath: string;
	scope: "global" | "project";
	action: "created" | "updated" | "unchanged" | "removed" | "absent";
	dryRun: boolean;
	error?: string;
}

export interface RunOptions {
	clients?: McpClientId[];
	scope: McpScope;
	dryRun: boolean;
	cwd: string;
	/** Override `os.homedir()` — primarily for tests. */
	home?: string;
}

export type ApplyOutcome = Result<ApplyResult, string>;
