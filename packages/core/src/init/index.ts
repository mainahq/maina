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
	updated: string[];
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
	/** package.json scripts (e.g. { test: "vitest", build: "tsc" }) */
	scripts: Record<string, string>;
	/** Build tool detected (e.g. "vite", "webpack", "tsup", "bunup", "esbuild") */
	buildTool: string;
	/** Whether this is a monorepo (workspaces detected) */
	monorepo: boolean;
	/** Inferred conventions from project context */
	conventions: string[];
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
		scripts: {},
		buildTool: "unknown",
		monorepo: false,
		conventions: [],
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

			// Extract scripts
			if (pkg.scripts && typeof pkg.scripts === "object") {
				stack.scripts = pkg.scripts as Record<string, string>;
			}

			// Detect monorepo (workspaces)
			if (pkg.workspaces) {
				stack.monorepo = true;
			}
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

		// Build tool detection
		if (allDeps.bunup) {
			stack.buildTool = "bunup";
		} else if (allDeps.tsup) {
			stack.buildTool = "tsup";
		} else if (allDeps.vite) {
			stack.buildTool = "vite";
		} else if (allDeps.webpack) {
			stack.buildTool = "webpack";
		} else if (allDeps.esbuild) {
			stack.buildTool = "esbuild";
		} else if (allDeps.rollup) {
			stack.buildTool = "rollup";
		} else if (allDeps.turbo) {
			stack.buildTool = "turborepo";
		}

		// Also check for monorepo tools
		if (
			allDeps.turbo ||
			allDeps.nx ||
			allDeps.lerna ||
			existsSync(join(repoRoot, "pnpm-workspace.yaml"))
		) {
			stack.monorepo = true;
		}
	}

	// ── Infer conventions from project context ───────────────────────────
	const conventions: string[] = [];

	// Check for conventional commits
	if (
		existsSync(join(repoRoot, "commitlint.config.js")) ||
		existsSync(join(repoRoot, "commitlint.config.ts")) ||
		existsSync(join(repoRoot, ".commitlintrc.json")) ||
		existsSync(join(repoRoot, ".commitlintrc.yml"))
	) {
		conventions.push("Conventional commits enforced via commitlint");
	}

	// Check for git hooks
	if (existsSync(join(repoRoot, "lefthook.yml"))) {
		conventions.push("Git hooks via lefthook");
	} else if (existsSync(join(repoRoot, ".husky"))) {
		conventions.push("Git hooks via husky");
	}

	// Check for strict TypeScript
	if (existsSync(join(repoRoot, "tsconfig.json"))) {
		try {
			const tsconfig = readFileSync(join(repoRoot, "tsconfig.json"), "utf-8");
			if (tsconfig.includes('"strict"') && tsconfig.includes("true")) {
				conventions.push("TypeScript strict mode enabled");
			}
		} catch {
			// ignore
		}
	}

	// Check for Docker
	if (
		existsSync(join(repoRoot, "Dockerfile")) ||
		existsSync(join(repoRoot, "docker-compose.yml")) ||
		existsSync(join(repoRoot, "docker-compose.yaml"))
	) {
		conventions.push("Docker containerization");
	}

	// Check for CI
	if (existsSync(join(repoRoot, ".github/workflows"))) {
		conventions.push("GitHub Actions CI/CD");
	} else if (existsSync(join(repoRoot, ".gitlab-ci.yml"))) {
		conventions.push("GitLab CI/CD");
	} else if (existsSync(join(repoRoot, ".circleci"))) {
		conventions.push("CircleCI");
	}

	// Check for env management
	if (existsSync(join(repoRoot, ".env.example"))) {
		conventions.push("Environment variables documented in .env.example");
	}

	// Infer from package.json scripts
	if (stack.scripts.lint || stack.scripts["lint:fix"]) {
		conventions.push(
			`Lint command: \`${stack.runtime === "bun" ? "bun" : "npm"} run lint\``,
		);
	}
	if (stack.scripts.test) {
		conventions.push(`Test command: \`${stack.scripts.test}\``);
	}
	if (stack.scripts.build) {
		conventions.push(`Build command: \`${stack.scripts.build}\``);
	}
	if (stack.scripts.typecheck || stack.scripts["type-check"]) {
		conventions.push("Type checking enforced");
	}

	stack.conventions = conventions;

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
| \`analyzeFeature\` | Analyze a feature directory for consistency |
| \`wikiQuery\` | Search wiki for codebase knowledge — "how does auth work?" |
| \`wikiStatus\` | Wiki health check — article counts, staleness, coverage |`;

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

	const buildLine =
		stack.buildTool !== "unknown" ? `- Build: ${stack.buildTool}\n` : "";

	const monorepoLine = stack.monorepo ? "- Monorepo: yes (workspaces)\n" : "";

	// Build architecture section from context
	const archLines: string[] = [];
	if (stack.monorepo) {
		archLines.push("- Monorepo with shared packages");
	}
	if (stack.framework !== "none") {
		archLines.push(`- ${stack.framework} application`);
	}
	if (stack.languages.length > 1) {
		archLines.push(`- Multi-language: ${stack.languages.join(", ")}`);
	}
	const archSection =
		archLines.length > 0
			? archLines.join("\n")
			: "- [NEEDS CLARIFICATION] Define architectural constraints.";

	// Build verification section from scripts
	const verifyLines: string[] = [];
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	if (stack.scripts.lint || stack.linter !== "unknown") {
		verifyLines.push(
			`- Lint: \`${stack.scripts.lint ?? `${runCmd} run lint`}\``,
		);
	}
	if (stack.language === "typescript") {
		verifyLines.push(
			`- Typecheck: \`${stack.scripts.typecheck ?? stack.scripts["type-check"] ?? `${runCmd} run typecheck`}\``,
		);
	}
	if (stack.scripts.test) {
		verifyLines.push(`- Test: \`${stack.scripts.test}\``);
	} else if (stack.testRunner !== "unknown") {
		verifyLines.push(`- Test: \`${runCmd} test\``);
	}
	verifyLines.push("- Diff-only: only report findings on changed lines");

	// Build conventions section from detected conventions
	const conventionLines =
		stack.conventions.length > 0
			? stack.conventions.map((c) => `- ${c}`).join("\n")
			: "- [NEEDS CLARIFICATION] Add project-specific conventions.";

	return `# Project Constitution

Non-negotiable rules. Injected into every AI call.

## Stack
${runtimeLine}
${langLine}
${lintLine}
${testLine}
${frameworkLine}${buildLine}${monorepoLine}
## Architecture
${archSection}

## Verification
${verifyLines.join("\n")}

## Conventions
${conventionLines}
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

## Wiki

If \`.maina/wiki/\` exists, use wiki tools for context:
- \`wikiQuery\` before coding — understand existing patterns and decisions
- \`wikiStatus\` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

## Config Files
| File | Purpose | Who Edits |
|------|---------|-----------|
| \`.maina/constitution.md\` | Project DNA — stack, rules, gates | Team (stable, rarely changes) |
| \`AGENTS.md\` | Agent instructions — commands, conventions | Team |
| \`.github/copilot-instructions.md\` | Copilot agent instructions + MCP tools | Team |
| \`CLAUDE.md\` | Claude Code specific instructions | Optional, Claude Code users |
| \`GEMINI.md\` | Gemini CLI specific instructions | Optional, Gemini CLI users |
| \`.cursorrules\` | Cursor specific instructions | Optional, Cursor users |
| \`.windsurfrules\` | Windsurf specific instructions | Optional, Windsurf users |
| \`.clinerules\` | Cline specific instructions | Optional, Cline users |
| \`.continue/\` | Continue.dev config + MCP | Optional, Continue.dev users |
| \`.roo/\` | Roo Code MCP config + rules | Optional, Roo Code users |
| \`.amazonq/mcp.json\` | Amazon Q MCP config | Optional, Amazon Q users |
| \`.aider.conf.yml\` | Aider config | Optional, Aider users |
| \`CONVENTIONS.md\` | Project conventions (Aider, generic) | Team |
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

## Wiki

If \`.maina/wiki/\` exists, use wiki tools for context:
- \`wikiQuery\` before coding — understand existing patterns and decisions
- \`wikiStatus\` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

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

// ── Maina Section (for merging into existing agent files) ──────────────────

/** Agent file names that support maina section merging */
const MERGEABLE_AGENT_FILES = [
	"AGENTS.md",
	"CLAUDE.md",
	"GEMINI.md",
	".cursorrules",
	".github/copilot-instructions.md",
	".windsurfrules",
	".clinerules",
	".roo/rules/maina.md",
	"CONVENTIONS.md",
];

/**
 * Build a standalone "## Maina" section that can be appended to an existing
 * agent file. Contains essential maina workflow + MCP tools info.
 */
export function buildMainaSection(_stack: DetectedStack): string {
	return `## Maina

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read \`.maina/constitution.md\` for project DNA.

### Workflow
\`${WORKFLOW_ORDER}\`

### MCP Tools
${MCP_TOOLS_TABLE}
`;
}

// ── .mcp.json ───────────────────────────────────────────────────────────────

function buildMcpJson(stack: DetectedStack): string {
	const command = stack.runtime === "bun" ? "bunx" : "npx";
	return JSON.stringify(
		{
			mcpServers: {
				maina: {
					command,
					args: ["@mainahq/cli", "--mcp"],
				},
			},
		},
		null,
		2,
	);
}

// ── .claude/settings.json (Claude Code MCP config) ─────────────────────────

function buildClaudeSettings(stack: DetectedStack): string {
	const command = stack.runtime === "bun" ? "bunx" : "npx";
	return JSON.stringify(
		{
			mcpServers: {
				maina: {
					command,
					args: ["@mainahq/cli", "--mcp"],
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

## Wiki

If \`.maina/wiki/\` exists, use wiki tools for context:
- \`wikiQuery\` before coding — understand existing patterns and decisions
- \`wikiStatus\` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

## Commands

\`\`\`bash
# Workflow
maina brainstorm  # explore ideas interactively
maina ticket      # create GitHub issue with module tagging
maina plan <name> # scaffold feature branch + directory
maina design      # create ADR (architecture decision record)
maina spec        # generate TDD test stubs from plan

# Verify & Review
maina verify      # run full verification pipeline (12+ tools)
maina review      # two-stage code review
maina slop        # detect AI-generated slop patterns
maina commit      # verify + commit staged changes

# Wiki (codebase knowledge)
maina wiki init    # compile codebase knowledge wiki
maina wiki query   # ask questions about the codebase
maina wiki compile # recompile wiki (incremental)
maina wiki status  # wiki health dashboard
maina wiki lint    # check wiki for issues

# Context & Info
maina context     # generate focused codebase context
maina explain     # explain a module with wiki context
maina doctor      # check tool health
maina stats       # verification metrics
maina status      # branch health overview
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

## Wiki

If \`.maina/wiki/\` exists, use wiki tools for context:
- \`wikiQuery\` before coding — understand existing patterns and decisions
- \`wikiStatus\` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

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

## Wiki

If \`.maina/wiki/\` exists, use wiki tools for context:
- \`wikiQuery\` before coding — understand existing patterns and decisions
- \`wikiStatus\` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

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

// ── Windsurf ────────────────────────────────────────────────────────────────

function buildWindsurfRules(stack: DetectedStack): string {
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	return `# Windsurf Rules

This repo uses Maina for verification-first development.
Read \`.maina/constitution.md\` for project DNA.

## Workflow Order
${WORKFLOW_ORDER}

## MCP Tools (via .mcp.json)
${MCP_TOOLS_TABLE}

## Wiki

If \`.maina/wiki/\` exists, use wiki tools for context:
- \`wikiQuery\` before coding — understand existing patterns and decisions
- \`wikiStatus\` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

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

// ── Cline ───────────────────────────────────────────────────────────────────

function buildClineRules(stack: DetectedStack): string {
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	return `# Cline Rules

This repo uses Maina for verification-first development.
Read \`.maina/constitution.md\` for project DNA.

## Workflow Order
${WORKFLOW_ORDER}

## MCP Tools (via .mcp.json)
${MCP_TOOLS_TABLE}

## Wiki

If \`.maina/wiki/\` exists, use wiki tools for context:
- \`wikiQuery\` before coding — understand existing patterns and decisions
- \`wikiStatus\` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

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

// ── Continue.dev ─────────────────────────────────────────────────────────────

function buildContinueConfig(_stack: DetectedStack): string {
	return `# Continue.dev configuration — auto-generated by maina init
# See https://docs.continue.dev/reference/config

customInstructions: |
  This repo uses Maina for verification-first development.
  Read .maina/constitution.md for project DNA.
  Workflow: ${WORKFLOW_ORDER}
  Always run maina verify before committing.
  Use MCP tools: getContext, verify, checkSlop, reviewCode, suggestTests.
`;
}

function buildContinueMcpJson(stack: DetectedStack): string {
	const command = stack.runtime === "bun" ? "bunx" : "npx";
	return JSON.stringify(
		{
			maina: {
				command,
				args: ["@mainahq/cli", "--mcp"],
			},
		},
		null,
		2,
	);
}

// ── Roo Code ────────────────────────────────────────────────────────────────

function buildRooMcpJson(stack: DetectedStack): string {
	const command = stack.runtime === "bun" ? "bunx" : "npx";
	return JSON.stringify(
		{
			mcpServers: {
				maina: {
					command,
					args: ["@mainahq/cli", "--mcp"],
				},
			},
		},
		null,
		2,
	);
}

function buildRooRules(stack: DetectedStack): string {
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	return `# Maina

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read \`.maina/constitution.md\` for project DNA.

## Workflow Order
${WORKFLOW_ORDER}

## MCP Tools
${MCP_TOOLS_TABLE}

## Wiki

If \`.maina/wiki/\` exists, use wiki tools for context:
- \`wikiQuery\` before coding — understand existing patterns and decisions
- \`wikiStatus\` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

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

// ── Amazon Q ────────────────────────────────────────────────────────────────

function buildAmazonQMcpJson(stack: DetectedStack): string {
	const command = stack.runtime === "bun" ? "bunx" : "npx";
	return JSON.stringify(
		{
			mcpServers: {
				maina: {
					command,
					args: ["@mainahq/cli", "--mcp"],
				},
			},
		},
		null,
		2,
	);
}

// ── Aider ───────────────────────────────────────────────────────────────────

function buildAiderConfig(_stack: DetectedStack): string {
	return `# Maina conventions — auto-generated by maina init
read: [CONVENTIONS.md, .maina/constitution.md]
auto-commits: false
`;
}

function buildConventionsMd(stack: DetectedStack): string {
	const runCmd = stack.runtime === "bun" ? "bun" : "npm";
	return `# Conventions

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read \`.maina/constitution.md\` for project DNA — stack rules, conventions, and gates.

## Maina Workflow

Follow this order for every feature:
\`${WORKFLOW_ORDER}\`

## MCP Tools

Maina exposes MCP tools — use them in every session:

${MCP_TOOLS_TABLE}

## Wiki

If \`.maina/wiki/\` exists, use wiki tools for context:
- \`wikiQuery\` before coding — understand existing patterns and decisions
- \`wikiStatus\` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

## Key Commands

- \`maina verify\` — run full verification pipeline
- \`maina commit\` — verify + commit
- \`maina review\` — two-stage code review
- \`maina context\` — generate focused codebase context
- \`maina doctor\` — check tool health

## Conventions

- Runtime: ${stack.runtime}
- Test: \`${runCmd} test\`
- Conventional commits (feat, fix, refactor, test, docs, chore)
- No \`console.log\` in production code
- Diff-only: only report findings on changed lines
- TDD always — write tests first
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
			content: buildMcpJson(stack),
		},
		{
			relativePath: ".claude/settings.json",
			content: buildClaudeSettings(stack),
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
		{
			relativePath: ".windsurfrules",
			content: buildWindsurfRules(stack),
		},
		{
			relativePath: ".clinerules",
			content: buildClineRules(stack),
		},
		{
			relativePath: ".continue/config.yaml",
			content: buildContinueConfig(stack),
		},
		{
			relativePath: ".continue/mcpServers/maina.json",
			content: buildContinueMcpJson(stack),
		},
		{
			relativePath: ".roo/mcp.json",
			content: buildRooMcpJson(stack),
		},
		{
			relativePath: ".roo/rules/maina.md",
			content: buildRooRules(stack),
		},
		{
			relativePath: ".amazonq/mcp.json",
			content: buildAmazonQMcpJson(stack),
		},
		{
			relativePath: ".aider.conf.yml",
			content: buildAiderConfig(stack),
		},
		{
			relativePath: "CONVENTIONS.md",
			content: buildConventionsMd(stack),
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
	const updated: string[] = [];

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
				// Try to merge maina section for agent files
				if (
					MERGEABLE_AGENT_FILES.some((af) => entry.relativePath.endsWith(af))
				) {
					const existing = readFileSync(fullPath, "utf-8");
					if (!existing.includes("## Maina")) {
						const mainaSection = buildMainaSection(detectedStack);
						writeFileSync(
							fullPath,
							`${existing.trimEnd()}\n\n${mainaSection}`,
							"utf-8",
						);
						updated.push(entry.relativePath);
					} else {
						skipped.push(entry.relativePath);
					}
				} else {
					skipped.push(entry.relativePath);
				}
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
				updated,
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
