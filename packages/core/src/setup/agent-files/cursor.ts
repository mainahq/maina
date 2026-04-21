/**
 * Cursor agent-file writers.
 *
 * - `writeCursorMcp` — keyed JSON merge into `.cursor/mcp.json`. Preserves
 *   every non-Maina `mcpServers.*` entry. Same recovery behaviour as the
 *   Claude settings writer on malformed JSON.
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
import { mergeJsonKeyed } from "./region";

export interface CursorMcpEntry {
	command: string;
	args: string[];
}

export type WriteCursorMcpAction = "created" | "merged" | "recovered";

export interface WriteCursorMcpOptions {
	mainaMcpEntry: CursorMcpEntry;
	/** Override the target path — default `<cwd>/.cursor/mcp.json`. */
	targetPath?: string;
}

export interface WriteCursorMcpReport {
	path: string;
	action: WriteCursorMcpAction;
	backupPath?: string;
}

export async function writeCursorMcp(
	cwd: string,
	opts: WriteCursorMcpOptions,
): Promise<Result<WriteCursorMcpReport>> {
	const target = opts.targetPath ?? join(cwd, ".cursor", "mcp.json");

	try {
		mkdirSync(dirname(target), { recursive: true });

		if (!existsSync(target)) {
			const fresh = mergeJsonKeyed("", {
				path: ["mcpServers", "maina"],
				value: opts.mainaMcpEntry,
			});
			atomicWrite(target, fresh.text);
			return { ok: true, value: { path: target, action: "created" } };
		}

		const existing = readFileSync(target, "utf-8");
		const merged = mergeJsonKeyed(existing, {
			path: ["mcpServers", "maina"],
			value: opts.mainaMcpEntry,
		});

		if (merged.kind === "malformed") {
			const ts = new Date().toISOString().replace(/[:.]/g, "-");
			const backup = `${target}.bak.${ts}`;
			try {
				renameSync(target, backup);
			} catch {
				// fall through — we still overwrite
			}
			atomicWrite(target, merged.text);
			const report: WriteCursorMcpReport = {
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

function atomicWrite(target: string, content: string): void {
	mkdirSync(dirname(target), { recursive: true });
	const tmp = `${target}.maina.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
	writeFileSync(tmp, content, "utf-8");
	renameSync(tmp, target);
}
