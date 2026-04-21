/**
 * `maina wiki init` — scaffold wiki directory and run first compilation.
 *
 * Creates .maina/wiki/ structure, then delegates to the core wiki compiler
 * for full compilation with knowledge graph, Louvain communities, PageRank,
 * template-based articles, wikilinks, and index generation.
 *
 * Wave 4 / G9: `--background` forks the compile and returns immediately.
 * Progress is written to `.maina/wiki/.progress.json`; `maina wiki status`
 * polls the file and renders a percent-complete + ETA line.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import { compileWiki } from "@mainahq/core";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export type WikiInitDepth = "quick" | "full";

export interface WikiInitResult {
	articlesCreated: number;
	modules: number;
	entities: number;
	features: number;
	decisions: number;
	architecture: number;
	duration: number;
	/** True when the compile was detached into a background process. */
	backgrounded: boolean;
}

export interface WikiInitOptions {
	ai?: boolean;
	json?: boolean;
	cwd?: string;
	/** Detach the compile into a background child process (G9). */
	background?: boolean;
	/** `"quick"` passes `sample: true` to the core compiler. Default `full`. */
	depth?: WikiInitDepth;
	/**
	 * Dependency-injection hook used by tests so the real `Bun.spawn` does
	 * not fire. Receives the argv the child would run with.
	 */
	_spawnBackground?: (args: string[], cwd: string) => { pid: number };
}

interface ProgressSnapshot {
	startedAt: string;
	percent: number;
	etaSeconds: number;
	stage: string;
}

// ── Progress file ───────────────────────────────────────────────────────────

/**
 * Write the initial seed progress record so `maina wiki status` has
 * something to render the instant the background compile is spawned.
 */
function writeProgressSeed(wikiDir: string): void {
	mkdirSync(wikiDir, { recursive: true });
	const seed: ProgressSnapshot = {
		startedAt: new Date().toISOString(),
		percent: 0,
		etaSeconds: 0,
		stage: "starting",
	};
	writeFileSync(
		join(wikiDir, ".progress.json"),
		JSON.stringify(seed, null, 2),
		"utf-8",
	);
}

// ── Default spawn helper ────────────────────────────────────────────────────

function defaultSpawnBackground(args: string[], cwd: string): { pid: number } {
	// Bun.spawn with detached-like options — we fire-and-forget. The child
	// process re-enters this file via the Commander CLI and runs the
	// foreground path, updating `.progress.json` as it goes.
	const proc = Bun.spawn(args, {
		cwd,
		stdout: "ignore",
		stderr: "ignore",
		stdin: "ignore",
	});
	// Detach from the event loop so the parent can exit cleanly.
	proc.unref?.();
	return { pid: proc.pid };
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

	// ── Step 2: --background path (G9) ────────────────────────────────
	if (options.background === true) {
		writeProgressSeed(wikiDir);
		const depth = options.depth ?? "full";
		const spawn = options._spawnBackground ?? defaultSpawnBackground;
		// Invoke `maina` directly when it's on PATH (the normal install case).
		// Falling back to `process.execPath` + `process.argv[1]` keeps the
		// background spawn working when the CLI was launched from a path that
		// isn't on the user's PATH (e.g. a bun-linked dev build). We never
		// use `bun run maina` because user repos don't have a `maina` script
		// in their package.json, so `bun run maina` would fail.
		const mainaOnPath = Bun.which("maina");
		const args =
			mainaOnPath !== null
				? [mainaOnPath, "wiki", "init", "--json", "--depth", depth]
				: [
						process.execPath,
						process.argv[1] ?? "",
						"wiki",
						"init",
						"--json",
						"--depth",
						depth,
					];
		if (options.ai === true) args.push("--ai");
		spawn(args, cwd);
		if (!options.json) {
			log.success(
				"Wiki compile running in background. Poll with `maina wiki status`.",
			);
		}
		return {
			articlesCreated: 0,
			modules: 0,
			entities: 0,
			features: 0,
			decisions: 0,
			architecture: 0,
			duration: 0,
			backgrounded: true,
		};
	}

	// ── Step 3: Run full compilation via core compiler ────────────────
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
			backgrounded: false,
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
		backgrounded: false,
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
		.option(
			"--background",
			"Fork the compile into a background process and return immediately (G9)",
		)
		.option(
			"--depth <depth>",
			"Compile depth: 'quick' (sampled) or 'full' (default)",
			"full",
		)
		.option("--json", "Output JSON for CI")
		.action(async (options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina wiki init");
			}

			const s = spinner();
			if (!jsonMode && options.background !== true) {
				s.start("Initializing wiki...");
			}

			const depth: WikiInitDepth = options.depth === "quick" ? "quick" : "full";
			const result = await wikiInitAction({
				ai: options.ai,
				json: jsonMode,
				background: options.background === true,
				depth,
			});

			if (!jsonMode && options.background !== true) {
				s.stop("Wiki initialized.");
				outro("Done.");
			} else if (jsonMode) {
				outputJson(result, EXIT_PASSED);
			}
		});
}
