/**
 * `maina wiki compile` — incremental (or full) wiki compilation.
 *
 * Detects which source files changed since last compile, re-extracts
 * entities, and regenerates affected articles. Falls back to full
 * compilation when --full is passed or no state exists.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import {
	createEmptyState,
	getWikiChangedFiles,
	hashContent,
	loadWikiState,
} from "@mainahq/core";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";
import { runInitialCompilation } from "./init";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CompilationResult {
	articlesUpdated: number;
	articlesCreated: number;
	articlesTotal: number;
	changedFiles: number;
	duration: number;
	mode: "full" | "incremental";
	dryRun: boolean;
}

export interface WikiCompileOptions {
	full?: boolean;
	dryRun?: boolean;
	json?: boolean;
	cwd?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Count all .md files in wiki subdirectories.
 */
function countArticles(wikiDir: string): number {
	let count = 0;
	const subdirs = [
		"modules",
		"entities",
		"features",
		"decisions",
		"architecture",
		"raw",
	];
	for (const subdir of subdirs) {
		const dir = join(wikiDir, subdir);
		if (!existsSync(dir)) continue;
		try {
			const entries = readdirSync(dir);
			count += entries.filter((e) => e.endsWith(".md")).length;
		} catch {
			// skip
		}
	}
	return count;
}

/**
 * Collect current file hashes from source files.
 */
function collectCurrentHashes(repoRoot: string): Record<string, string> {
	const hashes: Record<string, string> = {};

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
				readdirSync(fullPath);
				// It's a directory, recurse
				walk(fullPath);
			} catch {
				// Not a directory — check if it's a .ts file
				if (
					entry.endsWith(".ts") &&
					!entry.endsWith(".test.ts") &&
					!entry.endsWith(".d.ts")
				) {
					try {
						const content = readFileSync(fullPath, "utf-8");
						hashes[relative(repoRoot, fullPath)] = hashContent(content);
					} catch {
						// skip
					}
				}
			}
		}
	}

	const packagesDir = join(repoRoot, "packages");
	const srcDir = join(repoRoot, "src");

	if (existsSync(packagesDir)) {
		walk(packagesDir);
	} else if (existsSync(srcDir)) {
		walk(srcDir);
	}

	return hashes;
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function wikiCompileAction(
	options: WikiCompileOptions = {},
): Promise<CompilationResult> {
	const cwd = options.cwd ?? process.cwd();
	const wikiDir = join(cwd, ".maina", "wiki");
	const startTime = Date.now();
	const dryRun = options.dryRun ?? false;

	// If wiki not initialized or --full requested, run full compilation
	if (!existsSync(wikiDir) || options.full) {
		if (!options.json) {
			log.info(
				options.full
					? "Running full compilation..."
					: "Wiki not initialized, running full compilation...",
			);
		}

		const initResult = await runInitialCompilation(cwd, wikiDir);

		return {
			articlesUpdated: 0,
			articlesCreated: initResult.articlesCreated,
			articlesTotal: initResult.articlesCreated,
			changedFiles: 0,
			duration: Date.now() - startTime,
			mode: "full",
			dryRun,
		};
	}

	// ── Incremental compilation ──────────────────────────────────────
	const previousState = loadWikiState(wikiDir) ?? createEmptyState();
	const currentHashes = collectCurrentHashes(cwd);
	const changedFiles = getWikiChangedFiles(
		previousState.fileHashes,
		currentHashes,
	);

	if (changedFiles.length === 0) {
		if (!options.json) {
			log.info("No files changed since last compilation.");
		}

		return {
			articlesUpdated: 0,
			articlesCreated: 0,
			articlesTotal: countArticles(wikiDir),
			changedFiles: 0,
			duration: Date.now() - startTime,
			mode: "incremental",
			dryRun,
		};
	}

	if (!options.json) {
		log.info(`${changedFiles.length} file(s) changed since last compilation.`);
	}

	if (dryRun) {
		if (!options.json) {
			for (const file of changedFiles) {
				log.message(`  would recompile: ${file}`);
			}
		}

		return {
			articlesUpdated: 0,
			articlesCreated: 0,
			articlesTotal: countArticles(wikiDir),
			changedFiles: changedFiles.length,
			duration: Date.now() - startTime,
			mode: "incremental",
			dryRun: true,
		};
	}

	// For now, incremental recompilation runs a full compile
	// (Sprint 1+2 compiler will provide true incremental support)
	const initResult = await runInitialCompilation(cwd, wikiDir);

	return {
		articlesUpdated: initResult.articlesCreated,
		articlesCreated: 0,
		articlesTotal: initResult.articlesCreated,
		changedFiles: changedFiles.length,
		duration: Date.now() - startTime,
		mode: "incremental",
		dryRun: false,
	};
}

// ── Commander Command ────────────────────────────────────────────────────────

export function wikiCompileCommand(parent: Command): void {
	parent
		.command("compile")
		.description("Compile wiki articles (incremental by default)")
		.option("--full", "Force full recompilation")
		.option("--dry-run", "Show what would change without writing")
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
				json: jsonMode,
			});

			if (!jsonMode) {
				s.stop("Compilation complete.");
				log.success(
					`${result.mode} compilation: ${result.articlesUpdated + result.articlesCreated} articles, ${result.duration}ms`,
				);
				outro("Done.");
			} else {
				outputJson(result, EXIT_PASSED);
			}
		});
}
