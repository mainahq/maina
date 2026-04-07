/**
 * `maina wiki init` — scaffold wiki directory and run first compilation.
 *
 * Creates .maina/wiki/ structure with subdirectories for each article type,
 * extracts entities from the codebase, generates template-based markdown
 * articles, and writes them. Self-contained: works even if the Sprint 1+2
 * compiler module does not exist yet.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import type { WikiState } from "@mainahq/core";
import {
	type CodeEntity,
	createEmptyState,
	extractCodeEntities,
	extractDecisions,
	extractFeatures,
	hashContent,
	saveWikiState,
} from "@mainahq/core";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WikiInitResult {
	articlesCreated: number;
	modules: number;
	entities: number;
	features: number;
	decisions: number;
	coveragePercent: number;
	duration: number;
}

export interface WikiInitOptions {
	json?: boolean;
	cwd?: string;
}

// ── Self-Contained Compilation ──────────────────────────────────────────────

/**
 * Collect all TypeScript files from the packages/ directory (or src/ if flat).
 */
function collectSourceFiles(repoRoot: string): string[] {
	const files: string[] = [];

	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (
				entry === "node_modules" ||
				entry === "dist" ||
				entry === ".maina" ||
				entry === ".git"
			) {
				continue;
			}
			const fullPath = join(dir, entry);
			try {
				const st = statSync(fullPath);
				if (st.isDirectory()) {
					walk(fullPath);
				} else if (
					entry.endsWith(".ts") &&
					!entry.endsWith(".test.ts") &&
					!entry.endsWith(".d.ts")
				) {
					files.push(relative(repoRoot, fullPath));
				}
			} catch {
				// skip
			}
		}
	}

	// Try packages/ first (monorepo), fall back to src/
	const packagesDir = join(repoRoot, "packages");
	const srcDir = join(repoRoot, "src");

	if (existsSync(packagesDir)) {
		walk(packagesDir);
	} else if (existsSync(srcDir)) {
		walk(srcDir);
	}

	return files;
}

/**
 * Group code entities by the module (directory) they belong to.
 */
function groupByModule(entities: CodeEntity[]): Map<string, CodeEntity[]> {
	const modules = new Map<string, CodeEntity[]>();

	for (const entity of entities) {
		// Use first two path segments as module identifier
		const parts = entity.file.split("/");
		const moduleName =
			parts.length >= 3
				? `${parts[0]}/${parts[1]}/${parts[2]}`
				: (parts[0] ?? "root");

		const existing = modules.get(moduleName) ?? [];
		existing.push(entity);
		modules.set(moduleName, existing);
	}

	return modules;
}

/**
 * Generate a markdown article for a module.
 */
function generateModuleArticle(
	modulePath: string,
	entities: CodeEntity[],
): string {
	const name = basename(modulePath);
	const lines: string[] = [];

	lines.push(`# ${name}`);
	lines.push("");
	lines.push(`Module at \`${modulePath}\`.`);
	lines.push("");
	lines.push("## Exports");
	lines.push("");

	const byKind = new Map<string, CodeEntity[]>();
	for (const entity of entities) {
		const existing = byKind.get(entity.kind) ?? [];
		existing.push(entity);
		byKind.set(entity.kind, existing);
	}

	for (const [kind, kindEntities] of byKind) {
		lines.push(`### ${kind.charAt(0).toUpperCase() + kind.slice(1)}s`);
		lines.push("");
		for (const e of kindEntities) {
			lines.push(`- \`${e.name}\` (\`${e.file}:${e.line}\`)`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Generate a markdown article for a code entity.
 */
function generateEntityArticle(entity: CodeEntity): string {
	const lines: string[] = [];

	lines.push(`# ${entity.name}`);
	lines.push("");
	lines.push(`**Kind:** ${entity.kind}`);
	lines.push(`**File:** \`${entity.file}:${entity.line}\``);
	lines.push(`**Exported:** ${entity.exported ? "yes" : "no"}`);
	lines.push("");

	return lines.join("\n");
}

/**
 * Sanitize a name for use as a filename.
 */
function sanitizeFilename(name: string): string {
	return name
		.replace(/[^a-zA-Z0-9_-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

/**
 * Self-contained compilation: extract entities and lifecycle artifacts,
 * generate template-based markdown articles, write them to .maina/wiki/.
 */
export async function runInitialCompilation(
	repoRoot: string,
	wikiDir: string,
): Promise<WikiInitResult> {
	const startTime = Date.now();

	// Ensure all subdirectories exist
	const subdirs = [
		"modules",
		"entities",
		"features",
		"decisions",
		"architecture",
		"raw",
	];
	for (const subdir of subdirs) {
		mkdirSync(join(wikiDir, subdir), { recursive: true });
	}

	const state: WikiState = createEmptyState();
	let articlesCreated = 0;
	let moduleCount = 0;
	let entityCount = 0;
	let featureCount = 0;
	let decisionCount = 0;

	// ── 1. Extract code entities ──────────────────────────────────────
	const sourceFiles = collectSourceFiles(repoRoot);
	const codeResult = extractCodeEntities(repoRoot, sourceFiles);
	const codeEntities = codeResult.ok ? codeResult.value : [];

	// ── 2. Generate module articles ───────────────────────────────────
	const modules = groupByModule(codeEntities);
	const modulesDir = join(wikiDir, "modules");

	for (const [modulePath, entities] of modules) {
		const content = generateModuleArticle(modulePath, entities);
		const filename = `${sanitizeFilename(modulePath)}.md`;
		const articlePath = join(modulesDir, filename);
		writeFileSync(articlePath, content);
		state.articleHashes[`modules/${filename}`] = hashContent(content);
		articlesCreated++;
		moduleCount++;
	}

	// ── 3. Generate entity articles (top exports only) ────────────────
	const entitiesDir = join(wikiDir, "entities");
	// Only generate articles for unique entity names to avoid explosion
	const seen = new Set<string>();
	for (const entity of codeEntities) {
		if (seen.has(entity.name)) continue;
		seen.add(entity.name);

		const content = generateEntityArticle(entity);
		const filename = `${sanitizeFilename(entity.name)}.md`;
		const articlePath = join(entitiesDir, filename);
		writeFileSync(articlePath, content);
		state.articleHashes[`entities/${filename}`] = hashContent(content);
		articlesCreated++;
		entityCount++;
	}

	// ── 4. Extract and generate feature articles ──────────────────────
	const featuresBaseDir = join(repoRoot, ".maina", "features");
	if (existsSync(featuresBaseDir)) {
		const featResult = extractFeatures(featuresBaseDir);
		if (featResult.ok) {
			const featuresDir = join(wikiDir, "features");
			for (const feature of featResult.value) {
				const lines: string[] = [];
				lines.push(`# ${feature.title || feature.id}`);
				lines.push("");
				if (feature.scope) {
					lines.push(`**Scope:** ${feature.scope}`);
					lines.push("");
				}
				if (feature.specAssertions.length > 0) {
					lines.push("## Acceptance Criteria");
					lines.push("");
					for (const assertion of feature.specAssertions) {
						lines.push(`- ${assertion}`);
					}
					lines.push("");
				}
				if (feature.tasks.length > 0) {
					lines.push("## Tasks");
					lines.push("");
					for (const task of feature.tasks) {
						const check = task.completed ? "x" : " ";
						lines.push(`- [${check}] ${task.id}: ${task.description}`);
					}
					lines.push("");
				}

				const content = lines.join("\n");
				const filename = `${sanitizeFilename(feature.id)}.md`;
				const articlePath = join(featuresDir, filename);
				writeFileSync(articlePath, content);
				state.articleHashes[`features/${filename}`] = hashContent(content);
				articlesCreated++;
				featureCount++;
			}
		}
	}

	// ── 5. Extract and generate decision articles ─────────────────────
	const adrDir = join(repoRoot, ".maina", "adr");
	if (existsSync(adrDir)) {
		const decResult = extractDecisions(adrDir);
		if (decResult.ok) {
			const decisionsDir = join(wikiDir, "decisions");
			for (const dec of decResult.value) {
				const lines: string[] = [];
				lines.push(`# ${dec.title || dec.id}`);
				lines.push("");
				lines.push(`**Status:** ${dec.status}`);
				lines.push("");
				if (dec.context) {
					lines.push("## Context");
					lines.push("");
					lines.push(dec.context);
					lines.push("");
				}
				if (dec.decision) {
					lines.push("## Decision");
					lines.push("");
					lines.push(dec.decision);
					lines.push("");
				}
				if (dec.rationale) {
					lines.push("## Rationale");
					lines.push("");
					lines.push(dec.rationale);
					lines.push("");
				}
				if (dec.alternativesRejected.length > 0) {
					lines.push("## Alternatives Considered");
					lines.push("");
					for (const alt of dec.alternativesRejected) {
						lines.push(`- ${alt}`);
					}
					lines.push("");
				}

				const content = lines.join("\n");
				const filename = `${sanitizeFilename(dec.id)}.md`;
				const articlePath = join(decisionsDir, filename);
				writeFileSync(articlePath, content);
				state.articleHashes[`decisions/${filename}`] = hashContent(content);
				articlesCreated++;
				decisionCount++;
			}
		}
	}

	// ── 6. Update file hashes for source files ────────────────────────
	for (const file of sourceFiles) {
		const fullPath = join(repoRoot, file);
		try {
			const content = readFileSync(fullPath, "utf-8");
			state.fileHashes[file] = hashContent(content);
		} catch {
			// skip
		}
	}

	// ── 7. Save state ─────────────────────────────────────────────────
	const now = new Date().toISOString();
	state.lastFullCompile = now;
	state.lastIncrementalCompile = now;
	saveWikiState(wikiDir, state);

	const duration = Date.now() - startTime;

	// Coverage: percentage of source files that contributed to at least one article
	const filesWithEntities = new Set(codeEntities.map((e) => e.file));
	const coveragePercent =
		sourceFiles.length > 0
			? Math.round((filesWithEntities.size / sourceFiles.length) * 100)
			: 0;

	return {
		articlesCreated,
		modules: moduleCount,
		entities: entityCount,
		features: featureCount,
		decisions: decisionCount,
		coveragePercent,
		duration,
	};
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function wikiInitAction(
	options: WikiInitOptions = {},
): Promise<WikiInitResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");
	const wikiDir = join(mainaDir, "wiki");

	// ── Step 1: Detect repo root and .maina dir ──────────────────────
	if (!existsSync(mainaDir)) {
		mkdirSync(mainaDir, { recursive: true });
	}

	// ── Step 2: Create directory structure ────────────────────────────
	const subdirs = [
		"modules",
		"entities",
		"features",
		"decisions",
		"architecture",
		"raw",
	];
	for (const subdir of subdirs) {
		mkdirSync(join(wikiDir, subdir), { recursive: true });
	}

	if (!options.json) {
		log.info("Wiki directory created at .maina/wiki/");
	}

	// ── Step 3: Run initial compilation ──────────────────────────────
	const result = await runInitialCompilation(cwd, wikiDir);

	if (!options.json) {
		log.success(
			`Compiled ${result.articlesCreated} articles in ${result.duration}ms`,
		);
		log.info(
			`  Modules: ${result.modules}  Entities: ${result.entities}  Features: ${result.features}  Decisions: ${result.decisions}`,
		);
		log.info(`  Coverage: ${result.coveragePercent}%`);
	}

	return result;
}

// ── Commander Command ────────────────────────────────────────────────────────

export function wikiInitCommand(parent: Command): void {
	parent
		.command("init")
		.description("Initialize wiki and run first compilation")
		.option("--json", "Output JSON for CI")
		.action(async (options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina wiki init");
			}

			const s = spinner();
			if (!jsonMode) {
				s.start("Initializing wiki...");
			}

			const result = await wikiInitAction({ json: jsonMode });

			if (!jsonMode) {
				s.stop("Wiki initialized.");
				outro("Done.");
			} else {
				outputJson(result, EXIT_PASSED);
			}
		});
}
