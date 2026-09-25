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
	mcpAddClient: "claude",
	// Every Claude Code user has `~/.claude.json` (startup counters, per-
	// project state, their own servers) and usually hooks/permissions in
	// `~/.claude/settings.json`.
	seeds: ({ home }) => [
		{
			path: join(home, ".claude.json"),
			format: "json",
			content: `${JSON.stringify(
				{
					numStartups: 3,
					projects: {},
					mcpServers: { memory: { command: "memory-server" } },
				},
				null,
				2,
			)}\n`,
			intact: (parsed) =>
				at(parsed, ["numStartups"]) === 3 &&
				at(parsed, ["mcpServers", "memory", "command"]) === "memory-server",
		},
		{
			path: join(home, ".claude", "settings.json"),
			format: "json",
			content: `${JSON.stringify(
				{
					hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] },
					permissions: { allow: ["Bash(ls:*)"] },
				},
				null,
				2,
			)}\n`,
			intact: (parsed) =>
				at(parsed, ["hooks", "Stop"]) !== undefined &&
				at(parsed, ["permissions", "allow"]) !== undefined &&
				at(parsed, ["mcpServers"]) === undefined,
		},
	],
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
