/**
 * `maina wiki compile` — incremental (or full) wiki compilation.
 *
 * Delegates to the core wiki compiler which handles extraction, knowledge graph,
 * Louvain community detection, PageRank, template-based articles, wikilinks,
 * indexing, state management, and writing to disk.
 *
 * - Default: incremental compilation (full: false)
 * - --full: force full recompilation
 * - --dry-run: show what would change without writing
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import { compileWiki } from "@mainahq/core";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CompilationResult {
	articlesTotal: number;
	modules: number;
	entities: number;
	features: number;
	decisions: number;
	architecture: number;
	duration: number;
	mode: "full" | "incremental";
	dryRun: boolean;
}

export interface WikiCompileOptions {
	full?: boolean;
	dryRun?: boolean;
	ai?: boolean;
	json?: boolean;
	cwd?: string;
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function wikiCompileAction(
	options: WikiCompileOptions = {},
): Promise<CompilationResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");
	const wikiDir = join(mainaDir, "wiki");
	const dryRun = options.dryRun ?? false;
	const full = options.full ?? false;

	// If wiki not initialized, force full compilation
	const wikiExists = existsSync(wikiDir);
	const mode: "full" | "incremental" =
		full || !wikiExists ? "full" : "incremental";

	if (!options.json && !wikiExists) {
		log.info("Wiki not initialized, running full compilation...");
	} else if (!options.json && full) {
		log.info("Running full compilation...");
	}

	const result = await compileWiki({
		repoRoot: cwd,
		mainaDir,
		wikiDir,
		full: mode === "full",
		dryRun,
		useAI: options.ai ?? false,
	});

	if (!result.ok) {
		const errorMsg = result.error ?? "Unknown compilation error";
		if (!options.json) {
			log.error(`Compilation failed: ${errorMsg}`);
		}
		return {
			articlesTotal: 0,
			modules: 0,
			entities: 0,
			features: 0,
			decisions: 0,
			architecture: 0,
			duration: 0,
			mode,
			dryRun,
		};
	}

	const compilation = result.value;

	return {
		articlesTotal: compilation.articles.length,
		modules: compilation.stats.modules,
		entities: compilation.stats.entities,
		features: compilation.stats.features,
		decisions: compilation.stats.decisions,
		architecture: compilation.stats.architecture,
		duration: compilation.duration,
		mode,
		dryRun,
	};
}

// ── Commander Command ────────────────────────────────────────────────────────

export function wikiCompileCommand(parent: Command): void {
	parent
		.command("compile")
		.description("Compile wiki articles (incremental by default)")
		.option("--full", "Force full recompilation")
		.option("--dry-run", "Show what would change without writing")
		.option("--ai", "Enhance articles with AI-generated descriptions")
		.option("--json", "Output JSON for CI")
		.action(async (options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina wiki compile");
			}

			const s = spinner();
			if (!jsonMode) {
				s.start("Compiling wiki...");
			}

			const result = await wikiCompileAction({
				full: options.full,
				dryRun: options.dryRun,
				ai: options.ai,
				json: jsonMode,
			});

			if (!jsonMode) {
				s.stop("Compilation complete.");
				log.success(
					`${result.mode} compilation: ${result.articlesTotal} articles in ${result.duration}ms`,
				);
				log.info(
					`  Modules: ${result.modules}  Entities: ${result.entities}  Features: ${result.features}  Decisions: ${result.decisions}`,
				);
				outro("Done.");
			} else {
				outputJson(result, EXIT_PASSED);
			}
		});
}
