import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { confirm, intro, log, outro, spinner } from "@clack/prompts";
import type { CacheStats, DetectedTool, FsPort } from "@mainahq/core";
import {
	createCacheManager,
	detectTools,
	getApiKey,
	getFeedbackDb,
	getRepoRoot,
	isHostMode,
	loadPolicy,
	VERSION,
} from "@mainahq/core";
import { Command } from "commander";
import { processEnv } from "../env";
import {
	type CheckStatus,
	checkHostHealth,
	type HealthCheck,
	type HostHealth,
	type HostHealthPorts,
} from "../hosts/health";
import type { McpClientId } from "../hosts/index";
import {
	buildClientRegistry,
	hostPathContext,
	listClientIds,
} from "../hosts/index";
import { readEntry } from "../hosts/merge";
import { type Probe, probeMcp } from "../hosts/probe";
import { type TargetFile, targetsFor } from "../hosts/targets";
import { EXIT_FINDINGS, EXIT_PASSED, outputJson } from "../json";

// ── Types ────────────────────────────────────────────────────────────────────

type DoctorExecFn = (cmd: string) => Promise<{ exitCode: number }>;

interface DoctorActionOptions {
	cwd?: string;
	json?: boolean;
	fix?: boolean;
	yes?: boolean;
	/** DI seam for tests; defaults to `Bun.spawn`-backed runner. */
	execFn?: DoctorExecFn;
	/** Override $HOME root for global-config lookups in tests. */
	home?: string;
	/** DI seam for tests; defaults to launching the entry for real. */
	probe?: Probe;
}

interface EngineHealth {
	context: string;
	prompt: string;
	verify: string;
}

interface AIStatus {
	apiKey: boolean;
	hostMode: boolean;
	feedbackTotal: number;
	feedbackAcceptRate: number;
	cacheEntries: number;
	cacheHitRate: number;
}

interface WikiHealth {
	initialized: boolean;
	totalArticles: number;
	staleCount: number;
	coveragePercent: number;
	lastCompile: string;
}

type McpScope = "project" | "global" | "both" | "missing";

interface McpIntegration {
	client: McpClientId;
	label: string;
	scope: McpScope;
	projectPath: string | null;
	globalPath: string;
	/** Shell-parseable remediation when scope === "missing". */
	fix?: string;
}

interface McpHealth {
	mcpJson: boolean;
	claudeSettings: boolean;
	serverCommand: string;
	toolCount: number;
	integrations: McpIntegration[];
}

interface DoctorActionResult {
	version: string;
	tools: DetectedTool[];
	engines: EngineHealth;
	cacheStats: CacheStats | null;
	aiStatus: AIStatus;
	wikiHealth: WikiHealth;
	mcpHealth: McpHealth;
	/** doctor v2: every configured entry launched under its host's env. */
	hostHealth: HostHealth;
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

/** True when `target` exists and holds a maina entry. */
function mainaPresent(target: TargetFile): boolean {
	if (!existsSync(target.path)) return false;
	try {
		const found = readEntry(target, readFileSync(target.path, "utf-8"));
		return found.ok && found.value !== undefined;
	} catch {
		return false;
	}
}

function checkMcpHealth(cwd: string, home?: string): McpHealth {
	const ctx = hostPathContext(cwd, home);
	const registry = buildClientRegistry(ctx);
	const integrations: McpIntegration[] = [];
	// Paths come from the host targets, so doctor looks exactly where each
	// host reads: Claude Code's `.mcp.json` / `~/.claude.json`, never a
	// `settings.json` it ignores.
	for (const id of listClientIds()) {
		const info = registry[id];
		const [global] = targetsFor(id, "global", ctx);
		const [project] = targetsFor(id, "project", ctx);
		const globalPresent = global !== undefined && mainaPresent(global);
		const projectPresent = project !== undefined && mainaPresent(project);
		let scope: McpScope;
		if (globalPresent && projectPresent) scope = "both";
		else if (globalPresent) scope = "global";
		else if (projectPresent) scope = "project";
		else scope = "missing";
		const integration: McpIntegration = {
			client: id,
			label: info.label,
			scope,
			projectPath: project?.path ?? null,
			globalPath: global?.path ?? "",
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

interface FixRow {
	readonly label: string;
	readonly fix: string;
}

/**
 * What `--fix` runs: each missing integration's fix, then each broken
 * host entry's re-registration. Only `maina mcp add` fixes are run; the
 * rest (editing a file, pulling a model) stay advice. Deduplicated.
 */
function fixRows(health: McpHealth, hosts: HostHealth): readonly FixRow[] {
	const rows: FixRow[] = [
		...health.integrations.flatMap((i) =>
			i.scope === "missing" && typeof i.fix === "string"
				? [{ label: i.label, fix: i.fix }]
				: [],
		),
		...hosts.hosts.flatMap((h) =>
			h.checks.flatMap((c) =>
				c.status === "fail" && c.fix?.startsWith("maina mcp add ")
					? [{ label: `${h.label} (${h.scope})`, fix: c.fix }]
					: [],
			),
		),
	];
	const seen = new Set<string>();
	return rows.filter((r) => {
		if (seen.has(r.fix)) return false;
		seen.add(r.fix);
		return true;
	});
}

async function runFixFlow(
	rows: readonly FixRow[],
	opts: { yes: boolean; execFn: DoctorExecFn; jsonMode: boolean },
): Promise<void> {
	if (rows.length === 0) {
		if (!opts.jsonMode) log.success("No MCP integrations to fix.");
		return;
	}
	for (const row of rows) {
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

// ── Host Launch Check (doctor v2) ─────────────────────────────────────────

function readOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

/** Read-only `FsPort` for `loadPolicy`; doctor never writes through it. */
const readOnlyFs: FsPort = {
	readFile: async (path) => {
		const text = readOrNull(path);
		if (text !== null) return { ok: true, value: text };
		return existsSync(path)
			? { ok: false, error: { kind: "io", path, message: "unreadable" } }
			: { ok: false, error: { kind: "not_found", path } };
	},
	writeFile: async (path) => ({
		ok: false,
		error: { kind: "io", path, message: "doctor is read-only" },
	}),
	exists: async (path) => existsSync(path),
	readDir: async (path) => {
		try {
			return { ok: true, value: readdirSync(path).sort() };
		} catch {
			return { ok: false, error: { kind: "not_found", path } };
		}
	},
	remove: async (path) => ({
		ok: false,
		error: { kind: "io", path, message: "doctor is read-only" },
	}),
};

function hostHealthPorts(probe: Probe): HostHealthPorts {
	return {
		readFile: readOrNull,
		listDir: (path) => {
			try {
				return readdirSync(path);
			} catch {
				return null;
			}
		},
		realpath: (path) => {
			try {
				return realpathSync(path);
			} catch {
				return path;
			}
		},
		repoRoot: async (cwd) => (await getRepoRoot(cwd)) || null,
		// The user default layer is read by the runtime (not yet built), so
		// doctor validates the defaults plus the repo's `.maina/policy.json`.
		loadPolicy: (root) => loadPolicy({ fs: readOnlyFs }, root, undefined),
		probe,
	};
}

function checkHosts(
	cwd: string,
	home: string | undefined,
	probe: Probe,
): Promise<HostHealth> {
	return checkHostHealth(
		{
			ctx: hostPathContext(cwd, home),
			version: VERSION,
			platform: platform(),
			inheritedEnv: Object.fromEntries(
				Object.entries(process.env).filter(
					(kv): kv is [string, string] => kv[1] !== undefined,
				),
			),
		},
		hostHealthPorts(probe),
	);
}

const MARK: Readonly<Record<CheckStatus, string>> = {
	pass: "\u2713",
	warn: "!",
	fail: "\u2717",
};

function formatCheck(c: HealthCheck, indent: string): string {
	return `${indent}${MARK[c.status]} ${c.id.padEnd(10)} ${c.message}${
		c.fix ? `\n${indent}  fix: ${c.fix}` : ""
	}`;
}

function formatHostHealth(health: HostHealth): string {
	const lines: string[] = [
		`  Launched under the host's ${health.launchEnv.mode} env (PATH=${health.launchEnv.PATH})`,
	];
	if (health.hosts.length === 0) {
		lines.push("  No configured maina entries to launch");
	}
	for (const h of health.hosts) {
		lines.push(`  ${MARK[h.status]} ${h.label} (${h.scope}) ${h.path}`);
		for (const c of h.checks) {
			if (c.status !== "pass") lines.push(formatCheck(c, "      "));
		}
	}
	lines.push("  Runtime:");
	for (const c of health.runtime) lines.push(formatCheck(c, "    "));
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
	const apiKey = getApiKey(processEnv) !== null;

	// Host Mode
	const hostMode = isHostMode(processEnv);

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
	const version = VERSION;
	if (!jsonMode) {
		log.info(`Maina v${version}`);
	}

	// ── Step 2: Detect tools ─────────────────────────────────────────────
	const tools = await detectTools(cwd);
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

	// ── Step 8: Host launch (doctor v2) ──────────────────────────────
	const probe = options.probe ?? probeMcp;
	const hostHealth = await checkHosts(cwd, options.home, probe);
	if (!jsonMode) {
		log.step("Host Launch:");
		log.message(formatHostHealth(hostHealth));
	}

	// ── Step 9: --fix flow (optional) ────────────────────────────────
	let finalMcpHealth = mcpHealth;
	let finalHostHealth = hostHealth;
	if (options.fix) {
		// jsonMode implies non-interactive: a CI caller passing --json --fix
		// without --yes must not block on a terminal prompt. Auto-approve
		// when json is set (they asked for machine-readable, they get
		// machine-driven).
		const yes = (options.yes ?? false) || jsonMode;
		const rows = fixRows(mcpHealth, hostHealth);
		await runFixFlow(rows, {
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
		finalHostHealth = await checkHosts(cwd, options.home, probe);
		if (!jsonMode) {
			log.step("Host Launch (after --fix):");
			log.message(formatHostHealth(finalHostHealth));
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
		hostHealth: finalHostHealth,
	};
}

// ── Commander Command ────────────────────────────────────────────────────────

export function doctorCommand(): Command {
	return new Command("doctor")
		.description(
			"Check tool installation, engine health, and launch every configured MCP entry under its host's env",
		)
		.option("--json", "Output JSON for CI")
		.option(
			"--fix",
			"Run the `maina mcp add` fix for each missing MCP row and broken host entry",
		)
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

			// A failed check exits non-zero so CI and scripts can gate on it.
			const exitCode = result.hostHealth.ok ? EXIT_PASSED : EXIT_FINDINGS;
			if (!jsonMode) {
				s.stop("Health check complete.");
				outro(
					result.hostHealth.ok
						? "Done."
						: "Some checks failed; run each printed fix.",
				);
				process.exitCode = exitCode;
			} else {
				outputJson(result, exitCode);
			}
		});
}
