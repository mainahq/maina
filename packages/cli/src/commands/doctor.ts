import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { confirm, intro, log, outro, spinner } from "@clack/prompts";
import type {
	CacheStats,
	DetectedTool,
	McpClientId,
	McpClientInfo,
} from "@mainahq/core";
import {
	buildClientRegistry,
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

export type DoctorExecFn = (cmd: string) => Promise<{ exitCode: number }>;

export interface DoctorActionOptions {
	cwd?: string;
	json?: boolean;
	fix?: boolean;
	yes?: boolean;
	/** DI seam for tests; defaults to `Bun.spawn`-backed runner. */
	execFn?: DoctorExecFn;
	/** Override $HOME root for global-config lookups in tests. */
	home?: string;
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

export type McpScope = "project" | "global" | "both" | "missing";

export interface McpIntegration {
	client: McpClientId;
	label: string;
	scope: McpScope;
	projectPath: string | null;
	globalPath: string;
	/** Shell-parseable remediation when scope === "missing". */
	fix?: string;
}

export interface McpHealth {
	mcpJson: boolean;
	claudeSettings: boolean;
	serverCommand: string;
	toolCount: number;
	integrations: McpIntegration[];
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

function readMainaPresent(
	path: string,
	shape: McpClientInfo["shape"],
): boolean {
	if (!existsSync(path)) return false;
	try {
		const raw = readFileSync(path, "utf-8");
		// TOML clients (Codex) use a simple presence check: the entry key appears
		// under the configured path. Parsing full TOML is out of scope for doctor.
		if (path.endsWith(".toml")) {
			return raw.includes(`[${shape.path.join(".")}.${shape.entryKey}]`);
		}
		const content = JSON.parse(raw) as Record<string, unknown>;
		let cursor: unknown = content;
		for (const key of shape.path) {
			if (cursor && typeof cursor === "object" && key in (cursor as object)) {
				cursor = (cursor as Record<string, unknown>)[key];
			} else {
				return false;
			}
		}
		if (shape.container === "array") {
			return (
				Array.isArray(cursor) &&
				(cursor as Array<Record<string, unknown>>).some(
					(e) => e?.name === shape.entryKey,
				)
			);
		}
		return (
			cursor !== null &&
			typeof cursor === "object" &&
			shape.entryKey in (cursor as object)
		);
	} catch {
		return false;
	}
}

function checkMcpHealth(cwd: string, home?: string): McpHealth {
	const registry = buildClientRegistry(home);
	const integrations: McpIntegration[] = [];
	// `.mcp.json` at repo root is Claude Code's shared project-level source
	// alongside `.claude/settings.json`. Treat either as project-scope for Claude.
	const sharedMcpJsonPath = join(cwd, ".mcp.json");
	const sharedMcpJsonHasMaina = readMainaPresent(sharedMcpJsonPath, {
		path: ["mcpServers"],
		container: "object",
		entryKey: "maina",
	});
	for (const [id, info] of Object.entries(registry) as Array<
		[McpClientId, McpClientInfo]
	>) {
		const globalPath = info.globalConfigPath();
		const globalPresent = readMainaPresent(globalPath, info.shape);
		const projectPath = info.projectConfigPath?.(cwd) ?? null;
		let projectPresent = projectPath
			? readMainaPresent(projectPath, info.shape)
			: false;
		if (id === "claude" && sharedMcpJsonHasMaina) projectPresent = true;
		let scope: McpScope;
		if (globalPresent && projectPresent) scope = "both";
		else if (globalPresent) scope = "global";
		else if (projectPresent) scope = "project";
		else scope = "missing";
		const integration: McpIntegration = {
			client: id,
			label: info.label,
			scope,
			projectPath,
			globalPath,
		};
		if (scope === "missing") {
			integration.fix = `maina mcp add --client ${id} --scope global`;
		}
		integrations.push(integration);
	}

	const mcpJsonPath = join(cwd, ".mcp.json");
	const mcpJson = existsSync(mcpJsonPath);
	const claudeIntegration = integrations.find((i) => i.client === "claude");
	// `claudeSettings` is true whenever a maina MCP is wired for Claude Code at
	// ANY scope — global, project, or both. Users with only a user-level
	// registration should not be told their settings are missing (G10).
	const claudeSettings =
		claudeIntegration?.scope !== undefined &&
		claudeIntegration.scope !== "missing";

	// Determine the server command from .mcp.json
	let serverCommand = "not configured";
	let toolCount = 0;
	if (mcpJson) {
		try {
			const content = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
			const mainaServer = content?.mcpServers?.maina;
			if (mainaServer) {
				serverCommand = `${mainaServer.command} ${(mainaServer.args ?? []).join(" ")}`;
				toolCount = 10;
			}
		} catch {
			// Invalid JSON
		}
	}

	return { mcpJson, claudeSettings, serverCommand, toolCount, integrations };
}

async function defaultExec(cmd: string): Promise<{ exitCode: number }> {
	const parts = cmd.split(/\s+/).filter((p) => p.length > 0);
	if (parts.length === 0) return { exitCode: 1 };
	const proc = Bun.spawn({ cmd: parts, stdout: "inherit", stderr: "inherit" });
	const exitCode = await proc.exited;
	return { exitCode };
}

async function runFixFlow(
	health: McpHealth,
	opts: { yes: boolean; execFn: DoctorExecFn; jsonMode: boolean },
): Promise<void> {
	const missing = health.integrations.filter(
		(i) => i.scope === "missing" && typeof i.fix === "string",
	);
	if (missing.length === 0) {
		if (!opts.jsonMode) log.success("No MCP integrations to fix.");
		return;
	}
	for (const row of missing) {
		if (!row.fix) continue;
		if (!opts.yes) {
			const proceed = await confirm({
				message: `Run fix for ${row.label}? ${row.fix}`,
			});
			if (proceed !== true) continue;
		}
		if (!opts.jsonMode) log.info(`→ ${row.fix}`);
		const { exitCode } = await opts.execFn(row.fix);
		if (!opts.jsonMode) {
			if (exitCode === 0) log.success(`Fixed: ${row.label}`);
			else log.error(`Fix failed for ${row.label} (exit ${exitCode})`);
		}
	}
}

function formatMcpHealth(health: McpHealth): string {
	const lines: string[] = [];
	for (const row of health.integrations) {
		const mark =
			row.scope === "missing"
				? "\u2717"
				: row.scope === "both"
					? "\u2713\u2713"
					: "\u2713";
		lines.push(
			`  ${row.label.padEnd(18)} ${mark} ${row.scope}${
				row.scope === "missing" && row.fix ? ` — fix: ${row.fix}` : ""
			}`,
		);
	}
	if (health.serverCommand !== "not configured") {
		lines.push(
			`  MCP Server         \u2713 ${health.toolCount} tools registered`,
		);
	} else {
		lines.push("  MCP Server         \u2717 not configured");
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
	const mcpHealth = checkMcpHealth(cwd, options.home);
	if (!jsonMode) {
		log.step("MCP Integration:");
		log.message(formatMcpHealth(mcpHealth));
	}

	// ── Step 8: --fix flow (optional) ────────────────────────────────
	let finalMcpHealth = mcpHealth;
	if (options.fix) {
		// jsonMode implies non-interactive: a CI caller passing --json --fix
		// without --yes must not block on a terminal prompt. Auto-approve
		// when json is set (they asked for machine-readable, they get
		// machine-driven).
		const yes = (options.yes ?? false) || jsonMode;
		await runFixFlow(mcpHealth, {
			yes,
			execFn: options.execFn ?? defaultExec,
			jsonMode,
		});
		// Recompute after the fix commands ran so the returned / rendered
		// integration table reflects the post-fix state. Otherwise callers
		// (and the JSON consumer) see stale "missing" rows for clients that
		// were just wired up.
		finalMcpHealth = checkMcpHealth(cwd, options.home);
		if (!jsonMode) {
			log.step("MCP Integration (after --fix):");
			log.message(formatMcpHealth(finalMcpHealth));
		}
	}

	return {
		version,
		tools,
		engines,
		cacheStats,
		aiStatus,
		wikiHealth,
		mcpHealth: finalMcpHealth,
	};
}

// ── Commander Command ────────────────────────────────────────────────────────

export function doctorCommand(): Command {
	return new Command("doctor")
		.description("Check tool installation and engine health")
		.option("--json", "Output JSON for CI")
		.option("--fix", "Run the remediation command for each missing MCP row")
		.option("-y, --yes", "Skip confirmations (with --fix)")
		.action(async (options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina doctor");
			}

			const s = spinner();
			if (!jsonMode) {
				s.start("Checking system health…");
			}

			const result = await doctorAction({
				json: jsonMode,
				fix: options.fix,
				yes: options.yes,
			});

			if (!jsonMode) {
				s.stop("Health check complete.");
				outro("Done.");
			} else {
				outputJson(result, EXIT_PASSED);
			}
		});
}
