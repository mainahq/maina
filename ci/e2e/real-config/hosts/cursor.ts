/**
 * Cursor reads MCP servers from `<cwd>/.cursor/mcp.json` (project) and
 * `~/.cursor/mcp.json` (global); the project file wins.
 */

import { join } from "node:path";
import type { HostSpec } from "../types";
import { at } from "./select";

export const cursor: HostSpec = {
	id: "cursor",
	mcpAddClient: "cursor",
	seeds: ({ home }) => [
		{
			path: join(home, ".cursor", "mcp.json"),
			format: "json",
			content: `${JSON.stringify(
				{ mcpServers: { memory: { command: "memory-server" } } },
				null,
				2,
			)}\n`,
			intact: (parsed) =>
				at(parsed, ["mcpServers", "memory", "command"]) === "memory-server",
		},
	],
	configSources: ({ home, cwd }) => [
		{
			path: join(cwd, ".cursor", "mcp.json"),
			format: "json",
			select: (parsed) => at(parsed, ["mcpServers", "maina"]),
		},
		{
			path: join(home, ".cursor", "mcp.json"),
			format: "json",
			select: (parsed) => at(parsed, ["mcpServers", "maina"]),
		},
	],
	strayPaths: ({ cwd }) => [join(cwd, ".mcp.json")],
};
