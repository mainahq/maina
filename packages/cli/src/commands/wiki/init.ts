/**
 * `maina wiki init` — scaffold wiki directory and run first compilation.
 *
 * Creates .maina/wiki/ structure, then delegates to the core wiki compiler
 * for full compilation with knowledge graph, Louvain communities, PageRank,
 * template-based articles, wikilinks, and index generation.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import { compileWiki } from "@mainahq/core";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WikiInitResult {
	articlesCreated: number;
	modules: number;
	entities: number;
	features: number;
	decisions: number;
	architecture: number;
	duration: number;
}

export interface WikiInitOptions {
	ai?: boolean;
	json?: boolean;
	cwd?: string;
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function wikiInitAction(
	options: WikiInitOptions = {},
): Promise<WikiInitResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");
	const wikiDir = join(mainaDir, "wiki");

	// ── Step 1: Ensure .maina and wiki directory structure exist ──────
	if (!existsSync(mainaDir)) {
		mkdirSync(mainaDir, { recursive: true });
	}

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

	// ── Step 2: Run full compilation via core compiler ────────────────
	const result = await compileWiki({
		repoRoot: cwd,
		mainaDir,
		wikiDir,
		full: true,
		useAI: options.ai ?? false,
	});

	if (!result.ok) {
		const errorMsg = result.error ?? "Unknown compilation error";
		if (!options.json) {
			log.error(`Compilation failed: ${errorMsg}`);
		}
		return {
			articlesCreated: 0,
			modules: 0,
			entities: 0,
			features: 0,
			decisions: 0,
			architecture: 0,
			duration: 0,
		};
	}

	const compilation = result.value;

	const initResult: WikiInitResult = {
		articlesCreated: compilation.articles.length,
		modules: compilation.stats.modules,
		entities: compilation.stats.entities,
		features: compilation.stats.features,
		decisions: compilation.stats.decisions,
		architecture: compilation.stats.architecture,
		duration: compilation.duration,
	};

	if (!options.json) {
		log.success(
			`Compiled ${initResult.articlesCreated} articles in ${initResult.duration}ms`,
		);
		log.info(
			`  Modules: ${initResult.modules}  Entities: ${initResult.entities}  Features: ${initResult.features}  Decisions: ${initResult.decisions}`,
		);
	}

	return initResult;
}

// ── Commander Command ────────────────────────────────────────────────────────

export function wikiInitCommand(parent: Command): void {
	parent
		.command("init")
		.description("Initialize wiki and run first compilation")
		.option("--ai", "Enhance articles with AI-generated descriptions")
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

			const result = await wikiInitAction({ ai: options.ai, json: jsonMode });

			if (!jsonMode) {
				s.stop("Wiki initialized.");
				outro("Done.");
			} else {
				outputJson(result, EXIT_PASSED);
			}
		});
}
