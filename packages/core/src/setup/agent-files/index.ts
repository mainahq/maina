/**
 * Agent file generators — tailored per tool, managed-region safe.
 *
 * Each agent file wraps Maina-authored content in a `<maina-managed>` region
 * so subsequent setup runs update only that region. User content above and
 * below is preserved verbatim.
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
import { generateAgentsMd } from "./agents-md";
import { generateClaudeMd } from "./claude-md";
import { generateCopilotInstructions } from "./copilot-instructions";
import { generateCursorRules } from "./cursor-rules";
import { mergeManaged, wrapManaged } from "./region";
import type { StackContext } from "./types";
import { generateWindsurfRules } from "./windsurf-rules";

export type AgentKind = "agents" | "claude" | "cursor" | "copilot" | "windsurf";

export const ALL_AGENTS: AgentKind[] = [
	"agents",
	"claude",
	"cursor",
	"copilot",
	"windsurf",
];

// ── Re-exports ──────────────────────────────────────────────────────────────

export { generateAgentsMd } from "./agents-md";
export { generateClaudeMd, writeClaudeMd } from "./claude-md";
export { generateCopilotInstructions } from "./copilot-instructions";
export { generateCursorRules } from "./cursor-rules";
export {
	extractManaged,
	MAINA_REGION_END,
	MAINA_REGION_START,
	mergeManaged,
	wrapManaged,
} from "./region";
export type { StackContext } from "./types";
export { generateWindsurfRules } from "./windsurf-rules";

// ── Agent manifest ───────────────────────────────────────────────────────────

interface AgentDescriptor {
	kind: AgentKind;
	relativePath: string;
	generate: (ctx: StackContext, qr: string) => string;
}

const MANIFEST: AgentDescriptor[] = [
	{
		kind: "agents",
		relativePath: "AGENTS.md",
		generate: generateAgentsMd,
	},
	{
		kind: "claude",
		relativePath: "CLAUDE.md",
		generate: generateClaudeMd,
	},
	{
		kind: "cursor",
		relativePath: ".cursor/rules/maina.mdc",
		generate: generateCursorRules,
	},
	{
		kind: "copilot",
		relativePath: ".github/copilot-instructions.md",
		generate: generateCopilotInstructions,
	},
	{
		kind: "windsurf",
		relativePath: ".windsurf/rules/maina.md",
		generate: generateWindsurfRules,
	},
];

// ── Atomic file write with managed-region merge ─────────────────────────────

function writeWithManagedRegion(
	target: string,
	managed: string,
): { written: boolean; warning?: string } {
	try {
		mkdirSync(dirname(target), { recursive: true });
	} catch (e) {
		return {
			written: false,
			warning: `skip ${target}: cannot create parent dir (${
				e instanceof Error ? e.message : String(e)
			})`,
		};
	}

	try {
		const content = existsSync(target)
			? mergeManaged(readFileSync(target, "utf-8"), managed)
			: `${wrapManaged(managed)}\n`;
		const tmp = `${target}.maina.tmp`;
		writeFileSync(tmp, content, "utf-8");
		renameSync(tmp, target);
		return { written: true };
	} catch (e) {
		return {
			written: false,
			warning: `skip ${target}: write failed (${
				e instanceof Error ? e.message : String(e)
			})`,
		};
	}
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Write all selected agent files under `cwd`.
 *
 * - When `agents` is omitted, writes all five supported files.
 * - Each file wraps generated content in the maina-managed region.
 * - Existing files are merged non-destructively (user content preserved).
 * - Errors on individual files (e.g. read-only parent dir) are collected in
 *   `warnings` and the function never throws.
 */
export async function writeAllAgentFiles(
	cwd: string,
	ctx: StackContext,
	constitutionQuickRef: string,
	agents?: AgentKind[],
): Promise<Result<{ written: string[]; warnings: string[] }>> {
	const selected = new Set<AgentKind>(agents ?? ALL_AGENTS);
	const written: string[] = [];
	const warnings: string[] = [];

	try {
		for (const descriptor of MANIFEST) {
			if (!selected.has(descriptor.kind)) continue;
			const target = join(cwd, descriptor.relativePath);
			const managed = descriptor.generate(ctx, constitutionQuickRef);
			const result = writeWithManagedRegion(target, managed);
			if (result.written) {
				written.push(descriptor.relativePath);
			} else if (result.warning) {
				warnings.push(result.warning);
			}
		}
		return { ok: true, value: { written, warnings } };
	} catch (e) {
		// Should be unreachable — writeWithManagedRegion traps per-file errors.
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
