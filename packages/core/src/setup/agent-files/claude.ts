/**
 * Claude Code agent-file writers.
 *
 * - `writeClaudeSettings` — keyed JSON merge into `.claude/settings.json`.
 *   Preserves every non-Maina `mcpServers.*` entry and every unrelated
 *   top-level key. On malformed JSON, the original is preserved to
 *   `settings.json.bak.<ts>` before writing a fresh file.
 * - `writeClaudeMd` — re-export of the existing CLAUDE.md managed-region
 *   writer so all Claude-specific surfaces live in one module.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Result } from "../../db/index";
import { writeClaudeMd as writeClaudeMdManaged } from "./claude-md";
import { mergeJsonKeyed } from "./region";

export interface MainaMcpEntry {
	command: string;
	args: string[];
}

export type WriteClaudeSettingsAction = "created" | "merged" | "recovered";

export interface WriteClaudeSettingsOptions {
	/** The `mcpServers.maina` entry to install. */
	mainaMcpEntry: MainaMcpEntry;
	/**
	 * Override the target path — default is `<cwd>/.claude/settings.json`.
	 * Tests and the global-scope setup can pass a different path.
	 */
	targetPath?: string;
}

export interface WriteClaudeSettingsReport {
	path: string;
	action: WriteClaudeSettingsAction;
	/** If we had to move the previous file aside, the backup location. */
	backupPath?: string;
}

/**
 * Write (or merge into) `.claude/settings.json`.
 *
 * Replaces the older "overwrite + .bak" behaviour with a keyed JSON merge
 * that preserves user-authored MCP entries byte-for-byte (modulo JSON
 * formatting).
 */
export async function writeClaudeSettings(
	cwd: string,
	opts: WriteClaudeSettingsOptions,
): Promise<Result<WriteClaudeSettingsReport>> {
	const target = opts.targetPath ?? join(cwd, ".claude", "settings.json");

	try {
		mkdirSync(dirname(target), { recursive: true });

		if (!existsSync(target)) {
			const result = mergeJsonKeyed("", {
				path: ["mcpServers", "maina"],
				value: opts.mainaMcpEntry,
			});
			atomicWrite(target, result.text);
			return {
				ok: true,
				value: { path: target, action: "created" },
			};
		}

		const existing = readFileSync(target, "utf-8");
		const merged = mergeJsonKeyed(existing, {
			path: ["mcpServers", "maina"],
			value: opts.mainaMcpEntry,
		});

		if (merged.kind === "malformed") {
			// Preserve the original so the user can recover their settings.
			const ts = new Date().toISOString().replace(/[:.]/g, "-");
			const backup = `${target}.bak.${ts}`;
			try {
				renameSync(target, backup);
			} catch {
				// If rename fails, still write fresh — don't drop the merge just
				// because we couldn't back up (at worst, the user loses a file
				// that was already malformed).
			}
			atomicWrite(target, merged.text);
			const report: WriteClaudeSettingsReport = {
				path: target,
				action: "recovered",
			};
			if (existsSync(backup)) {
				report.backupPath = backup;
			}
			return { ok: true, value: report };
		}

		atomicWrite(target, merged.text);
		return {
			ok: true,
			value: {
				path: target,
				action: merged.kind === "created" ? "created" : "merged",
			},
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * Atomic write via temp + rename. Co-located with `writeClaudeSettings` so
 * the module doesn't need to import from the CLI package.
 */
function atomicWrite(target: string, content: string): void {
	mkdirSync(dirname(target), { recursive: true });
	const tmp = `${target}.maina.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
	writeFileSync(tmp, content, "utf-8");
	renameSync(tmp, target);
}

// Re-export the existing CLAUDE.md writer so callers importing from
// `./claude.ts` have a single module for all Claude surfaces.
export const writeClaudeMd = writeClaudeMdManaged;
