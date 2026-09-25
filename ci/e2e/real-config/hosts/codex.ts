/**
 * Codex CLI reads MCP servers from `$CODEX_HOME/config.toml` (default
 * `~/.codex/config.toml`) under `[mcp_servers.<name>]`. The harness never
 * sets CODEX_HOME, so the default applies.
 */

import { join } from "node:path";
import type { HostSpec } from "../types";
import { at } from "./select";

export const codex: HostSpec = {
	id: "codex",
	installShTool: "codex",
	mcpAddClient: "codex",
	configSources: ({ home }) => [
		{
			path: join(home, ".codex", "config.toml"),
			format: "toml",
			select: (parsed) => at(parsed, ["mcp_servers", "maina"]),
		},
	],
	strayPaths: ({ cwd }) => [join(cwd, ".mcp.json")],
};
