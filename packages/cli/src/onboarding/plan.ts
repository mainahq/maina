/**
 * Onboarding planner: the pure half of `maina setup` (FR-INS-4, FR-INS-5).
 *
 * `planOnboarding` turns detected facts (the stack, the generated
 * constitution, the MCP entry and the current bytes of every target file)
 * into file operations. It performs no I/O; `applyOps` (./apply.ts) carries
 * the operations out through an injected filesystem port.
 *
 * Rules:
 * - There is no "overwrite" kind. A file maina does not own is either
 *   created (when missing) or merged into (a markdown managed region, or a
 *   single JSON key). Whole-file targets such as the constitution are only
 *   ever created.
 * - Planning is idempotent: once the ops are applied, planning again from
 *   the new facts yields no ops.
 * - `managedOnly` (the non-interactive mode host plugins use) never creates
 *   a file outside `.maina/`; it only refreshes managed regions and keys in
 *   files that already exist.
 */

import { createJsonKeyText, mergeJsonKey } from "./json-key";
import { LEGACY_TARGETS } from "./legacy";
import {
	AGENT_FILES,
	type AgentKind,
	ALL_AGENTS,
} from "./setup/agent-files/index";
import {
	extractManaged,
	mergeManaged,
	wrapManaged,
} from "./setup/agent-files/region";
import type { StackContext } from "./setup/agent-files/types";

// ── Types ────────────────────────────────────────────────────────────────────

interface FileOpBase {
	/** Repo-relative path, `/`-separated. */
	readonly path: string;
	/**
	 * `create`: the full file. `merge-region`: the body of the managed
	 * region. `merge-json-key`: the JSON-encoded value for `keyPath`.
	 */
	readonly content: string;
	/** Copy the current file to `.maina/backups/` before the first write. */
	readonly backup: boolean;
}

export type FileOp =
	| (FileOpBase & { readonly kind: "create" })
	| (FileOpBase & { readonly kind: "merge-region" })
	| (FileOpBase & {
			readonly kind: "merge-json-key";
			readonly keyPath: readonly string[];
	  });

interface McpEntry {
	readonly command: string;
	readonly args: readonly string[];
}

export interface OnboardingFacts {
	readonly stack: StackContext;
	/** Constitution to create when `.maina/constitution.md` is missing. */
	readonly constitution: string;
	/** The `mcpServers.maina` entry for MCP config files. */
	readonly mcpEntry: McpEntry;
	/** Current bytes of each existing target, keyed by repo-relative path. */
	readonly files: ReadonlyMap<string, string>;
}

export interface PlanOptions {
	/** Instruction files to write. Default: all. */
	readonly agents?: readonly AgentKind[];
	/** Also write the retired 1.x agent files (see ./legacy.ts). */
	readonly legacyAgents?: boolean;
	/** Plugin mode: only `.maina/` and managed regions of existing files. */
	readonly managedOnly?: boolean;
}

export interface RenderContext {
	readonly stack: StackContext;
	readonly quickRef: string;
	readonly constitution: string;
	readonly mcpEntry: McpEntry;
}

/** One file the flow manages and how it is merged. */
export type TargetSpec =
	| {
			readonly format: "markdown";
			readonly path: string;
			readonly render: (c: RenderContext) => string;
	  }
	| {
			readonly format: "json-key";
			readonly path: string;
			readonly keyPath: readonly string[];
			readonly render: (c: RenderContext) => unknown;
	  }
	| {
			readonly format: "whole";
			readonly path: string;
			readonly render: (c: RenderContext) => string;
	  };

// ── Targets ─────────────────────────────────────────────────────────────────

const CONSTITUTION_PATH = ".maina/constitution.md";
const MCP_KEY = ["mcpServers", "maina"] as const;
const MCP_CONFIG_PATHS = [
	".mcp.json",
	".claude/settings.json",
	".cursor/mcp.json",
];

function targetSpecs(options: PlanOptions): readonly TargetSpec[] {
	const agents = new Set<AgentKind>(options.agents ?? ALL_AGENTS);
	return [
		{ format: "whole", path: CONSTITUTION_PATH, render: (c) => c.constitution },
		...AGENT_FILES.filter((f) => agents.has(f.kind)).map(
			(f): TargetSpec => ({
				format: "markdown",
				path: f.path,
				render: (c) => f.generate(c.stack, c.quickRef),
			}),
		),
		...MCP_CONFIG_PATHS.map(
			(path): TargetSpec => ({
				format: "json-key",
				path,
				keyPath: MCP_KEY,
				render: (c) => c.mcpEntry,
			}),
		),
		...(options.legacyAgents === true ? LEGACY_TARGETS : []),
	];
}

/** Every path the plan may touch — the files whose bytes the facts need. */
export function onboardingTargets(
	options: PlanOptions = {},
): readonly string[] {
	return targetSpecs(options).map((t) => t.path);
}

// ── Planning ────────────────────────────────────────────────────────────────

/**
 * First ~10 non-empty lines of the constitution, quoted in agent files so
 * they carry the headline rules without duplicating the whole document.
 */
function buildQuickRef(constitution: string): string {
	const out: string[] = [];
	let nonEmpty = 0;
	for (const line of constitution.split(/\r?\n/)) {
		out.push(line);
		if (line.trim().length > 0) nonEmpty++;
		if (nonEmpty >= 10) break;
	}
	return out.join("\n").trim();
}

function isMainaPath(path: string): boolean {
	return path.startsWith(".maina/");
}

function planTarget(
	spec: TargetSpec,
	ctx: RenderContext,
	existing: string | undefined,
	managedOnly: boolean,
): FileOp | null {
	if (existing === undefined) {
		if (managedOnly && !isMainaPath(spec.path)) return null;
		switch (spec.format) {
			case "whole":
				return {
					kind: "create",
					path: spec.path,
					content: spec.render(ctx),
					backup: false,
				};
			case "markdown":
				return {
					kind: "create",
					path: spec.path,
					content: `${wrapManaged(spec.render(ctx))}\n`,
					backup: false,
				};
			case "json-key":
				return {
					kind: "create",
					path: spec.path,
					content: createJsonKeyText(spec.keyPath, spec.render(ctx)),
					backup: false,
				};
			default: {
				const unreachable: never = spec;
				return unreachable;
			}
		}
	}

	switch (spec.format) {
		case "whole":
			return null;
		case "markdown": {
			const body = spec.render(ctx);
			if (mergeManaged(existing, body) === existing) return null;
			return {
				kind: "merge-region",
				path: spec.path,
				content: body,
				backup: extractManaged(existing) === null,
			};
		}
		case "json-key": {
			const value = spec.render(ctx);
			const merged = mergeJsonKey(existing, spec.keyPath, value);
			if (merged.kind === "unchanged") return null;
			// An invalid file still gets an op so `applyOps` reports why it
			// was skipped; it will not be modified.
			return {
				kind: "merge-json-key",
				path: spec.path,
				keyPath: spec.keyPath,
				content: JSON.stringify(value),
				backup: merged.kind === "merged" && !merged.hadKey,
			};
		}
		default: {
			const unreachable: never = spec;
			return unreachable;
		}
	}
}

/**
 * Plan the onboarding writes for a repository. Pure: same facts and
 * options, same ops.
 */
export function planOnboarding(
	facts: OnboardingFacts,
	options: PlanOptions = {},
): readonly FileOp[] {
	const ctx: RenderContext = {
		stack: facts.stack,
		constitution: facts.constitution,
		mcpEntry: facts.mcpEntry,
		quickRef: buildQuickRef(
			facts.files.get(CONSTITUTION_PATH) ?? facts.constitution,
		),
	};
	const managedOnly = options.managedOnly === true;
	return targetSpecs(options).flatMap((spec) => {
		const op = planTarget(spec, ctx, facts.files.get(spec.path), managedOnly);
		return op === null ? [] : [op];
	});
}
