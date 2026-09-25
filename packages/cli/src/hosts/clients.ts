/**
 * Registry of MCP clients we know how to install the maina server into.
 *
 * Each client describes how to detect whether the user has it installed
 * and the shape of the maina entry it expects. Which files it reads, and
 * where the entry sits in them, is `./targets.ts`.
 *
 * Inspired by PostHog's wizard MCPClient pattern, simplified for our
 * narrower use case (we always register the same maina entry).
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectLauncher } from "./launcher";
import { type PathContext, targetsFor } from "./targets";
import type { McpClientId, McpClientInfo } from "./types";

// ── Detection helpers ──────────────────────────────────────────────────────

function exists(p: string): boolean {
	try {
		return existsSync(p);
	} catch {
		return false;
	}
}

function envHasPrefix(prefix: string): boolean {
	return Object.keys(process.env).some((k) => k.startsWith(prefix));
}

function vsCodeExtensionInstalled(home: string, extPrefix: string): boolean {
	for (const dir of [
		join(home, ".vscode", "extensions"),
		join(home, ".vscode-server", "extensions"),
	]) {
		if (!exists(dir)) continue;
		try {
			if (readdirSync(dir).some((e) => e.startsWith(extPrefix))) return true;
		} catch {
			// unreadable: try the next one
		}
	}
	return false;
}

/** Directory holding `host`'s global config file. */
function globalConfigDir(host: McpClientId, ctx: PathContext): string {
	const [global] = targetsFor(host, "global", ctx);
	return global === undefined ? ctx.home : dirname(global.path);
}

// ── Entries ────────────────────────────────────────────────────────────────

function stdioEntry(): { command: string; args: string[] } {
	const l = detectLauncher();
	return { command: l.command, args: [...l.args] };
}

// ── Client definitions ─────────────────────────────────────────────────────

export function buildClientRegistry(
	ctx: PathContext,
): Record<McpClientId, McpClientInfo> {
	const { home } = ctx;
	const client = (
		id: McpClientId,
		label: string,
		detect: () => boolean,
		buildEntry: () => unknown = stdioEntry,
	): McpClientInfo => ({
		id,
		label,
		detect: async () => detect(),
		buildEntry,
	});

	return {
		claude: client(
			"claude",
			"Claude Code",
			() =>
				exists(join(home, ".claude")) ||
				exists(join(home, ".claude.json")) ||
				Boolean(process.env.CLAUDE_CODE) ||
				Boolean(process.env.CLAUDE_PROJECT_DIR),
		),
		cursor: client(
			"cursor",
			"Cursor",
			() => exists(join(home, ".cursor")) || envHasPrefix("CURSOR_"),
		),
		windsurf: client(
			"windsurf",
			"Windsurf",
			() => exists(join(home, ".codeium")) || envHasPrefix("CODEIUM_"),
		),
		cline: client("cline", "Cline (VS Code)", () =>
			vsCodeExtensionInstalled(home, "saoudrizwan.claude-dev"),
		),
		codex: client("codex", "OpenAI Codex CLI", () =>
			exists(globalConfigDir("codex", ctx)),
		),
		continue: client(
			"continue",
			"Continue.dev",
			() => exists(join(home, ".continue")),
			() => {
				const l = detectLauncher();
				return {
					name: "maina",
					transport: { type: "stdio", command: l.command, args: [...l.args] },
				};
			},
		),
		gemini: client("gemini", "Gemini CLI", () => exists(join(home, ".gemini"))),
		zed: client(
			"zed",
			"Zed",
			() => exists(globalConfigDir("zed", ctx)),
			() => {
				const l = detectLauncher();
				return {
					source: "custom",
					command: { path: l.command, args: [...l.args] },
				};
			},
		),
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
