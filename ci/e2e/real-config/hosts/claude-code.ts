/**
 * Claude Code reads MCP servers from (highest precedence first):
 *   - local scope:   `~/.claude.json` → `projects[<cwd>].mcpServers`
 *   - project scope: `<cwd>/.mcp.json` → `mcpServers`
 *   - user scope:    `~/.claude.json` → `mcpServers`
 *
 * It never reads `mcpServers` from `settings.json` (user or project);
 * writing there is P1.
 */

import { join } from "node:path";
import type { HostSpec } from "../types";
import { at } from "./select";

export const claudeCode: HostSpec = {
	id: "claude-code",
	installShTool: "claude-code",
	mcpAddClient: "claude",
	configSources: ({ home, cwd }) => {
		const userFile = join(home, ".claude.json");
		return [
			{
				path: userFile,
				format: "json",
				select: (parsed) =>
					at(at(parsed, ["projects"]), [cwd, "mcpServers", "maina"]),
			},
			{
				path: join(cwd, ".mcp.json"),
				format: "json",
				select: (parsed) => at(parsed, ["mcpServers", "maina"]),
			},
			{
				path: userFile,
				format: "json",
				select: (parsed) => at(parsed, ["mcpServers", "maina"]),
			},
		];
	},
	strayPaths: ({ home, cwd }) => [
		join(home, ".claude", "settings.json"),
		join(cwd, ".claude", "settings.json"),
		join(cwd, ".claude", "settings.local.json"),
	],
};
