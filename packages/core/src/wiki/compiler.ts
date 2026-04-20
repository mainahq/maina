/**
 * Wiki Compiler — full compilation orchestrator.
 *
 * Pipeline:
 * 1. Run all extractors (code entities, features, decisions, workflow traces)
 * 2. Build the unified knowledge graph
 * 3. Run community detection (leiden-connected by default) for module boundaries
 * 4. Compute PageRank
 * 5. Generate articles using template-based compilation (no AI)
 * 6. Generate wikilinks via linker
 * 7. Generate index.md via indexer
 * 8. Save state
 * 9. Write all articles to disk
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { TryAIResult } from "../ai/try-generate";
import type { Result } from "../db/index";
import { type CommunityAlgorithm, detectCommunities } from "./communities";
import type { CodeEntity } from "./extractors/code";
import { extractCodeEntities } from "./extractors/code";
import { extractDecisions } from "./extractors/decision";
import { extractFeatures } from "./extractors/feature";
import { extractWorkflowTrace } from "./extractors/workflow";
import type { KnowledgeGraph } from "./graph";
import { buildKnowledgeGraph, computePageRank, mapToArticles } from "./graph";
import { generateIndex } from "./indexer";
import { generateLinks } from "./linker";
import { generateGraphReport, generateGraphReportJson } from "./report";
import {
	createEmptyState,
	hashContent,
	hashFile,
	loadState,
	saveState,
} from "./state";
import type {
	ArticleType,
	ExtractedDecision,
	ExtractedFeature,
	ExtractedWorkflowTrace,
	WikiArticle,
	WikiLink,
} from "./types";
import { renderGraphHtml } from "./visualize";

// ─── Types ───────────────────────────────────────────────────────────────

export interface CompilationResult {
	articles: WikiArticle[];
	graph: KnowledgeGraph;
	state: import("./types").WikiState;
	duration: number;
	stats: {
		modules: number;
		entities: number;
		features: number;
		decisions: number;
		architecture: number;
	};
}

export interface CompileOptions {
	repoRoot: string;
	mainaDir: string;
	wikiDir: string;
	full?: boolean;
	dryRun?: boolean;
	useAI?: boolean;
	/**
	 * Sample mode — cap the source file set to `SAMPLE_FILE_LIMIT` most
	 * recently modified files. Used by `maina setup` to keep first-pass
	 * compile inside a 10s foreground budget on large repos.
	 */
	sample?: boolean;
	/**
	 * Community detection algorithm. Defaults to `"leiden-connected"`, which
	 * guarantees connected communities and modularity ≥ Louvain. Pass
	 * `"louvain"` to opt back into the legacy path. See `./communities.ts`.
	 */
	communityAlgorithm?: CommunityAlgorithm;
	/**
	 * Skip emitting the machine-readable `wiki/.graph-report.json` companion.
	 * The markdown `wiki/GRAPH_REPORT.md` is still written. Default: false.
	 */
	noReportJson?: boolean;
	/**
	 * Skip emitting `wiki/graph.html` — the self-contained force-directed
	 * explorer. Default: false (viz always emitted unless `dryRun`).
	 */
	noViz?: boolean;
}

/** Hard cap for sample-mode source files. */
const SAMPLE_FILE_LIMIT = 20;

// ─── AI Enhancement ─────────────────────────────────────────────────────

/**
 * Enhance a wiki article with AI-generated natural language descriptions.
 * Falls back to the original content if AI is unavailable or fails.
 */
async function enhanceWithAI(
	article: WikiArticle,
	context: string,
	mainaDir: string,
): Promise<string> {
	try {
		const { tryAIGenerate } = await import("../ai/try-generate");
		const userPrompt = [
			"## Article to Enhance",
			"",
			article.content,
			"",
			"## Surrounding Context",
			"",
			context,
		].join("\n");

		const result: TryAIResult = await tryAIGenerate(
			"wiki-compile",
			mainaDir,
			{ task: "wiki-compile" },
			userPrompt,
		);

		// If AI returned text, use it; otherwise fall back to original
		return result.text ?? article.content;
	} catch {
		// AI failure — silently fall back to template-only
		return article.content;
	}
}

// ─── File Discovery ─────────────────────────────────────────────────────

/**
 * Recursively find all TypeScript files under the repo root.
 * Skips node_modules, dist, .git, and hidden directories.
 */
function findSourceFiles(dir: string, rootDir: string): string[] {
	const files: string[] = [];
	const skipDirs = new Set([
		"node_modules",
		"dist",
		".git",
		".maina",
		"coverage",
	]);

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return files;
	}

	for (const entry of entries) {
		if (entry.startsWith(".") || skipDirs.has(entry)) continue;

		const fullPath = join(dir, entry);
		let stat: ReturnType<typeof statSync> | null = null;
		try {
			stat = statSync(fullPath);
		} catch {
			continue;
		}

		if (stat?.isDirectory()) {
			files.push(...findSourceFiles(fullPath, rootDir));
		} else if (
			entry.endsWith(".ts") &&
			!entry.endsWith(".test.ts") &&
			!entry.endsWith(".d.ts")
		) {
			files.push(relative(rootDir, fullPath));
		}
	}

	return files;
}

// ─── Template-Based Article Generation ──────────────────────────────────

function generateModuleArticle(
	moduleName: string,
	memberEntities: CodeEntity[],
	features: ExtractedFeature[],
	decisions: ExtractedDecision[],
	pageRankScores: Map<string, number>,
): string {
	const lines: string[] = [];

	lines.push(`# Module: ${moduleName}`);
	lines.push("");
	lines.push(`> Auto-generated module article for \`${moduleName}\`.`);
	lines.push("");

	// Entities section
	lines.push("## Entities");
	lines.push("");
	if (memberEntities.length === 0) {
		lines.push("_No entities detected._");
	} else {
		// Detect duplicate entity names to enable disambiguation
		const nameCounts = new Map<string, number>();
		for (const entity of memberEntities) {
			nameCounts.set(entity.name, (nameCounts.get(entity.name) ?? 0) + 1);
		}

		const sorted = [...memberEntities].sort((a, b) => {
			const prA = pageRankScores.get(`entity:${a.name}`) ?? 0;
			const prB = pageRankScores.get(`entity:${b.name}`) ?? 0;
			return prB - prA;
		});
		for (const entity of sorted) {
			const pr = pageRankScores.get(`entity:${entity.name}`) ?? 0;
			// Disambiguate duplicate names by appending the package/top-level directory
			const isDuplicate = (nameCounts.get(entity.name) ?? 0) > 1;
			const displayName = isDuplicate
				? `${entity.name} (${entity.file.replace(/\\/g, "/").split("/")[0] ?? entity.file})`
				: entity.name;
			lines.push(
				`- **${displayName}** (${entity.kind}) — \`${entity.file}:${entity.line}\` [PR: ${pr.toFixed(4)}]`,
			);
		}
	}
	lines.push("");

	// Related features
	const relatedFeatures = features.filter((f) =>
		f.entitiesModified.some((e) => memberEntities.some((me) => me.name === e)),
	);
	if (relatedFeatures.length > 0) {
		lines.push("## Related Features");
		lines.push("");
		for (const f of relatedFeatures) {
			const status = f.merged ? "merged" : "in-progress";
			lines.push(`- [[feature:${f.id}]] — ${f.title} (${status})`);
		}
		lines.push("");
	}

	// Related decisions — only include when the module has entities and at least one
	// decision references an entity in this module
	if (memberEntities.length > 0) {
		const relatedDecisions = decisions.filter((d) =>
			d.entityMentions.some((m) =>
				memberEntities.some((e) => m.includes(e.name) || m.includes(e.file)),
			),
		);
		if (relatedDecisions.length > 0) {
			lines.push("## Related Decisions");
			lines.push("");
			for (const d of relatedDecisions) {
				lines.push(`- [[decision:${d.id}]] — ${d.title} [${d.status}]`);
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

function generateEntityArticle(
	entity: CodeEntity,
	features: ExtractedFeature[],
	decisions: ExtractedDecision[],
	graph: KnowledgeGraph,
): string {
	const lines: string[] = [];
	const entityId = `entity:${entity.name}`;

	lines.push(`# Entity: ${entity.name}`);
	lines.push("");
	lines.push(`> ${entity.kind} in \`${entity.file}:${entity.line}\``);
	lines.push("");

	// Signature
	lines.push("## Details");
	lines.push("");
	lines.push(`- **Kind:** ${entity.kind}`);
	lines.push(`- **File:** \`${entity.file}\``);
	lines.push(`- **Line:** ${entity.line}`);
	lines.push(`- **Exported:** ${entity.exported ? "yes" : "no"}`);
	const node = graph.nodes.get(entityId);
	if (node) {
		lines.push(`- **PageRank:** ${node.pageRank.toFixed(4)}`);
	}
	lines.push("");

	// Callers and callees (from graph edges)
	const callers: string[] = [];
	const callees: string[] = [];
	for (const edge of graph.edges) {
		if (edge.target === entityId && edge.type === "calls") {
			callers.push(edge.source);
		}
		if (edge.source === entityId && edge.type === "calls") {
			callees.push(edge.target);
		}
	}

	if (callers.length > 0) {
		lines.push("## Callers");
		lines.push("");
		for (const c of callers) {
			lines.push(`- [[${c}]]`);
		}
		lines.push("");
	}

	if (callees.length > 0) {
		lines.push("## Callees");
		lines.push("");
		for (const c of callees) {
			lines.push(`- [[${c}]]`);
		}
		lines.push("");
	}

	// Related features
	const relatedFeatures = features.filter((f) =>
		f.entitiesModified.includes(entity.name),
	);
	if (relatedFeatures.length > 0) {
		lines.push("## Related Features");
		lines.push("");
		for (const f of relatedFeatures) {
			lines.push(`- [[feature:${f.id}]] — ${f.title}`);
		}
		lines.push("");
	}

	// Related decisions
	const relatedDecisions = decisions.filter((d) =>
		d.entityMentions.some((m) => m.includes(entity.name)),
	);
	if (relatedDecisions.length > 0) {
		lines.push("## Related Decisions");
		lines.push("");
		for (const d of relatedDecisions) {
			lines.push(`- [[decision:${d.id}]] — ${d.title}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function generateFeatureArticle(feature: ExtractedFeature): string {
	const lines: string[] = [];

	lines.push(`# Feature: ${feature.title || feature.id}`);
	lines.push("");

	if (feature.scope) {
		// Only emit the Scope section if the content has real information
		// (not just unresolved [NEEDS CLARIFICATION] placeholders)
		const cleanScope = feature.scope
			.replace(/\[NEEDS CLARIFICATION\][^.]*\./gi, "")
			.trim();
		if (cleanScope.length > 0) {
			lines.push("## Scope");
			lines.push("");
			lines.push(cleanScope);
			lines.push("");
		} else {
			lines.push("## Scope");
			lines.push("");
			lines.push("- TODO(scope): Define what this feature does.");
			lines.push(
				"- TODO(scope): Define what this feature explicitly does not do to prevent over-building.",
			);
			lines.push("");
		}
	}

	// Spec assertions
	if (feature.specAssertions.length > 0) {
		lines.push("## Spec Assertions");
		lines.push("");
		for (const assertion of feature.specAssertions) {
			lines.push(`- [ ] ${assertion}`);
		}
		lines.push("");
	}

	// Tasks
	if (feature.tasks.length > 0) {
		lines.push("## Tasks");
		lines.push("");
		const completed = feature.tasks.filter((t) => t.completed).length;
		lines.push(
			`Progress: ${completed}/${feature.tasks.length} (${Math.round((completed / feature.tasks.length) * 100)}%)`,
		);
		lines.push("");
		for (const task of feature.tasks) {
			const check = task.completed ? "x" : " ";
			lines.push(`- [${check}] ${task.id}: ${task.description}`);
		}
		lines.push("");
	}

	// Modified entities
	if (feature.entitiesModified.length > 0) {
		lines.push("## Entities Modified");
		lines.push("");
		for (const entity of feature.entitiesModified) {
			lines.push(`- [[entity:${entity}]]`);
		}
		lines.push("");
	}

	// Decisions
	if (feature.decisionsCreated.length > 0) {
		lines.push("## Decisions Created");
		lines.push("");
		for (const d of feature.decisionsCreated) {
			lines.push(`- [[decision:${d}]]`);
		}
		lines.push("");
	}

	// Status
	lines.push("## Status");
	lines.push("");
	lines.push(`- **Branch:** ${feature.branch || "_none_"}`);
	lines.push(
		`- **PR:** ${feature.prNumber !== null ? `#${feature.prNumber}` : "_none_"}`,
	);
	lines.push(`- **Merged:** ${feature.merged ? "yes" : "no"}`);
	lines.push("");

	return lines.join("\n");
}

function generateDecisionArticle(decision: ExtractedDecision): string {
	const lines: string[] = [];

	lines.push(`# Decision: ${decision.title || decision.id}`);
	lines.push("");
	lines.push(`> Status: **${decision.status}**`);
	lines.push("");

	if (decision.context) {
		lines.push("## Context");
		lines.push("");
		lines.push(decision.context);
		lines.push("");
	}

	if (decision.decision) {
		lines.push("## Decision");
		lines.push("");
		lines.push(decision.decision);
		lines.push("");
	}

	if (decision.rationale) {
		lines.push("## Rationale");
		lines.push("");
		lines.push(decision.rationale);
		lines.push("");
	}

	if (decision.alternativesRejected.length > 0) {
		lines.push("## Alternatives Rejected");
		lines.push("");
		for (const alt of decision.alternativesRejected) {
			lines.push(`- ${alt}`);
		}
		lines.push("");
	}

	if (decision.entityMentions.length > 0) {
		lines.push("## Affected Entities");
		lines.push("");
		for (const entity of decision.entityMentions) {
			lines.push(`- \`${entity}\``);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Architecture Article Generation ───────────────────────────────────

interface ArchitectureArticle {
	slug: string;
	title: string;
	content: string;
}

/**
 * Detect the Three Engines pattern (context/, prompts/, verify/) under
 * packages/core/src and generate a descriptive article.
 */
function generateThreeEnginesArticle(
	repoRoot: string,
): ArchitectureArticle | null {
	const coreEnginesDir = join(repoRoot, "packages", "core", "src");
	const engines = ["context", "prompts", "verify"];
	const detected: string[] = [];

	for (const engine of engines) {
		try {
			const stat = statSync(join(coreEnginesDir, engine));
			if (stat.isDirectory()) {
				detected.push(engine);
			}
		} catch {
			// directory doesn't exist
		}
	}

	if (detected.length < 2) return null;

	const engineFiles: Record<string, string[]> = {};
	for (const engine of detected) {
		try {
			engineFiles[engine] = readdirSync(join(coreEnginesDir, engine))
				.filter(
					(f) =>
						f.endsWith(".ts") &&
						!f.endsWith(".test.ts") &&
						!f.endsWith(".d.ts"),
				)
				.sort();
		} catch {
			engineFiles[engine] = [];
		}
	}

	const lines: string[] = [];
	lines.push("# Architecture: Three Engines");
	lines.push("");
	lines.push(
		"> Auto-generated architecture article describing the three-engine pattern.",
	);
	lines.push("");
	lines.push(
		"Maina's core is organized around three engines that work together:",
	);
	lines.push("");
	lines.push(
		"1. **Context Engine** (`context/`) — Observes the codebase via 4-layer retrieval (Working, Episodic, Semantic, Retrieval), PageRank scoring, and dynamic token budgets.",
	);
	lines.push(
		"2. **Prompt Engine** (`prompts/`) — Learns from project conventions via constitution loading, custom prompts, versioning, and A/B-tested evolution.",
	);
	lines.push(
		"3. **Verify Engine** (`verify/`) — Verifies AI-generated code via a multi-stage pipeline: syntax guard, parallel tools, diff filter, AI fix, and two-stage review.",
	);
	lines.push("");

	for (const engine of detected) {
		const files = engineFiles[engine] ?? [];
		lines.push(`## ${engine.charAt(0).toUpperCase() + engine.slice(1)} Engine`);
		lines.push("");
		if (files.length > 0) {
			lines.push(`Source files (\`packages/core/src/${engine}/\`):`);
			lines.push("");
			for (const file of files) {
				lines.push(`- \`${file}\``);
			}
		} else {
			lines.push("_No source files detected._");
		}
		lines.push("");
	}

	return {
		slug: "three-engines",
		title: "Three Engines",
		content: lines.join("\n"),
	};
}

/**
 * Read description from a package directory's package.json.
 * Falls back to README first line, then directory name.
 */
function readPackageDescription(pkgDir: string, dirName: string): string {
	// 1. Try package.json description
	const pkgJsonPath = join(pkgDir, "package.json");
	if (existsSync(pkgJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
			if (typeof pkg.description === "string" && pkg.description.length > 0) {
				return pkg.description;
			}
		} catch {
			// parse error — try next source
		}
	}

	// 2. Try first non-empty line of README.md (skip heading marker)
	const readmePath = join(pkgDir, "README.md");
	if (existsSync(readmePath)) {
		try {
			const readme = readFileSync(readmePath, "utf-8");
			const firstLine = readme
				.split("\n")
				.map((l) => l.replace(/^#+\s*/, "").trim())
				.find((l) => l.length > 0);
			if (firstLine) return firstLine;
		} catch {
			// read error — try next source
		}
	}

	return `_No description available for ${dirName}._`;
}

/**
 * Discover workspace directories by reading package.json workspaces field.
 * Falls back to just "packages" if no workspaces defined.
 */
function discoverWorkspaceDirs(
	repoRoot: string,
): { dir: string; label: string }[] {
	const pkgJsonPath = join(repoRoot, "package.json");
	let patterns: string[] = [];

	if (existsSync(pkgJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
			if (Array.isArray(pkg.workspaces)) {
				patterns = pkg.workspaces as string[];
			} else if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
				patterns = pkg.workspaces.packages as string[];
			}
		} catch {
			// parse error
		}
	}

	if (patterns.length === 0) {
		// Default: check if "packages" directory exists
		if (existsSync(join(repoRoot, "packages"))) {
			patterns = ["packages/*"];
		}
	}

	const dirs: { dir: string; label: string }[] = [];
	for (const pattern of patterns) {
		const base = pattern.replace(/\/?\*$/, "");
		const fullPath = join(repoRoot, base);
		if (existsSync(fullPath)) {
			dirs.push({ dir: fullPath, label: base });
		}
	}
	return dirs;
}

/**
 * Describe the monorepo structure by inspecting workspace layout (#81).
 * Reads descriptions from package.json, README, or infers from exports.
 */
function generateMonorepoArticle(repoRoot: string): ArchitectureArticle | null {
	const workspaceDirs = discoverWorkspaceDirs(repoRoot);
	if (workspaceDirs.length === 0) return null;

	// Collect all packages across workspace directories
	const allPackages: {
		name: string;
		label: string;
		dir: string;
		desc: string;
	}[] = [];

	for (const { dir, label } of workspaceDirs) {
		try {
			const entries = readdirSync(dir).filter((name) => {
				try {
					return statSync(join(dir, name)).isDirectory();
				} catch {
					return false;
				}
			});
			for (const name of entries) {
				const pkgDir = join(dir, name);
				const desc = readPackageDescription(pkgDir, name);

				// Try to get the npm package name
				let displayName = name;
				const pkgJsonPath = join(pkgDir, "package.json");
				if (existsSync(pkgJsonPath)) {
					try {
						const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
						if (typeof pkg.name === "string") {
							displayName = pkg.name;
						}
					} catch {
						// use dir name
					}
				}

				allPackages.push({
					name: displayName,
					label,
					dir: `${label}/${name}`,
					desc,
				});
			}
		} catch {
			// directory not readable
		}
	}

	if (allPackages.length === 0) return null;

	// Read root project description
	let projectDesc = "";
	const rootPkgPath = join(repoRoot, "package.json");
	if (existsSync(rootPkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));
			if (typeof pkg.description === "string") {
				projectDesc = pkg.description;
			}
		} catch {
			// ignore
		}
	}

	const lines: string[] = [];
	lines.push("# Architecture: Monorepo Structure");
	lines.push("");
	lines.push(
		"> Auto-generated architecture article describing the monorepo layout.",
	);
	lines.push("");
	if (projectDesc) {
		lines.push(`**${projectDesc}**`);
		lines.push("");
	}
	const dirLabels = workspaceDirs.map((d) => `\`${d.label}/\``).join(", ");
	lines.push(
		`This monorepo contains ${allPackages.length} packages across ${dirLabels}.`,
	);
	lines.push("");

	// Group by workspace directory
	const grouped = new Map<string, typeof allPackages>();
	for (const pkg of allPackages) {
		const existing = grouped.get(pkg.label) ?? [];
		existing.push(pkg);
		grouped.set(pkg.label, existing);
	}

	for (const [label, packages] of grouped) {
		lines.push(`## ${label}/`);
		lines.push("");

		for (const pkg of packages.sort((a, b) => a.name.localeCompare(b.name))) {
			lines.push(`### ${pkg.name}`);
			lines.push("");
			lines.push(`- **Path:** \`${pkg.dir}/\``);
			lines.push(`- **Description:** ${pkg.desc}`);

			// List top-level src directories if present
			const srcDir = join(repoRoot, pkg.dir, "src");
			try {
				const srcEntries = readdirSync(srcDir).filter((e) => {
					try {
						return statSync(join(srcDir, e)).isDirectory();
					} catch {
						return false;
					}
				});
				if (srcEntries.length > 0) {
					lines.push(`- **Modules:** ${srcEntries.sort().join(", ")}`);
				}
			} catch {
				// no src directory
			}
			lines.push("");
		}
	}

	return {
		slug: "monorepo-structure",
		title: "Monorepo Structure",
		content: lines.join("\n"),
	};
}

/**
 * List all verify tools detected from the verify/ directory.
 */
function generateVerifyPipelineArticle(
	repoRoot: string,
): ArchitectureArticle | null {
	const verifyDir = join(repoRoot, "packages", "core", "src", "verify");
	let verifyFiles: string[];
	try {
		verifyFiles = readdirSync(verifyDir).filter(
			(f) =>
				f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
		);
	} catch {
		return null;
	}

	if (verifyFiles.length === 0) return null;

	// Also check for linters subdirectory
	let linterFiles: string[] = [];
	try {
		linterFiles = readdirSync(join(verifyDir, "linters")).filter(
			(f) =>
				f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
		);
	} catch {
		// no linters directory
	}

	// Also check for tools subdirectory
	let toolFiles: string[] = [];
	try {
		toolFiles = readdirSync(join(verifyDir, "tools")).filter(
			(f) =>
				f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
		);
	} catch {
		// no tools directory
	}

	const toolDescriptions: Record<string, string> = {
		"syntax-guard.ts":
			"Fast syntax checking (<500ms) via language-specific linters",
		"slop.ts": "AI slop detection — catches lazy/generic AI output patterns",
		"semgrep.ts": "Static analysis via Semgrep rules",
		"trivy.ts": "Container and dependency vulnerability scanning",
		"secretlint.ts": "Secret detection in code and config files",
		"sonar.ts": "SonarQube code quality analysis",
		"coverage.ts": "Code coverage tracking via diff-cover",
		"mutation.ts": "Mutation testing via Stryker",
		"ai-review.ts": "Two-stage AI review (spec compliance + code quality)",
		"diff-filter.ts":
			"Diff-only filter — only report findings on changed lines",
		"fix.ts": "AI-powered automatic fix suggestions",
		"pipeline.ts": "Verification pipeline orchestrator",
		"builtin.ts": "Built-in verification checks",
		"consistency.ts": "Code consistency analysis",
		"typecheck.ts": "TypeScript type checking",
		"detect.ts": "Language and tool detection",
		"proof.ts": "Verification proof generation for PR bodies",
		"visual.ts": "Visual verification with Playwright",
		"lighthouse.ts": "Lighthouse performance audits",
		"zap.ts": "OWASP ZAP security scanning",
	};

	const lines: string[] = [];
	lines.push("# Architecture: Verification Pipeline");
	lines.push("");
	lines.push("> Auto-generated architecture article listing all verify tools.");
	lines.push("");
	lines.push(
		"The verification pipeline runs a multi-stage process to prove AI-generated code is correct before it merges.",
	);
	lines.push("");
	lines.push("## Pipeline Stages");
	lines.push("");
	lines.push("1. **Syntax Guard** — Fast linting (<500ms)");
	lines.push(
		"2. **Parallel Deterministic Tools** — Semgrep, Trivy, Secretlint, SonarQube, coverage, mutation",
	);
	lines.push("3. **Diff-Only Filter** — Only report findings on changed lines");
	lines.push("4. **AI Fix** — Automatic fix suggestions");
	lines.push("5. **Two-Stage AI Review** — Spec compliance, then code quality");
	lines.push("");
	lines.push("## Verify Tools");
	lines.push("");

	for (const file of verifyFiles.sort()) {
		const name = file.replace(/\.ts$/, "");
		const desc = toolDescriptions[file] ?? "";
		if (desc) {
			lines.push(`- **${name}** — ${desc}`);
		} else {
			lines.push(`- **${name}** — \`verify/${file}\``);
		}
	}
	lines.push("");

	if (linterFiles.length > 0) {
		lines.push("## Language-Specific Linters");
		lines.push("");
		for (const file of linterFiles.sort()) {
			const name = file.replace(/\.ts$/, "");
			lines.push(`- **${name}** — \`verify/linters/${file}\``);
		}
		lines.push("");
	}

	if (toolFiles.length > 0) {
		lines.push("## Additional Tools");
		lines.push("");
		for (const file of toolFiles.sort()) {
			const name = file.replace(/\.ts$/, "");
			lines.push(`- **${name}** — \`verify/tools/${file}\``);
		}
		lines.push("");
	}

	return {
		slug: "verification-pipeline",
		title: "Verification Pipeline",
		content: lines.join("\n"),
	};
}

/**
 * Generate architecture articles by detecting cross-cutting patterns
 * from the codebase structure.
 */
function generateArchitectureArticles(repoRoot: string): WikiArticle[] {
	const articles: WikiArticle[] = [];
	const generators = [
		generateThreeEnginesArticle,
		generateMonorepoArticle,
		generateVerifyPipelineArticle,
	];

	for (const generator of generators) {
		const result = generator(repoRoot);
		if (result) {
			const articlePath = `wiki/architecture/${result.slug}.md`;
			articles.push(
				makeArticle(
					articlePath,
					"architecture",
					result.title,
					result.content,
					0.5,
					[],
					[],
				),
			);
		}
	}

	return articles;
}

// ─── Article Factory ────────────────────────────────────────────────────

function makeArticle(
	path: string,
	type: ArticleType,
	title: string,
	content: string,
	pageRank: number,
	forwardLinks: WikiLink[],
	backlinksForArticle: WikiLink[],
): WikiArticle {
	return {
		path,
		type,
		title,
		content,
		contentHash: hashContent(content),
		sourceHashes: [],
		backlinks: backlinksForArticle,
		forwardLinks,
		pageRank,
		lastCompiled: new Date().toISOString(),
		referenceCount: forwardLinks.length + backlinksForArticle.length,
		ebbinghausScore: 1.0,
	};
}

// ─── Community Naming (#80) ─────────────────────────────────────────────

/**
 * Derive a meaningful name for a Louvain community instead of "cluster-N".
 *
 * Strategy:
 * 1. If there's a module node in the community, use its label
 * 2. Otherwise, find the most common directory among member entities' files
 * 3. Last resort: use the highest PageRank entity's name
 */
function deriveCommunityName(
	commId: number,
	moduleNodes: string[],
	members: string[],
	graph: KnowledgeGraph,
	codeEntities: CodeEntity[],
): string {
	// 1. Try module node label
	if (moduleNodes.length > 0) {
		const label = graph.nodes.get(moduleNodes[0] ?? "")?.label;
		if (label) return label;
	}

	// 2. Find the most common directory from member entity files
	const memberEntities = codeEntities.filter((e) =>
		members.some((m) => m === `entity:${e.name}`),
	);

	if (memberEntities.length > 0) {
		const dirCounts = new Map<string, number>();
		for (const entity of memberEntities) {
			const parts = entity.file.replace(/\\/g, "/").split("/");
			// Use the deepest non-generic directory
			const genericDirs = new Set([
				"src",
				"lib",
				"dist",
				"build",
				"test",
				"tests",
				"__tests__",
			]);
			for (let i = parts.length - 2; i >= 0; i--) {
				const dir = parts[i];
				if (dir && !genericDirs.has(dir)) {
					dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
					break;
				}
			}
		}

		if (dirCounts.size > 0) {
			// Pick the most frequent directory
			let bestDir = "";
			let bestCount = 0;
			for (const [dir, count] of dirCounts) {
				if (count > bestCount) {
					bestDir = dir;
					bestCount = count;
				}
			}
			if (bestDir) return bestDir;
		}

		// 3. Use the first entity's name as last resort
		return memberEntities[0]?.name ?? `cluster-${commId}`;
	}

	return `cluster-${commId}`;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Run the full wiki compilation pipeline.
 * Returns a Result containing all compiled articles, the knowledge graph, and stats.
 */
export async function compile(
	options: CompileOptions,
): Promise<Result<CompilationResult>> {
	const start = Date.now();
	const { repoRoot, mainaDir, wikiDir, dryRun } = options;

	try {
		// ── Step 1: Run extractors ──────────────────────────────────────
		let sourceFiles = findSourceFiles(repoRoot, repoRoot);
		if (options.sample === true && sourceFiles.length > SAMPLE_FILE_LIMIT) {
			// Sort by mtime desc — most recently modified first — then cap.
			const withMtime = sourceFiles.map((rel) => {
				let mtime = 0;
				try {
					mtime = statSync(join(repoRoot, rel)).mtimeMs;
				} catch {
					// missing file → treat as oldest
				}
				return { rel, mtime };
			});
			withMtime.sort((a, b) => b.mtime - a.mtime);
			sourceFiles = withMtime.slice(0, SAMPLE_FILE_LIMIT).map((e) => e.rel);
		}

		const entityResult = extractCodeEntities(repoRoot, sourceFiles);
		const codeEntities: CodeEntity[] = entityResult.ok
			? entityResult.value
			: [];

		const featuresDir = join(mainaDir, "features");
		const featuresResult = extractFeatures(featuresDir);
		const features: ExtractedFeature[] = featuresResult.ok
			? featuresResult.value
			: [];

		const adrDir = join(repoRoot, "adr");
		const decisionsResult = extractDecisions(adrDir);
		const decisions: ExtractedDecision[] = decisionsResult.ok
			? decisionsResult.value
			: [];

		const workflowResult = extractWorkflowTrace(mainaDir);
		const traces: ExtractedWorkflowTrace[] = workflowResult.ok
			? [workflowResult.value]
			: [];

		// ── Step 2: Build knowledge graph ──────────────────────────────
		const graph = buildKnowledgeGraph(
			codeEntities,
			features,
			decisions,
			traces,
		);

		// ── Step 3: Community detection (leiden-connected by default) ────────
		const communityResult = detectCommunities(graph.adjacency, {
			algorithm: options.communityAlgorithm ?? "leiden-connected",
		});

		// ── Step 4: Compute PageRank ───────────────────────────────────
		const pageRankScores = computePageRank(graph);

		// ── Step 5: Map nodes to article paths ─────────────────────────
		const articleMap = mapToArticles(graph, communityResult.communities);

		// ── Step 6: Generate template-based articles ───────────────────
		const articles: WikiArticle[] = [];

		// Module articles — one per community. leiden-connected can split a
		// Louvain community in two, so two distinct communities can derive
		// the same `moduleName`. Track used paths and suffix with the
		// community id on collision so neither article gets overwritten.
		const usedModulePaths = new Set<string>();
		for (const [commId, members] of communityResult.communities) {
			const moduleNodes = members.filter(
				(m) => graph.nodes.get(m)?.type === "module",
			);
			const moduleName = deriveCommunityName(
				commId,
				moduleNodes,
				members,
				graph,
				codeEntities,
			);

			const memberEntities = codeEntities.filter((e) =>
				members.some((m) => m === `entity:${e.name}`),
			);

			const content = generateModuleArticle(
				moduleName,
				memberEntities,
				features,
				decisions,
				pageRankScores,
			);

			const safeBase = moduleName.replace(/[^a-zA-Z0-9_-]/g, "-");
			const safeName = usedModulePaths.has(`wiki/modules/${safeBase}.md`)
				? `${safeBase}-${commId}`
				: safeBase;
			const articlePath = `wiki/modules/${safeName}.md`;
			usedModulePaths.add(articlePath);
			const maxPR = Math.max(
				0,
				...memberEntities.map(
					(e) => pageRankScores.get(`entity:${e.name}`) ?? 0,
				),
			);

			articles.push(
				makeArticle(articlePath, "module", moduleName, content, maxPR, [], []),
			);
		}

		// Entity articles (top 20% by PageRank)
		const entityNodes = [...graph.nodes.entries()]
			.filter(([, node]) => node.type === "entity")
			.sort(([, a], [, b]) => b.pageRank - a.pageRank);

		const top20Count = Math.max(1, Math.ceil(entityNodes.length * 0.2));
		const topEntities = entityNodes.slice(0, top20Count);

		for (const [, node] of topEntities) {
			const entity = codeEntities.find((e) => e.name === node.label);
			if (!entity) continue;

			const content = generateEntityArticle(entity, features, decisions, graph);
			const safeName = entity.name.replace(/[^a-zA-Z0-9_-]/g, "-");
			const articlePath = `wiki/entities/${safeName}.md`;

			articles.push(
				makeArticle(
					articlePath,
					"entity",
					entity.name,
					content,
					node.pageRank,
					[],
					[],
				),
			);
		}

		// Feature articles — use feature.id as filename to match [[feature:id]] wikilinks
		for (const feature of features) {
			const content = generateFeatureArticle(feature);
			const articlePath = `wiki/features/${feature.id}.md`;
			const featureNode = graph.nodes.get(`feature:${feature.id}`);

			articles.push(
				makeArticle(
					articlePath,
					"feature",
					feature.title || feature.id,
					content,
					featureNode?.pageRank ?? 0,
					[],
					[],
				),
			);
		}

		// Decision articles — use decision.id as filename to match [[decision:id]] wikilinks
		for (const decision of decisions) {
			const content = generateDecisionArticle(decision);
			const articlePath = `wiki/decisions/${decision.id}.md`;
			const decisionNode = graph.nodes.get(`decision:${decision.id}`);

			articles.push(
				makeArticle(
					articlePath,
					"decision",
					decision.title || decision.id,
					content,
					decisionNode?.pageRank ?? 0,
					[],
					[],
				),
			);
		}

		// Architecture articles (from directory structure analysis)
		const archArticles = generateArchitectureArticles(repoRoot);
		articles.push(...archArticles);

		// ── Step 6b: AI enhancement (optional) ────────────────────────
		if (options.useAI) {
			const contextSummary = [
				`Repository: ${repoRoot}`,
				`Entities: ${codeEntities.length}`,
				`Features: ${features.length}`,
				`Decisions: ${decisions.length}`,
			].join("\n");

			for (const article of articles) {
				// Only enhance module and entity articles — features/decisions are already rich
				if (article.type === "module" || article.type === "entity") {
					const enhanced = await enhanceWithAI(
						article,
						contextSummary,
						mainaDir,
					);
					if (enhanced !== article.content) {
						article.content = enhanced;
						article.contentHash = hashContent(enhanced);
					}
				}
			}
		}

		// ── Step 7: Generate wikilinks ─────────────────────────────────
		const linkResult = generateLinks(graph, articleMap);

		// Apply links to articles
		for (const article of articles) {
			article.forwardLinks = linkResult.forwardLinks.get(article.path) ?? [];
			article.backlinks = linkResult.backlinks.get(article.path) ?? [];
			article.referenceCount =
				article.forwardLinks.length + article.backlinks.length;
		}

		// ── Step 8: Generate index.md ──────────────────────────────────
		const indexContent = generateIndex(articles);
		articles.push(
			makeArticle(
				"wiki/index.md",
				"architecture",
				"Wiki Index",
				indexContent,
				1.0,
				[],
				[],
			),
		);

		// ── Step 9: Write to disk (unless dry run) ─────────────────────
		if (!dryRun) {
			mkdirSync(wikiDir, { recursive: true });

			for (const article of articles) {
				const fullPath = join(wikiDir, article.path.replace(/^wiki\//, ""));
				mkdirSync(dirname(fullPath), { recursive: true });
				writeFileSync(fullPath, article.content);
			}
		}

		// ── Step 9b: Build and save search index ───────────────────────
		if (!dryRun) {
			try {
				const { buildSearchIndex, saveSearchIndex } = await import("./search");
				const searchIndex = await buildSearchIndex(wikiDir);
				await saveSearchIndex(wikiDir, searchIndex);
			} catch {
				// Search index is optional — continue if Orama is unavailable
			}
		}

		// ── Step 9c: Emit GRAPH_REPORT.md audit (#201) ─────────────────
		if (!dryRun) {
			const reportOpts = {
				durationMs: Date.now() - start,
				communities: communityResult.communities.size,
			};
			const reportMd = generateGraphReport(articles, graph, reportOpts);
			writeFileSync(join(wikiDir, "GRAPH_REPORT.md"), reportMd);
			if (!options.noReportJson) {
				const reportJson = generateGraphReportJson(articles, graph, reportOpts);
				writeFileSync(join(wikiDir, ".graph-report.json"), reportJson);
			}
		}

		// ── Step 9d: Emit self-contained graph.html visualizer (#200) ──
		if (!dryRun && !options.noViz) {
			const html = renderGraphHtml(graph, articles);
			writeFileSync(join(wikiDir, "graph.html"), html);
		}

		// ── Step 10: Save state ────────────────────────────────────────
		const state = loadState(wikiDir) ?? createEmptyState();
		state.lastFullCompile = new Date().toISOString();
		state.lastIncrementalCompile = new Date().toISOString();

		for (const article of articles) {
			state.articleHashes[article.path] = article.contentHash;
		}

		// Persist source-file hashes so `wiki status` can compute coverage
		// (articleCount / sourceFileCount) and so incremental compile can
		// detect source changes in future runs. Previously this field was
		// declared but never written, leaving coverage stuck at 0% (#211).
		//
		// Skip on sampled compiles (options.sample truncates sourceFiles to
		// SAMPLE_FILE_LIMIT — persisting that truncated set as canonical state
		// would make coverage look fake-high on subsequent runs). Preserve any
		// existing fileHashes from a prior full compile in that case.
		if (options.sample !== true) {
			state.fileHashes = {};
			for (const rel of sourceFiles) {
				const h = hashFile(join(repoRoot, rel));
				if (h) state.fileHashes[rel] = h;
			}
		}

		if (!dryRun) {
			saveState(wikiDir, state);
		}

		// ── Build stats ────────────────────────────────────────────────
		const stats = {
			modules: articles.filter((a) => a.type === "module").length,
			entities: articles.filter((a) => a.type === "entity").length,
			features: articles.filter((a) => a.type === "feature").length,
			decisions: articles.filter((a) => a.type === "decision").length,
			architecture: articles.filter((a) => a.type === "architecture").length,
		};

		const duration = Date.now() - start;

		return {
			ok: true,
			value: {
				articles,
				graph,
				state,
				duration,
				stats,
			},
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
