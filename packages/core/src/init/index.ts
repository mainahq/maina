/**
 * Init module — bootstraps Maina in a repository.
 *
 * Creates `.maina/` directory structure and scaffolds default files.
 * Detects project type from package.json and customizes templates.
 * Never overwrites existing files unless `force: true`.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";
import type { DetectedTool } from "../verify/detect";
import { detectTools } from "../verify/detect";

// ── Types ────────────────────────────────────────────────────────────────────

export interface InitOptions {
	force?: boolean;
	aiGenerate?: boolean;
}

export interface InitReport {
	created: string[];
	skipped: string[];
	directory: string;
	detectedStack: DetectedStack;
	detectedTools: DetectedTool[];
	aiGenerated?: boolean;
}

export interface DetectedStack {
	runtime: "bun" | "node" | "deno" | "unknown";
	language: "typescript" | "javascript" | "unknown";
	languages: string[];
	testRunner: string;
	linter: string;
	framework: string;
}

// ── Project Detection ───────────────────────────────────────────────────────

function detectStack(repoRoot: string): DetectedStack {
	const stack: DetectedStack = {
		runtime: "unknown",
		language: "unknown",
		languages: [],
		testRunner: "unknown",
		linter: "unknown",
		framework: "none",
	};

	// ── Multi-language detection (file-marker based) ─────────────────────
	const languages: string[] = [];

	// Go
	if (existsSync(join(repoRoot, "go.mod"))) {
		languages.push("go");
	}

	// Rust
	if (existsSync(join(repoRoot, "Cargo.toml"))) {
		languages.push("rust");
	}

	// Python
	if (
		existsSync(join(repoRoot, "pyproject.toml")) ||
		existsSync(join(repoRoot, "requirements.txt")) ||
		existsSync(join(repoRoot, "setup.py"))
	) {
		languages.push("python");
	}

	// Java
	if (
		existsSync(join(repoRoot, "pom.xml")) ||
		existsSync(join(repoRoot, "build.gradle")) ||
		existsSync(join(repoRoot, "build.gradle.kts"))
	) {
		languages.push("java");
	}

	// .NET (C#/F#) — check for .csproj, .fsproj, .sln files
	try {
		const entries = readdirSync(repoRoot);
		if (
			entries.some(
				(e: string) =>
					e.endsWith(".csproj") || e.endsWith(".sln") || e.endsWith(".fsproj"),
			)
		) {
			languages.push("dotnet");
		}
	} catch {
		// Directory not readable — skip
	}

	// ── JS/TS detection from package.json ───────────────────────────────
	const pkgPath = join(repoRoot, "package.json");
	let hasPkgJson = false;
	let allDeps: Record<string, string> = {};

	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<
				string,
				unknown
			>;
			hasPkgJson = true;
			allDeps = {
				...(pkg.dependencies as Record<string, string> | undefined),
				...(pkg.devDependencies as Record<string, string> | undefined),
				...(pkg.peerDependencies as Record<string, string> | undefined),
			};
		} catch {
			// Malformed package.json — skip
		}
	}

	if (hasPkgJson) {
		// Runtime detection
		if (
			allDeps["@types/bun"] ||
			allDeps["bun-types"] ||
			existsSync(join(repoRoot, "bun.lock"))
		) {
			stack.runtime = "bun";
		} else if (
			existsSync(join(repoRoot, "deno.json")) ||
			existsSync(join(repoRoot, "deno.jsonc"))
		) {
			stack.runtime = "deno";
		} else {
			stack.runtime = "node";
		}

		// Language detection (single primary)
		if (existsSync(join(repoRoot, "tsconfig.json")) || allDeps.typescript) {
			stack.language = "typescript";
			if (!languages.includes("typescript")) {
				languages.push("typescript");
			}
		} else {
			stack.language = "javascript";
			if (!languages.includes("javascript")) {
				languages.push("javascript");
			}
		}

		// Test runner detection
		if (stack.runtime === "bun") {
			stack.testRunner = "bun:test";
		} else if (allDeps.vitest) {
			stack.testRunner = "vitest";
		} else if (allDeps.jest || allDeps["@jest/core"]) {
			stack.testRunner = "jest";
		} else if (allDeps.mocha) {
			stack.testRunner = "mocha";
		}

		// Linter detection
		if (allDeps["@biomejs/biome"]) {
			stack.linter = "biome";
		} else if (allDeps.eslint) {
			stack.linter = "eslint";
		} else if (allDeps.prettier) {
			stack.linter = "prettier";
		}

		// Framework detection
		if (allDeps.next) {
			stack.framework = "next.js";
		} else if (allDeps.express) {
			stack.framework = "express";
		} else if (allDeps.hono) {
			stack.framework = "hono";
		} else if (allDeps.react && !allDeps.next) {
			stack.framework = "react";
		} else if (allDeps.vue) {
			stack.framework = "vue";
		} else if (allDeps.svelte) {
			stack.framework = "svelte";
		}
	}

	// If no languages detected, mark as unknown
	stack.languages = languages.length > 0 ? languages : ["unknown"];

	return stack;
}

// ── Constants (shared across agent files) ───────────────────────────────────

const WORKFLOW_ORDER =
	"brainstorm -> ticket -> plan -> design -> spec -> implement -> verify -> review -> fix -> commit -> review -> pr";

const MCP_TOOLS_TABLE = `| Tool | When to use |
|------|-------------|
| \`getContext\` | Before starting — understand branch state and verification status |
| \`verify\` | After changes — run the full verification pipeline |
| \`checkSlop\` | On changed files — detect AI-generated slop patterns |
| \`reviewCode\` | On your diff — two-stage review (spec compliance + code quality) |
| \`suggestTests\` | When implementing — generate TDD test stubs |
| \`getConventions\` | Understand project coding conventions |
| \`explainModule\` | Understand a module's purpose and dependencies |
| \`analyzeFeature\` | Analyze a feature directory for consistency |`;

// ── Templates ────────────────────────────────────────────────────────────────

function buildConstitution(stack: DetectedStack): string {
	const runtimeLine =
		stack.runtime !== "unknown"
			? `- Runtime: ${stack.runtime === "bun" ? "Bun (NOT Node.js)" : stack.runtime}`
			: "- Runtime: [NEEDS CLARIFICATION]";

	const langLine =
		stack.language !== "unknown"
			? `- Language: ${stack.language === "typescript" ? "TypeScript strict mode" : "JavaScript"}`
			: "- Language: [NEEDS CLARIFICATION]";

	const lintLine =
		stack.linter !== "unknown"
			? `- Lint/Format: ${stack.linter}`
			: "- Lint/Format: [NEEDS CLARIFICATION]";

	const testLine =
		stack.testRunner !== "unknown"
			? `- Test: ${stack.testRunner}`
			: "- Test: [NEEDS CLARIFICATION]";

	const frameworkLine =
		stack.framework !== "none" ? `- Framework: ${stack.framework}\n` : "";

	return `# Project Constitution

Non-negotiable rules. Injected into every AI call.

## Stack
${runtimeLine}
${langLine}
${lintLine}
${testLine}
${frameworkLine}
## Architecture
- [NEEDS CLARIFICATION] Define architectural constraints.

## Verification
- All commits pass: lint + typecheck + test
- Diff-only: only report findings on changed lines

## Conventions
- [NEEDS CLARIFICATION] Add project-specific conventions.
`;
}

function buildAgentsMd(stack: DetectedStack): string {
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	const installCmd = stack.runtime === "bun" ? "bun install" : "npm install";

	return `# AGENTS.md

This repo uses [Maina](https://github.com/mainahq/maina) for verification-first development.

## Workflow Order

Follow this order for every feature:
\`${WORKFLOW_ORDER}\`

## Quick Start
\`\`\`bash
${installCmd}
maina doctor    # check tool health
maina verify    # run verification pipeline
maina commit    # verify + commit
\`\`\`

## Commands
| Command | Purpose |
|---------|---------|
| \`maina commit\` | Verify staged changes and commit |
| \`maina verify\` | Run full verification pipeline |
| \`maina context\` | Generate focused codebase context |
| \`maina plan <name>\` | Create feature with spec/plan/tasks |
| \`maina analyze\` | Check spec/plan consistency |
| \`maina review\` | Two-stage code review |
| \`maina stats\` | Show verification metrics |
| \`maina doctor\` | Check tool health |

## MCP Tools

${MCP_TOOLS_TABLE}

## Config Files
| File | Purpose | Who Edits |
|------|---------|-----------|
| \`.maina/constitution.md\` | Project DNA — stack, rules, gates | Team (stable, rarely changes) |
| \`AGENTS.md\` | Agent instructions — commands, conventions | Team |
| \`.github/copilot-instructions.md\` | Copilot agent instructions + MCP tools | Team |
| \`CLAUDE.md\` | Claude Code specific instructions | Optional, Claude Code users |
| \`GEMINI.md\` | Gemini CLI specific instructions | Optional, Gemini CLI users |
| \`.cursorrules\` | Cursor specific instructions | Optional, Cursor users |
| \`.mcp.json\` | MCP server configuration | Team |
| \`.maina/prompts/*.md\` | Prompt overrides for review/commit/etc | Maina (via \`maina learn\`) |

## Runtime
- Package manager: \`${runCmd}\`
- Test: \`${runCmd} test\`
`;
}

function buildCopilotInstructions(stack: DetectedStack): string {
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	return `# Copilot Instructions

You are working on a codebase verified by [Maina](https://mainahq.com), the verification-first developer OS. Maina MCP tools are available — use them.

## Workflow Order

Follow this order for every feature:
\`${WORKFLOW_ORDER}\`

## Step-by-step

1. **Get context** — call \`maina getContext\` to understand codebase state
2. **Write tests first** — TDD always. Write failing tests, then implement
3. **Verify your work** — call \`maina verify\` before requesting review
4. **Check for slop** — call \`maina checkSlop\` on changed files
5. **Review your code** — call \`maina reviewCode\` with your diff

## Available MCP Tools

${MCP_TOOLS_TABLE}

## Conventions

- Runtime: ${stack.runtime}
- Test: \`${runCmd} test\`
- Commits: conventional commits (feat, fix, refactor, test, docs, chore)
- No \`console.log\` in production code
- Diff-only: only fix issues on changed lines

## When Working on Audit Issues

Issues labeled \`audit\` come from maina's daily verification. Fix the specific findings listed — don't refactor unrelated code.
`;
}

// ── .mcp.json ───────────────────────────────────────────────────────────────

function buildMcpJson(): string {
	return JSON.stringify(
		{
			mcpServers: {
				maina: {
					command: "maina",
					args: ["--mcp"],
				},
			},
		},
		null,
		2,
	);
}

// ── Agent Instruction Files ─────────────────────────────────────────────────

function buildClaudeMd(stack: DetectedStack): string {
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	return `# CLAUDE.md

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read \`.maina/constitution.md\` for project DNA — stack rules, conventions, and gates.

## Maina Workflow

Follow this order for every feature:
\`${WORKFLOW_ORDER}\`

## MCP Tools

Maina exposes MCP tools — use them in every session:

${MCP_TOOLS_TABLE}

## Commands

\`\`\`bash
maina verify    # run full verification pipeline
maina commit    # verify + commit
maina review    # two-stage code review
maina context   # generate focused codebase context
maina doctor    # check tool health
maina plan      # create feature with spec/plan/tasks
maina stats     # show verification metrics
\`\`\`

## Conventions

- Runtime: ${stack.runtime}
- Test: \`${runCmd} test\`
- Conventional commits (feat, fix, refactor, test, docs, chore)
- No \`console.log\` in production code
- Diff-only: only fix issues on changed lines
- TDD always — write tests first
`;
}

function buildGeminiMd(stack: DetectedStack): string {
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	return `# GEMINI.md

Instructions for Gemini CLI when working in this repository.

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read \`.maina/constitution.md\` for project DNA — stack rules, conventions, and gates.

## Maina Workflow

Follow this order for every feature:
\`${WORKFLOW_ORDER}\`

## MCP Tools

Maina exposes MCP tools via \`.mcp.json\`. Use them:

${MCP_TOOLS_TABLE}

## Key Commands

- \`maina verify\` — run full verification pipeline
- \`maina commit\` — verify + commit
- \`maina review\` — two-stage code review
- \`maina context\` — generate focused codebase context
- \`maina doctor\` — check tool health

## Rules

- Runtime: ${stack.runtime}
- Test: \`${runCmd} test\`
- Conventional commits (feat, fix, refactor, test, docs, chore)
- No \`console.log\` in production code
- Diff-only: only report findings on changed lines
- TDD always — write tests first
`;
}

function buildCursorRules(stack: DetectedStack): string {
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	return `# Cursor Rules

This repo uses Maina for verification-first development.
Read \`.maina/constitution.md\` for project DNA.

## Workflow Order
${WORKFLOW_ORDER}

## MCP Tools (via .mcp.json)
${MCP_TOOLS_TABLE}

## Commands
- maina verify — run full verification pipeline
- maina commit — verify + commit
- maina review — two-stage code review
- maina context — generate focused codebase context

## Conventions
- Runtime: ${stack.runtime}
- Test: ${runCmd} test
- Conventional commits
- No console.log in production
- Diff-only: only report findings on changed lines
- TDD: write tests first, then implement
`;
}

// ── AI-Generated Constitution ───────────────────────────────────────────────

function buildProjectSummary(repoRoot: string, stack: DetectedStack): string {
	const parts: string[] = [];
	parts.push("## Detected Project Stack");
	parts.push(`- Runtime: ${stack.runtime}`);
	parts.push(`- Primary language: ${stack.language}`);
	parts.push(`- All languages: ${stack.languages.join(", ")}`);
	parts.push(`- Test runner: ${stack.testRunner}`);
	parts.push(`- Linter: ${stack.linter}`);
	parts.push(`- Framework: ${stack.framework}`);

	// Read package.json for extra context
	const pkgPath = join(repoRoot, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<
				string,
				unknown
			>;
			const deps = Object.keys(
				(pkg.dependencies as Record<string, string>) ?? {},
			);
			const devDeps = Object.keys(
				(pkg.devDependencies as Record<string, string>) ?? {},
			);
			if (deps.length > 0) {
				parts.push(`\n## Dependencies\n${deps.join(", ")}`);
			}
			if (devDeps.length > 0) {
				parts.push(`\n## Dev Dependencies\n${devDeps.join(", ")}`);
			}
			if (pkg.description) {
				parts.push(`\n## Project Description\n${pkg.description}`);
			}
		} catch {
			// Ignore parse errors
		}
	}

	// Check for common config files
	const configFiles: string[] = [];
	const checks = [
		"tsconfig.json",
		"biome.json",
		".eslintrc.json",
		"jest.config.ts",
		"vitest.config.ts",
		"Dockerfile",
		"docker-compose.yml",
		".env.example",
		"Makefile",
	];
	for (const f of checks) {
		if (existsSync(join(repoRoot, f))) {
			configFiles.push(f);
		}
	}
	if (configFiles.length > 0) {
		parts.push(`\n## Config Files Found\n${configFiles.join(", ")}`);
	}

	return parts.join("\n");
}

async function tryGenerateConstitution(
	repoRoot: string,
	stack: DetectedStack,
): Promise<string | null> {
	try {
		const { tryAIGenerate } = await import("../ai/try-generate");
		const mainaDir = join(repoRoot, ".maina");
		const summary = buildProjectSummary(repoRoot, stack);

		const result = await tryAIGenerate(
			"init-constitution",
			mainaDir,
			{
				stack_runtime: stack.runtime,
				stack_language: stack.language,
				stack_languages: stack.languages.join(", "),
				stack_testRunner: stack.testRunner,
				stack_linter: stack.linter,
				stack_framework: stack.framework,
			},
			`Generate a project constitution for this software project based on the detected stack information below.

A constitution defines non-negotiable rules injected into every AI call. It should include:
1. Stack section — runtime, language, linter, test runner, framework
2. Architecture section — key architectural constraints (infer from the stack)
3. Verification section — what must pass before code merges
4. Conventions section — coding conventions (infer from the stack)

Replace [NEEDS CLARIFICATION] placeholders with reasonable defaults based on the stack.
Keep it concise (under 50 lines). Use markdown format starting with "# Project Constitution".

${summary}`,
		);

		if (result.fromAI && result.text) {
			return result.text;
		}
	} catch {
		// AI unavailable — fall back to static template
	}
	return null;
}

const REVIEW_PROMPT_TEMPLATE = `# Review Prompt

Review the following code changes for:
1. Correctness — does the code do what it claims?
2. Style — does it follow project conventions?
3. Safety — are there security or performance concerns?
4. Tests — are changes adequately tested?
`;

const COMMIT_PROMPT_TEMPLATE = `# Commit Message Prompt

Generate a conventional commit message for the staged changes.

Format: <type>(<scope>): <description>

Types: feat, fix, refactor, test, docs, chore, ci, perf
`;

function buildCiWorkflow(stack: DetectedStack): string {
	const isBun = stack.runtime === "bun";
	const setup = isBun
		? "      - uses: oven-sh/setup-bun@v2"
		: "      - uses: actions/setup-node@v4";
	const install = isBun ? "bun install" : "npm ci";
	const check = isBun ? "bun run check" : "npm run lint";
	const typecheck =
		stack.language === "typescript"
			? `      - run: ${isBun ? "bun run typecheck" : "npx tsc --noEmit"}\n`
			: "";
	const test = isBun ? "bun test" : "npm test";

	return `name: Maina CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${setup}
      - run: ${install}
      - run: ${check}
${typecheck}      - run: ${test}
`;
}

// ── File Manifest ────────────────────────────────────────────────────────────

interface FileEntry {
	/** Path relative to repoRoot */
	relativePath: string;
	content: string;
}

function getFileManifest(
	stack: DetectedStack,
	constitutionOverride?: string,
): FileEntry[] {
	return [
		{
			relativePath: ".maina/constitution.md",
			content: constitutionOverride ?? buildConstitution(stack),
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
			content: buildAgentsMd(stack),
		},
		{
			relativePath: ".github/workflows/maina-ci.yml",
			content: buildCiWorkflow(stack),
		},
		{
			relativePath: ".github/copilot-instructions.md",
			content: buildCopilotInstructions(stack),
		},
		{
			relativePath: ".mcp.json",
			content: buildMcpJson(),
		},
		{
			relativePath: "CLAUDE.md",
			content: buildClaudeMd(stack),
		},
		{
			relativePath: "GEMINI.md",
			content: buildGeminiMd(stack),
		},
		{
			relativePath: ".cursorrules",
			content: buildCursorRules(stack),
		},
	];
}

/**
 * Build a sensible default biome.json for projects without a linter.
 * Ensures every maina-initialized project has at least one real linter.
 */
function buildBiomeConfig(): string {
	return JSON.stringify(
		{
			$schema: "https://biomejs.dev/schemas/2.0.0/schema.json",
			linter: {
				enabled: true,
				rules: {
					recommended: true,
					correctness: {
						noUnusedVariables: "warn",
						noUnusedImports: "warn",
					},
					style: {
						useConst: "error",
					},
				},
			},
			formatter: {
				enabled: true,
				indentStyle: "tab",
				lineWidth: 100,
			},
		},
		null,
		2,
	);
}

/** Directories to create even if they have no files */
const EXTRA_DIRS = [".maina/hooks"];

// ── Core Function ────────────────────────────────────────────────────────────

/**
 * Bootstrap Maina in the given repository root.
 *
 * Detects project type from package.json and customizes templates.
 * Creates `.maina/` directory structure and scaffolds default files.
 * Never overwrites existing files unless `force: true`.
 * Returns a report of what was created vs skipped.
 */
export async function bootstrap(
	repoRoot: string,
	options?: InitOptions,
): Promise<Result<InitReport>> {
	const force = options?.force ?? false;
	const aiGenerate = options?.aiGenerate ?? false;
	const mainaDir = join(repoRoot, ".maina");
	const created: string[] = [];
	const skipped: string[] = [];

	try {
		// Detect project stack from package.json
		const detectedStack = detectStack(repoRoot);

		// Detect available verification tools on PATH (filtered by project languages)
		const detectedToolsList = await detectTools(detectedStack.languages);

		// Ensure .maina/ exists
		mkdirSync(mainaDir, { recursive: true });

		// Create extra directories (e.g. hooks)
		for (const dir of EXTRA_DIRS) {
			mkdirSync(join(repoRoot, dir), { recursive: true });
		}

		// Try AI-generated constitution when requested
		let constitutionOverride: string | undefined;
		let aiGenerated = false;
		if (aiGenerate) {
			const aiConstitution = await tryGenerateConstitution(
				repoRoot,
				detectedStack,
			);
			if (aiConstitution) {
				constitutionOverride = aiConstitution;
				aiGenerated = true;
			}
		}

		// Scaffold each file with stack-aware templates
		const manifest = getFileManifest(detectedStack, constitutionOverride);
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

		// ── Auto-configure Biome if no linter detected ──────────────────
		if (detectedStack.linter === "unknown") {
			const biomePath = join(repoRoot, "biome.json");
			if (!existsSync(biomePath) || force) {
				const biomeConfig = buildBiomeConfig();
				writeFileSync(biomePath, biomeConfig, "utf-8");
				created.push("biome.json");
				detectedStack.linter = "biome";
			}
		}

		return {
			ok: true,
			value: {
				created,
				skipped,
				directory: mainaDir,
				detectedStack,
				detectedTools: detectedToolsList,
				aiGenerated,
			},
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
