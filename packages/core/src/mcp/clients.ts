/**
 * Registry of MCP clients we know how to install the maina server into.
 *
 * Each client describes:
 *   - where its global config lives (per-platform)
 *   - what serialisation format it uses (JSON vs TOML)
 *   - where in the parsed object the MCP server map lives
 *   - how to detect whether the user has the client installed
 *
 * We intentionally support only "global" install scope here — the per-
 * project shape is already handled by the setup wizard via `.mcp.json`
 * and `.claude/settings.json`. `maina mcp add` is the cross-project
 * counterpart so a single install reaches every repo.
 *
 * Inspired by PostHog's wizard MCPClient pattern, simplified for our
 * narrower use case (we always register the same maina entry).
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { McpClientId, McpClientInfo } from "./types";

// ── Path helpers ────────────────────────────────────────────────────────────

interface PathContext {
	home: string;
	platform: NodeJS.Platform;
}

function ctx(home?: string): PathContext {
	return { home: home ?? homedir(), platform: platform() };
}

function vsCodeGlobalStorage(c: PathContext): string {
	if (c.platform === "darwin") {
		return join(
			c.home,
			"Library",
			"Application Support",
			"Code",
			"User",
			"globalStorage",
		);
	}
	if (c.platform === "win32") {
		return join(
			process.env.APPDATA ?? join(c.home, "AppData", "Roaming"),
			"Code",
			"User",
			"globalStorage",
		);
	}
	return join(c.home, ".config", "Code", "User", "globalStorage");
}

function zedConfigDir(c: PathContext): string {
	if (c.platform === "win32") {
		return join(
			process.env.APPDATA ?? join(c.home, "AppData", "Roaming"),
			"Zed",
		);
	}
	return join(c.home, ".config", "zed");
}

// ── Detection helpers ──────────────────────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
	try {
		return existsSync(p);
	} catch {
		return false;
	}
}

async function vsCodeExtensionInstalled(extPrefix: string): Promise<boolean> {
	const dirs = [
		join(homedir(), ".vscode", "extensions"),
		join(homedir(), ".vscode-server", "extensions"),
	];
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		try {
			if (readdirSync(dir).some((e) => e.startsWith(extPrefix))) return true;
		} catch {
			// fall through
		}
	}
	return false;
}

// ── Client definitions ─────────────────────────────────────────────────────

export function buildClientRegistry(
	home?: string,
): Record<McpClientId, McpClientInfo> {
	const c = ctx(home);

	const claude: McpClientInfo = {
		id: "claude",
		label: "Claude Code",
		configFormat: "json",
		globalConfigPath: () => join(c.home, ".claude", "settings.json"),
		projectConfigPath: (cwd) => join(cwd, ".claude", "settings.json"),
		detect: async () =>
			dirExists(join(c.home, ".claude")) ||
			Boolean(process.env.CLAUDE_CODE) ||
			Boolean(process.env.CLAUDE_PROJECT_DIR),
		shape: { path: ["mcpServers"], container: "object", entryKey: "maina" },
		buildEntry: () => ({ command: "npx", args: ["@mainahq/cli", "--mcp"] }),
	};

	const cursor: McpClientInfo = {
		id: "cursor",
		label: "Cursor",
		configFormat: "json",
		globalConfigPath: () => join(c.home, ".cursor", "mcp.json"),
		projectConfigPath: (cwd) => join(cwd, ".cursor", "mcp.json"),
		detect: async () =>
			dirExists(join(c.home, ".cursor")) ||
			Object.keys(process.env).some((k) => k.startsWith("CURSOR_")),
		shape: { path: ["mcpServers"], container: "object", entryKey: "maina" },
		buildEntry: () => ({ command: "npx", args: ["@mainahq/cli", "--mcp"] }),
	};

	const windsurf: McpClientInfo = {
		id: "windsurf",
		label: "Windsurf",
		configFormat: "json",
		globalConfigPath: () =>
			join(c.home, ".codeium", "windsurf", "mcp_config.json"),
		detect: async () =>
			dirExists(join(c.home, ".codeium")) ||
			Object.keys(process.env).some((k) => k.startsWith("CODEIUM_")),
		shape: { path: ["mcpServers"], container: "object", entryKey: "maina" },
		buildEntry: () => ({ command: "npx", args: ["@mainahq/cli", "--mcp"] }),
	};

	const cline: McpClientInfo = {
		id: "cline",
		label: "Cline (VS Code)",
		configFormat: "json",
		globalConfigPath: () =>
			join(
				vsCodeGlobalStorage(c),
				"saoudrizwan.claude-dev",
				"settings",
				"cline_mcp_settings.json",
			),
		detect: () => vsCodeExtensionInstalled("saoudrizwan.claude-dev"),
		shape: { path: ["mcpServers"], container: "object", entryKey: "maina" },
		buildEntry: () => ({ command: "npx", args: ["@mainahq/cli", "--mcp"] }),
	};

	const codex: McpClientInfo = {
		id: "codex",
		label: "OpenAI Codex CLI",
		configFormat: "toml",
		globalConfigPath: () => join(c.home, ".codex", "config.toml"),
		detect: async () => dirExists(join(c.home, ".codex")),
		shape: { path: ["mcp_servers"], container: "object", entryKey: "maina" },
		buildEntry: () => ({ command: "npx", args: ["@mainahq/cli", "--mcp"] }),
	};

	const continueClient: McpClientInfo = {
		id: "continue",
		label: "Continue.dev",
		configFormat: "json",
		// Continue's newer YAML format is `~/.continue/.continue/mcpServers/<name>.yaml`,
		// but the legacy `config.json` `experimental` block is still respected and
		// is JSON, so we target it here to keep the dep surface small. Users on
		// the new YAML setup can run `maina mcp add --client continue` once we
		// add YAML support — tracked as a follow-up.
		globalConfigPath: () => join(c.home, ".continue", "config.json"),
		projectConfigPath: (cwd) => join(cwd, ".continue", "config.json"),
		detect: async () => dirExists(join(c.home, ".continue")),
		shape: {
			path: ["experimental", "modelContextProtocolServers"],
			container: "array",
			entryKey: "maina",
		},
		buildEntry: () => ({
			name: "maina",
			transport: {
				type: "stdio",
				command: "npx",
				args: ["@mainahq/cli", "--mcp"],
			},
		}),
	};

	const gemini: McpClientInfo = {
		id: "gemini",
		label: "Gemini CLI",
		configFormat: "json",
		globalConfigPath: () => join(c.home, ".gemini", "settings.json"),
		detect: async () => dirExists(join(c.home, ".gemini")),
		shape: { path: ["mcpServers"], container: "object", entryKey: "maina" },
		buildEntry: () => ({ command: "npx", args: ["@mainahq/cli", "--mcp"] }),
	};

	const zed: McpClientInfo = {
		id: "zed",
		label: "Zed",
		configFormat: "json",
		globalConfigPath: () => join(zedConfigDir(c), "settings.json"),
		detect: async () => dirExists(zedConfigDir(c)),
		shape: {
			path: ["context_servers"],
			container: "object",
			entryKey: "maina",
		},
		buildEntry: () => ({
			source: "custom",
			command: { path: "npx", args: ["@mainahq/cli", "--mcp"] },
		}),
	};

	return {
		claude,
		cursor,
		windsurf,
		cline,
		codex,
		continue: continueClient,
		gemini,
		zed,
	};
}

export function listClientIds(): McpClientId[] {
	return [
		"claude",
		"cursor",
		"windsurf",
		"cline",
		"codex",
		"continue",
		"gemini",
		"zed",
	];
}
