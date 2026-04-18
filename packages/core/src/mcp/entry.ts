/**
 * The maina MCP server entry. Single source of truth so every client
 * registers the same `command` / `args` shape — and so a future change
 * (e.g. switching from `npx @mainahq/cli` to `bunx`) is one edit.
 */

export const MAINA_MCP_KEY = "maina";

export interface MainaMcpEntry {
	command: string;
	args: string[];
}

export function buildMainaEntry(): MainaMcpEntry {
	return {
		command: "npx",
		args: ["@mainahq/cli", "--mcp"],
	};
}

/**
 * Same shape as `buildMainaEntry()` but flattened for TOML, where command
 * + args sit alongside section metadata instead of inside an object value.
 */
export function buildMainaTomlSection(): Record<string, unknown> {
	return {
		command: "npx",
		args: ["@mainahq/cli", "--mcp"],
	};
}
