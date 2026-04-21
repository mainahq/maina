/**
 * Shared scaffolding used by `maina init` and `maina setup`.
 *
 * Writes the minimal `.maina/` skeleton both commands need. This is the
 * single source of truth for the static portion of the tree — tailored
 * files (constitution, agent files, IDE MCP configs) live in higher-level
 * modules and are layered on top.
 *
 * Idempotent: running twice produces a byte-identical tree. Never
 * overwrites user-customised files — if the path already exists, it is
 * skipped (not force-written).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Result } from "../db/index";

// ── Options ─────────────────────────────────────────────────────────────────

export interface ScaffoldOptions {
	/** Absolute path to the repo root. */
	cwd: string;
	/** Write `.maina/prompts/{review,commit}.md`. Default: true. */
	withPrompts?: boolean;
	/**
	 * Write a minimal `.maina/constitution.md` stub when one does not
	 * already exist. Callers that produce a tailored constitution (like
	 * `maina init` and `maina setup`) pass `false` so they can write their
	 * own body over the bare-minimum skeleton.
	 *
	 * Default: true.
	 */
	withConstitutionStub?: boolean;
	/**
	 * Placeholder for wave 4 — materialise `.maina/skills/<name>/SKILL.md`
	 * trees from `@mainahq/skills`. Not consumed by this scaffolder (skills
	 * live in `setup/skills-deploy.ts`) but accepted for API symmetry so
	 * callers don't need to branch.
	 */
	withSkills?: boolean;
	/**
	 * Placeholder for wave 4 — seed the wiki. Also accepted for symmetry
	 * but not consumed here.
	 */
	withWiki?: boolean;
}

export interface ScaffoldReport {
	/** Paths written (relative to cwd). */
	created: string[];
	/** Paths skipped because they already existed. */
	skipped: string[];
}

// ── Templates ──────────────────────────────────────────────────────────────
//
// Exported so other modules (init's tailored constitution builder, the
// setup wizard) can stamp the same baseline when they need to.

/**
 * Minimal constitution stub — used when neither init nor setup has anything
 * tailored to write. Callers with a real constitution should overwrite
 * `.maina/constitution.md` after scaffold returns.
 */
export const CONSTITUTION_STUB = `# Project Constitution

Non-negotiable rules for this project. Injected into every AI call.

## Stack
- [NEEDS CLARIFICATION] Runtime
- [NEEDS CLARIFICATION] Language
- [NEEDS CLARIFICATION] Lint/Format
- [NEEDS CLARIFICATION] Test

## Architecture
- [NEEDS CLARIFICATION] Define architectural constraints.

## Verification
- Diff-only: only report findings on changed lines.

## Conventions
- [NEEDS CLARIFICATION] Add project-specific conventions.
`;

export const REVIEW_PROMPT_TEMPLATE = `# Review Prompt

Review the following code changes for:
1. Correctness — does the code do what it claims?
2. Style — does it follow project conventions?
3. Safety — are there security or performance concerns?
4. Tests — are changes adequately tested?
`;

export const COMMIT_PROMPT_TEMPLATE = `# Commit Message Prompt

Generate a conventional commit message for the staged changes.

Format: <type>(<scope>): <description>

Types: feat, fix, refactor, test, docs, chore, ci, perf
`;

/**
 * Minimal `.maina/config.yml` scaffold. Users layer their own keys on top;
 * maina only reads what it writes here and what it explicitly documents.
 */
export const CONFIG_YML_STUB = `# .maina/config.yml — maina project configuration
# See https://mainahq.com/docs/config for the full reference.

version: 1
`;

// ── File manifest ───────────────────────────────────────────────────────────

interface FileEntry {
	/** Path relative to cwd. */
	path: string;
	content: string;
	/** Whether this file is part of the `withPrompts` bundle. */
	prompts?: boolean;
	/** Whether this file is part of the `withConstitutionStub` bundle. */
	constitution?: boolean;
}

function manifest(): FileEntry[] {
	return [
		{
			path: ".maina/constitution.md",
			content: CONSTITUTION_STUB,
			constitution: true,
		},
		{
			path: ".maina/prompts/review.md",
			content: REVIEW_PROMPT_TEMPLATE,
			prompts: true,
		},
		{
			path: ".maina/prompts/commit.md",
			content: COMMIT_PROMPT_TEMPLATE,
			prompts: true,
		},
		{
			path: ".maina/features/.gitkeep",
			content: "",
		},
		{
			path: ".maina/config.yml",
			content: CONFIG_YML_STUB,
		},
	];
}

/** Directories that need to exist even when they carry no files. */
const EXTRA_DIRS = [".maina/cache"];

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * Scaffold the shared `.maina/` skeleton into `cwd`.
 *
 * - Never overwrites existing files.
 * - Creates parent directories as needed.
 * - Returns a report; never throws — errors are wrapped in the `Result`.
 */
export async function scaffold(
	opts: ScaffoldOptions,
): Promise<Result<ScaffoldReport>> {
	const { cwd } = opts;
	const withPrompts = opts.withPrompts !== false;
	const withConstitutionStub = opts.withConstitutionStub !== false;
	const created: string[] = [];
	const skipped: string[] = [];

	try {
		mkdirSync(join(cwd, ".maina"), { recursive: true });
		for (const dir of EXTRA_DIRS) {
			mkdirSync(join(cwd, dir), { recursive: true });
		}

		for (const entry of manifest()) {
			if (entry.prompts && !withPrompts) continue;
			if (entry.constitution && !withConstitutionStub) continue;
			const full = join(cwd, entry.path);
			mkdirSync(dirname(full), { recursive: true });
			if (existsSync(full)) {
				skipped.push(entry.path);
				continue;
			}
			writeFileSync(full, entry.content, "utf-8");
			created.push(entry.path);
		}

		return { ok: true, value: { created, skipped } };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
