/**
 * Init module — bootstraps Maina in a repository.
 *
 * Creates `.maina/` directory structure and scaffolds default files.
 * Never overwrites existing files unless `force: true`.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";

// ── Types ────────────────────────────────────────────────────────────────────

export interface InitOptions {
	force?: boolean;
}

export interface InitReport {
	created: string[];
	skipped: string[];
	directory: string;
}

// ── Templates ────────────────────────────────────────────────────────────────

const CONSTITUTION_TEMPLATE = `# Project Constitution

## Stack
- [NEEDS CLARIFICATION] Define your runtime, language, and tools.

## Architecture
- [NEEDS CLARIFICATION] Define architectural constraints.

## Verification
- All commits pass: lint + typecheck + test
- [NEEDS CLARIFICATION] Define quality gates.
`;

const REVIEW_PROMPT_TEMPLATE = `# Review Prompt

Review the following code changes for:
1. Correctness — does the code do what it claims?
2. Style — does it follow project conventions?
3. Safety — are there security or performance concerns?
4. Tests — are changes adequately tested?

[NEEDS CLARIFICATION] Add project-specific review criteria.
`;

const COMMIT_PROMPT_TEMPLATE = `# Commit Message Prompt

Generate a conventional commit message for the staged changes.

Format: <type>(<scope>): <description>

Types: feat, fix, refactor, test, docs, chore, ci, perf

[NEEDS CLARIFICATION] Add project-specific commit conventions.
`;

const AGENTS_TEMPLATE = `# AGENTS.md

This repo uses Maina for verification. Run \`maina verify\` before committing.

## Commands
- \`maina commit\` — Verify and commit
- \`maina verify\` — Run verification pipeline
- \`maina context\` — Generate codebase context
- \`maina plan <name>\` — Create feature branch
- \`maina analyze\` — Check spec/plan consistency

## Conventions
[NEEDS CLARIFICATION] Add your team's conventions here.
`;

const CI_WORKFLOW_TEMPLATE = `name: Maina CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run check
      - run: bun run typecheck
      - run: bun run test
`;

// ── File Manifest ────────────────────────────────────────────────────────────

interface FileEntry {
	/** Path relative to repoRoot */
	relativePath: string;
	content: string;
}

function getFileManifest(): FileEntry[] {
	return [
		{
			relativePath: ".maina/constitution.md",
			content: CONSTITUTION_TEMPLATE,
		},
		{
			relativePath: ".maina/prompts/review.md",
			content: REVIEW_PROMPT_TEMPLATE,
		},
		{
			relativePath: ".maina/prompts/commit.md",
			content: COMMIT_PROMPT_TEMPLATE,
		},
		{
			relativePath: "AGENTS.md",
			content: AGENTS_TEMPLATE,
		},
		{
			relativePath: ".github/workflows/maina-ci.yml",
			content: CI_WORKFLOW_TEMPLATE,
		},
	];
}

/** Directories to create even if they have no files */
const EXTRA_DIRS = [".maina/hooks"];

// ── Core Function ────────────────────────────────────────────────────────────

/**
 * Bootstrap Maina in the given repository root.
 *
 * Creates `.maina/` directory structure and scaffolds default files.
 * Never overwrites existing files unless `force: true`.
 * Returns a report of what was created vs skipped.
 */
export async function bootstrap(
	repoRoot: string,
	options?: InitOptions,
): Promise<Result<InitReport>> {
	const force = options?.force ?? false;
	const mainaDir = join(repoRoot, ".maina");
	const created: string[] = [];
	const skipped: string[] = [];

	try {
		// Ensure .maina/ exists
		mkdirSync(mainaDir, { recursive: true });

		// Create extra directories (e.g. hooks)
		for (const dir of EXTRA_DIRS) {
			mkdirSync(join(repoRoot, dir), { recursive: true });
		}

		// Scaffold each file
		const manifest = getFileManifest();
		for (const entry of manifest) {
			const fullPath = join(repoRoot, entry.relativePath);
			const dirPath = join(fullPath, "..");

			// Ensure parent directory exists
			mkdirSync(dirPath, { recursive: true });

			if (existsSync(fullPath) && !force) {
				skipped.push(entry.relativePath);
			} else {
				writeFileSync(fullPath, entry.content, "utf-8");
				created.push(entry.relativePath);
			}
		}

		return {
			ok: true,
			value: { created, skipped, directory: mainaDir },
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
