/**
 * Wiki Compiler — full compilation orchestrator.
 *
 * Pipeline:
 * 1. Run all extractors (code entities, features, decisions, workflow traces)
 * 2. Build the unified knowledge graph
 * 3. Run Louvain community detection for module boundaries
 * 4. Compute PageRank
 * 5. Generate articles using template-based compilation (no AI)
 * 6. Generate wikilinks via linker
 * 7. Generate index.md via indexer
 * 8. Save state
 * 9. Write all articles to disk
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { TryAIResult } from "../ai/try-generate";
import type { Result } from "../db/index";
import type { CodeEntity } from "./extractors/code";
import { extractCodeEntities } from "./extractors/code";
import { extractDecisions } from "./extractors/decision";
import { extractFeatures } from "./extractors/feature";
import { extractWorkflowTrace } from "./extractors/workflow";
import type { KnowledgeGraph } from "./graph";
import { buildKnowledgeGraph, computePageRank, mapToArticles } from "./graph";
import { generateIndex } from "./indexer";
import { generateLinks } from "./linker";
import { detectCommunities } from "./louvain";
import { createEmptyState, hashContent, loadState, saveState } from "./state";
import type {
	ArticleType,
	ExtractedDecision,
	ExtractedFeature,
	ExtractedWorkflowTrace,
	WikiArticle,
	WikiLink,
} from "./types";

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
}

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
		const sorted = [...memberEntities].sort((a, b) => {
			const prA = pageRankScores.get(`entity:${a.name}`) ?? 0;
			const prB = pageRankScores.get(`entity:${b.name}`) ?? 0;
			return prB - prA;
		});
		for (const entity of sorted) {
			const pr = pageRankScores.get(`entity:${entity.name}`) ?? 0;
			lines.push(
				`- **${entity.name}** (${entity.kind}) — \`${entity.file}:${entity.line}\` [PR: ${pr.toFixed(4)}]`,
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

	// Related decisions
	if (decisions.length > 0) {
		lines.push("## Related Decisions");
		lines.push("");
		for (const d of decisions) {
			lines.push(`- [[decision:${d.id}]] — ${d.title} [${d.status}]`);
		}
		lines.push("");
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
		lines.push("## Scope");
		lines.push("");
		lines.push(feature.scope);
		lines.push("");
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
 * Describe the monorepo structure by inspecting packages/ layout.
 */
function generateMonorepoArticle(repoRoot: string): ArchitectureArticle | null {
	const packagesDir = join(repoRoot, "packages");
	let packageNames: string[];
	try {
		packageNames = readdirSync(packagesDir).filter((name) => {
			try {
				return statSync(join(packagesDir, name)).isDirectory();
			} catch {
				return false;
			}
		});
	} catch {
		return null;
	}

	if (packageNames.length === 0) return null;

	const descriptions: Record<string, string> = {
		cli: "Commander entrypoint, commands (thin wrappers over engines), terminal UI",
		core: "Three engines + cache + AI + git + DB + hooks",
		mcp: "MCP server (delegates to engines)",
		skills: "Cross-platform skills (Claude Code, Cursor, Codex, Gemini CLI)",
		docs: "Documentation site",
	};

	const lines: string[] = [];
	lines.push("# Architecture: Monorepo Structure");
	lines.push("");
	lines.push(
		"> Auto-generated architecture article describing the monorepo layout.",
	);
	lines.push("");
	lines.push("Maina is organized as a monorepo under `packages/`.");
	lines.push("");
	lines.push("## Packages");
	lines.push("");

	for (const name of packageNames.sort()) {
		const desc = descriptions[name] ?? "_No description available._";
		lines.push(`### ${name}`);
		lines.push("");
		lines.push(`- **Path:** \`packages/${name}/\``);
		lines.push(`- **Description:** ${desc}`);

		// List top-level src files if present
		const srcDir = join(packagesDir, name, "src");
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
		const sourceFiles = findSourceFiles(repoRoot, repoRoot);

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

		// ── Step 3: Louvain community detection ────────────────────────
		const louvainResult = detectCommunities(graph.adjacency);

		// ── Step 4: Compute PageRank ───────────────────────────────────
		const pageRankScores = computePageRank(graph);

		// ── Step 5: Map nodes to article paths ─────────────────────────
		const articleMap = mapToArticles(graph, louvainResult.communities);

		// ── Step 6: Generate template-based articles ───────────────────
		const articles: WikiArticle[] = [];

		// Module articles (from Louvain communities)
		for (const [commId, members] of louvainResult.communities) {
			const moduleNodes = members.filter(
				(m) => graph.nodes.get(m)?.type === "module",
			);
			const moduleName =
				moduleNodes.length > 0
					? (graph.nodes.get(moduleNodes[0] ?? "")?.label ??
						`cluster-${commId}`)
					: `cluster-${commId}`;

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

			const safeName = moduleName.replace(/[^a-zA-Z0-9_-]/g, "-");
			const articlePath = `wiki/modules/${safeName}.md`;
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

		// ── Step 10: Save state ────────────────────────────────────────
		const state = loadState(wikiDir) ?? createEmptyState();
		state.lastFullCompile = new Date().toISOString();
		state.lastIncrementalCompile = new Date().toISOString();

		for (const article of articles) {
			state.articleHashes[article.path] = article.contentHash;
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
