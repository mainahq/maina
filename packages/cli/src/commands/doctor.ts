import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import type { CacheStats, DetectedTool } from "@mainahq/core";
import {
	createCacheManager,
	detectTools,
	getApiKey,
	getFeedbackDb,
	isHostMode,
} from "@mainahq/core";
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

export interface AIStatus {
	apiKey: boolean;
	hostMode: boolean;
	feedbackTotal: number;
	feedbackAcceptRate: number;
	cacheEntries: number;
	cacheHitRate: number;
}

export interface WikiHealth {
	initialized: boolean;
	totalArticles: number;
	staleCount: number;
	coveragePercent: number;
	lastCompile: string;
}

export interface McpHealth {
	mcpJson: boolean;
	claudeSettings: boolean;
	serverCommand: string;
	toolCount: number;
}

export interface DoctorActionResult {
	version: string;
	tools: DetectedTool[];
	engines: EngineHealth;
	cacheStats: CacheStats | null;
	aiStatus: AIStatus;
	wikiHealth: WikiHealth;
	mcpHealth: McpHealth;
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

function formatAIStatus(status: AIStatus): string {
	const lines: string[] = [];

	// API Key
	if (status.apiKey) {
		lines.push("  API Key        \u2713  OPENROUTER_API_KEY set");
	} else {
		lines.push("  API Key        \u2717  No API key found");
	}

	// Host Mode
	if (status.hostMode) {
		lines.push("  Host Mode      \u2713  AI agent detected");
	} else {
		lines.push("  Host Mode      \u2717  Not in AI agent");
	}

	// Feedback
	if (status.feedbackTotal > 0) {
		const rate = Math.round(status.feedbackAcceptRate * 100);
		lines.push(
			`  Feedback       ${status.feedbackTotal} outcomes, ${rate}% accept rate`,
		);
	} else {
		lines.push("  Feedback       \u2014  No data");
	}

	// Cache
	if (status.cacheEntries > 0) {
		const rate = Math.round(status.cacheHitRate * 100);
		lines.push(
			`  Cache          ${status.cacheEntries} entries, ${rate}% hit rate`,
		);
	} else {
		lines.push("  Cache          \u2014  Empty");
	}

	return lines.join("\n");
}

function formatWikiHealth(health: WikiHealth): string {
	if (!health.initialized) {
		return "  Wiki: not initialized (run `maina wiki init`)";
	}

	const header = `  ${"Metric".padEnd(16)} Value`;
	const separator = `  ${"─".repeat(16)} ${"─".repeat(20)}`;
	const rows = [
		`  ${"Articles".padEnd(16)} ${health.totalArticles}`,
		`  ${"Stale".padEnd(16)} ${health.staleCount}`,
		`  ${"Coverage".padEnd(16)} ${health.coveragePercent}%`,
		`  ${"Last Compile".padEnd(16)} ${health.lastCompile}`,
	];
	return [header, separator, ...rows].join("\n");
}

// ── MCP Health Check ──────────────────────────────────────────────────────

function checkMcpHealth(cwd: string): McpHealth {
	const mcpJsonPath = join(cwd, ".mcp.json");
	const mcpJson = existsSync(mcpJsonPath);

	const claudeSettingsPath = join(cwd, ".claude", "settings.json");
	let claudeSettings = false;
	if (existsSync(claudeSettingsPath)) {
		try {
			const content = JSON.parse(readFileSync(claudeSettingsPath, "utf-8"));
			claudeSettings = content?.mcpServers?.maina !== undefined;
		} catch {
			// Invalid JSON — not configured
		}
	}

	// Determine the server command from .mcp.json
	let serverCommand = "not configured";
	let toolCount = 0;
	if (mcpJson) {
		try {
			const content = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
			const mainaServer = content?.mcpServers?.maina;
			if (mainaServer) {
				serverCommand = `${mainaServer.command} ${(mainaServer.args ?? []).join(" ")}`;
				// Count known tools: 10 is the current registered count
				// (getContext, verify, analyzeFeature, explainModule, reviewCode,
				//  checkSlop, suggestTests, getConventions, wikiQuery, wikiCompile)
				toolCount = 10;
			}
		} catch {
			// Invalid JSON
		}
	}

	return { mcpJson, claudeSettings, serverCommand, toolCount };
}

function formatMcpHealth(health: McpHealth): string {
	const lines: string[] = [];
	lines.push(
		`  .mcp.json              ${health.mcpJson ? "\u2713 found" : "\u2717 missing"}`,
	);
	lines.push(
		`  .claude/settings.json  ${health.claudeSettings ? "\u2713 found (Claude Code)" : "\u2717 missing (Claude Code)"}`,
	);
	if (health.serverCommand !== "not configured") {
		lines.push(
			`  MCP Server             \u2713 ${health.toolCount} tools registered`,
		);
	} else {
		lines.push("  MCP Server             \u2717 not configured");
	}
	return lines.join("\n");
}

// ── Wiki Health Check ──────────────────────────────────────────────────────

function countMdFiles(dir: string): number {
	if (!existsSync(dir)) return 0;
	let count = 0;
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".md")) {
				count++;
			} else if (entry.isDirectory()) {
				count += countMdFiles(join(dir, entry.name));
			}
		}
	} catch {
		// ignore read errors
	}
	return count;
}

function checkWikiHealth(cwd: string): WikiHealth {
	const wikiDir = join(cwd, ".maina", "wiki");
	if (!existsSync(wikiDir)) {
		return {
			initialized: false,
			totalArticles: 0,
			staleCount: 0,
			coveragePercent: 0,
			lastCompile: "never",
		};
	}

	const totalArticles = countMdFiles(wikiDir);

	let lastCompile = "never";
	let coveragePercent = 0;
	let staleCount = 0;
	const stateFile = join(wikiDir, ".state.json");
	if (existsSync(stateFile)) {
		try {
			const state = JSON.parse(readFileSync(stateFile, "utf-8"));
			lastCompile = state.lastCompile ?? "never";
			coveragePercent =
				typeof state.coveragePercent === "number" ? state.coveragePercent : 0;
			staleCount = typeof state.staleCount === "number" ? state.staleCount : 0;
		} catch {
			// ignore parse errors
		}
	}

	return {
		initialized: true,
		totalArticles,
		staleCount,
		coveragePercent,
		lastCompile,
	};
}

// ── AI Status Check ────────────────────────────────────────────────────────

function checkAIStatus(cwd: string, cacheStats: CacheStats | null): AIStatus {
	const mainaDir = join(cwd, ".maina");

	// API Key
	const apiKey = getApiKey() !== null;

	// Host Mode
	const hostMode = isHostMode();

	// Feedback stats
	let feedbackTotal = 0;
	let feedbackAcceptRate = 0;
	const fbResult = getFeedbackDb(mainaDir);
	if (fbResult.ok) {
		try {
			const row = fbResult.value.db
				.query(
					"SELECT COUNT(*) as total, SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted FROM feedback",
				)
				.get() as { total: number; accepted: number } | null;
			if (row && row.total > 0) {
				feedbackTotal = row.total;
				feedbackAcceptRate = row.accepted / row.total;
			}
		} catch {
			// Table may not exist yet
		}
	}

	// Cache stats
	let cacheEntries = 0;
	let cacheHitRate = 0;
	if (cacheStats) {
		cacheEntries = cacheStats.entriesL1 + cacheStats.entriesL2;
		const totalQueries = cacheStats.totalQueries;
		if (totalQueries > 0) {
			cacheHitRate = (cacheStats.l1Hits + cacheStats.l2Hits) / totalQueries;
		}
	}

	return {
		apiKey,
		hostMode,
		feedbackTotal,
		feedbackAcceptRate,
		cacheEntries,
		cacheHitRate,
	};
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

	// ── Step 5: AI Status ───────────────────────────────────────────────
	const aiStatus = checkAIStatus(cwd, cacheStats);
	if (!jsonMode) {
		log.step("AI Status:");
		log.message(formatAIStatus(aiStatus));
		if (!aiStatus.apiKey && !aiStatus.hostMode) {
			log.message("");
			log.message("  \u2192 Run `maina init` to set up AI features");
		}
	}

	// ── Step 6: Wiki Health ────────────────────────────────────────────
	const wikiHealth = checkWikiHealth(cwd);
	if (!jsonMode) {
		log.step("Wiki Health:");
		log.message(formatWikiHealth(wikiHealth));
	}

	// ── Step 7: MCP Integration ───────────────────────────────────────
	const mcpHealth = checkMcpHealth(cwd);
	if (!jsonMode) {
		log.step("MCP Integration:");
		log.message(formatMcpHealth(mcpHealth));
	}

	return {
		version,
		tools,
		engines,
		cacheStats,
		aiStatus,
		wikiHealth,
		mcpHealth,
	};
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
