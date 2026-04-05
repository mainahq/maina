import { existsSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import type { CacheStats, DetectedTool } from "@mainahq/core";
import { createCacheManager, detectTools } from "@mainahq/core";
import { Command } from "commander";
import pkg from "../../package.json";
import { EXIT_PASSED, outputJson } from "../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DoctorActionOptions {
	cwd?: string;
	json?: boolean;
}

export interface EngineHealth {
	context: string;
	prompt: string;
	verify: string;
}

export interface DoctorActionResult {
	version: string;
	tools: DetectedTool[];
	engines: EngineHealth;
	cacheStats: CacheStats | null;
}

// ── Formatting Helpers ───────────────────────────────────────────────────────

function formatToolsTable(tools: DetectedTool[]): string {
	const header = `  ${"Tool".padEnd(12)} ${"Status".padEnd(8)} Version`;
	const separator = `  ${"─".repeat(12)} ${"─".repeat(8)} ${"─".repeat(14)}`;
	const rows = tools.map((t) => {
		const status = t.available ? "\u2713" : "\u2717";
		const version = t.version ?? "not installed";
		return `  ${t.name.padEnd(12)} ${status.padEnd(8)} ${version}`;
	});
	return [header, separator, ...rows].join("\n");
}

function formatEngineHealth(engines: EngineHealth): string {
	const header = `  ${"Engine".padEnd(16)} Status`;
	const separator = `  ${"─".repeat(16)} ${"─".repeat(20)}`;
	const rows = [
		`  ${"Context".padEnd(16)} ${engines.context}`,
		`  ${"Prompt".padEnd(16)} ${engines.prompt}`,
		`  ${"Verify".padEnd(16)} ${engines.verify}`,
	];
	return [header, separator, ...rows].join("\n");
}

function formatCacheStats(stats: CacheStats): string {
	const header = `  ${"Metric".padEnd(16)} Value`;
	const separator = `  ${"─".repeat(16)} ${"─".repeat(10)}`;
	const rows = [
		`  ${"L1 Hits".padEnd(16)} ${stats.l1Hits}`,
		`  ${"L2 Hits".padEnd(16)} ${stats.l2Hits}`,
		`  ${"Misses".padEnd(16)} ${stats.misses}`,
		`  ${"Total Queries".padEnd(16)} ${stats.totalQueries}`,
		`  ${"L1 Entries".padEnd(16)} ${stats.entriesL1}`,
		`  ${"L2 Entries".padEnd(16)} ${stats.entriesL2}`,
	];
	return [header, separator, ...rows].join("\n");
}

// ── Engine Health Check ─────────────────────────────────────────────────────

function checkEngineHealth(cwd: string): EngineHealth {
	const mainaDir = join(cwd, ".maina");

	// Context Engine: check .maina/context/ exists
	const contextDir = join(mainaDir, "context");
	const contextStatus = existsSync(contextDir) ? "ready" : "not configured";

	// Prompt Engine: check .maina/prompts/ and constitution.md
	const promptsDir = join(mainaDir, "prompts");
	const constitutionPath = join(mainaDir, "constitution.md");
	const promptsDirExists = existsSync(promptsDir);
	const constitutionExists = existsSync(constitutionPath);

	let promptStatus: string;
	if (promptsDirExists && constitutionExists) {
		promptStatus = "ready";
	} else if (promptsDirExists) {
		promptStatus = "partial (no constitution.md)";
	} else {
		promptStatus = "not configured";
	}

	// Verify Engine: always ready (all modules loaded)
	const verifyStatus = "ready";

	return {
		context: contextStatus,
		prompt: promptStatus,
		verify: verifyStatus,
	};
}

// ── Core Action (testable) ──────────────────────────────────────────────────

/**
 * The core doctor logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function doctorAction(
	options: DoctorActionOptions,
): Promise<DoctorActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");
	const jsonMode = options.json ?? false;

	// ── Step 1: Version ──────────────────────────────────────────────────
	const version = pkg.version;
	if (!jsonMode) {
		log.info(`Maina v${version}`);
	}

	// ── Step 2: Detect tools ─────────────────────────────────────────────
	const tools = await detectTools();
	if (!jsonMode) {
		log.step("Installed Tools:");
		log.message(formatToolsTable(tools));
	}

	// ── Step 3: Engine health ────────────────────────────────────────────
	const engines = checkEngineHealth(cwd);
	if (!jsonMode) {
		log.step("Engine Health:");
		log.message(formatEngineHealth(engines));
	}

	// ── Step 4: Cache stats (if .maina/cache/ exists) ────────────────────
	let cacheStats: CacheStats | null = null;
	const cacheDir = join(mainaDir, "cache");
	if (existsSync(cacheDir)) {
		const cache = createCacheManager(mainaDir);
		cacheStats = cache.stats();
		if (!jsonMode) {
			log.step("Cache Stats:");
			log.message(formatCacheStats(cacheStats));
		}
	}

	return { version, tools, engines, cacheStats };
}

// ── Commander Command ────────────────────────────────────────────────────────

export function doctorCommand(): Command {
	return new Command("doctor")
		.description("Check tool installation and engine health")
		.option("--json", "Output JSON for CI")
		.action(async (options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina doctor");
			}

			const s = spinner();
			if (!jsonMode) {
				s.start("Checking system health…");
			}

			const result = await doctorAction({ json: jsonMode });

			if (!jsonMode) {
				s.stop("Health check complete.");
				outro("Done.");
			} else {
				outputJson(result, EXIT_PASSED);
			}
		});
}
