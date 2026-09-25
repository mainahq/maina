import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ── Mock State ───────────────────────────────────────────────────────────────

let mockDetectedTools = [
	{ name: "biome", command: "biome", version: "1.9.4", available: true },
	{ name: "semgrep", command: "semgrep", version: null, available: false },
	{ name: "trivy", command: "trivy", version: null, available: false },
	{
		name: "secretlint",
		command: "secretlint",
		version: null,
		available: false,
	},
	{
		name: "sonarqube",
		command: "sonar-scanner",
		version: null,
		available: false,
	},
	{ name: "stryker", command: "stryker", version: null, available: false },
];

let mockCacheStats = {
	l1Hits: 10,
	l2Hits: 25,
	misses: 5,
	totalQueries: 40,
	entriesL1: 8,
	entriesL2: 30,
};

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockApiKey: string | null = null;
let mockHostMode = false;
let mockFeedbackDbResult: { ok: boolean; value?: unknown; error?: string } = {
	ok: false,
	error: "no db",
};

const actualCore = await import("@mainahq/core");

mock.module("@mainahq/core", () => ({
	...actualCore,
	detectTools: async () => mockDetectedTools,
	createCacheManager: () => ({
		stats: () => mockCacheStats,
		get: () => null,
		set: () => {},
		has: () => false,
		invalidate: () => {},
		clear: () => {},
	}),
	getApiKey: () => mockApiKey,
	isHostMode: () => mockHostMode,
	openFeedbackStore: () => mockFeedbackDbResult,
}));

mock.module("@clack/prompts", () => ({
	intro: () => {},
	outro: () => {},
	log: {
		info: () => {},
		error: () => {},
		warning: () => {},
		success: () => {},
		message: () => {},
		step: () => {},
	},
	spinner: () => ({
		start: () => {},
		stop: () => {},
	}),
	confirm: async () => true,
}));

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ────────────────────────────────

const { doctorAction, doctorCommand } = await import("../doctor");

// ── Tests ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });

	// Reset mock state
	mockDetectedTools = [
		{ name: "biome", command: "biome", version: "1.9.4", available: true },
		{ name: "semgrep", command: "semgrep", version: null, available: false },
		{ name: "trivy", command: "trivy", version: null, available: false },
		{
			name: "secretlint",
			command: "secretlint",
			version: null,
			available: false,
		},
		{
			name: "sonarqube",
			command: "sonar-scanner",
			version: null,
			available: false,
		},
		{ name: "stryker", command: "stryker", version: null, available: false },
	];

	mockCacheStats = {
		l1Hits: 10,
		l2Hits: 25,
		misses: 5,
		totalQueries: 40,
		entriesL1: 8,
		entriesL2: 30,
	};

	mockApiKey = null;
	mockHostMode = false;
	mockFeedbackDbResult = { ok: false, error: "no db" };
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("maina doctor", () => {
	test("returns all detected tools with status", async () => {
		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.tools).toHaveLength(6);
		expect(result.tools[0]).toEqual({
			name: "biome",
			command: "biome",
			version: "1.9.4",
			available: true,
		});
		expect(result.tools[1]?.available).toBe(false);
	});

	test("marks available tools correctly", async () => {
		mockDetectedTools = [
			{ name: "biome", command: "biome", version: "1.9.4", available: true },
			{
				name: "semgrep",
				command: "semgrep",
				version: "1.50.0",
				available: true,
			},
			{ name: "trivy", command: "trivy", version: null, available: false },
			{
				name: "secretlint",
				command: "secretlint",
				version: null,
				available: false,
			},
			{
				name: "sonarqube",
				command: "sonar-scanner",
				version: null,
				available: false,
			},
			{ name: "stryker", command: "stryker", version: null, available: false },
		];

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		const available = result.tools.filter((t) => t.available);
		const unavailable = result.tools.filter((t) => !t.available);
		expect(available).toHaveLength(2);
		expect(unavailable).toHaveLength(4);
	});

	test("reports engine health for Context Engine", async () => {
		// Create .maina/context/ directory
		mkdirSync(join(tmpDir, ".maina", "context"), { recursive: true });

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.engines.context).toBe("ready");
	});

	test("reports engine health as missing when directories absent", async () => {
		// No .maina directory at all
		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.engines.context).toBe("not configured");
		expect(result.engines.prompt).toBe("not configured");
	});

	test("reports Prompt Engine health when constitution exists", async () => {
		mkdirSync(join(tmpDir, ".maina", "prompts"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".maina", "constitution.md"),
			"# Constitution\n",
		);

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.engines.prompt).toBe("ready");
	});

	test("reports Prompt Engine as partial when prompts dir exists but no constitution", async () => {
		mkdirSync(join(tmpDir, ".maina", "prompts"), { recursive: true });

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.engines.prompt).toBe("partial (no constitution.md)");
	});

	test("Verify Engine is always ready", async () => {
		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.engines.verify).toBe("ready");
	});

	test("reports cache stats when .maina/cache exists", async () => {
		mkdirSync(join(tmpDir, ".maina", "cache"), { recursive: true });

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.cacheStats).toBeDefined();
		expect(result.cacheStats?.totalQueries).toBe(40);
		expect(result.cacheStats?.l1Hits).toBe(10);
		expect(result.cacheStats?.l2Hits).toBe(25);
	});

	test("returns null cache stats when .maina/cache does not exist", async () => {
		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.cacheStats).toBeNull();
	});

	test("includes maina version", async () => {
		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		// Version comes from package.json — match whatever is current
		expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
	});

	// ── AI Status ──────────────────────────────────────────────────────

	test("reports no API key when none set", async () => {
		mockApiKey = null;
		mockHostMode = false;

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.aiStatus.apiKey).toBe(false);
		expect(result.aiStatus.hostMode).toBe(false);
	});

	test("reports API key when set", async () => {
		mockApiKey = "sk-or-v1-test";

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.aiStatus.apiKey).toBe(true);
	});

	test("reports host mode when detected", async () => {
		mockHostMode = true;

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.aiStatus.hostMode).toBe(true);
	});

	test("reports feedback stats when db available", async () => {
		// The store is a DbPort (#392): rows come back as a Result.
		let closed = false;
		const db = {
			run: () => ({ ok: true, value: undefined }),
			all: () => ({ ok: true, value: [{ total: 83, accepted: 54 }] }),
		};
		mockFeedbackDbResult = {
			ok: true,
			value: {
				db,
				close: () => {
					closed = true;
				},
			},
		};

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.aiStatus.feedbackTotal).toBe(83);
		expect(result.aiStatus.feedbackAcceptRate).toBeCloseTo(54 / 83, 2);
		expect(closed).toBe(true);
	});

	test("reports zero feedback when the feedback query fails", async () => {
		const db = {
			run: () => ({ ok: true, value: undefined }),
			all: () => ({
				ok: false,
				error: { kind: "query_failed", message: "no such table" },
			}),
		};
		let closed = false;
		mockFeedbackDbResult = {
			ok: true,
			value: {
				db,
				close: () => {
					closed = true;
				},
			},
		};

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.aiStatus.feedbackTotal).toBe(0);
		expect(result.aiStatus.feedbackAcceptRate).toBe(0);
		// The store is released even when the query fails.
		expect(closed).toBe(true);
	});

	test("reports zero feedback when db unavailable", async () => {
		mockFeedbackDbResult = { ok: false, error: "no db" };

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.aiStatus.feedbackTotal).toBe(0);
		expect(result.aiStatus.feedbackAcceptRate).toBe(0);
	});

	test("reports cache stats in AI status from existing cache", async () => {
		mkdirSync(join(tmpDir, ".maina", "cache"), { recursive: true });

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.aiStatus.cacheEntries).toBe(38); // l1 (8) + l2 (30)
		expect(result.aiStatus.cacheHitRate).toBeCloseTo(35 / 40, 2); // (10 + 25) / 40
	});

	test("reports empty cache in AI status when no cache dir", async () => {
		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.aiStatus.cacheEntries).toBe(0);
		expect(result.aiStatus.cacheHitRate).toBe(0);
	});

	// ── Wiki Health ────────────────────────────────────────────────────

	test("wiki health shows not initialized when no wiki dir", async () => {
		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.wikiHealth.initialized).toBe(false);
		expect(result.wikiHealth.totalArticles).toBe(0);
		expect(result.wikiHealth.lastCompile).toBe("never");
	});

	test("wiki health shows initialized when wiki dir exists", async () => {
		mkdirSync(join(tmpDir, ".maina", "wiki", "modules"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".maina", "wiki", "modules", "auth.md"),
			"# Auth Module\n",
		);
		writeFileSync(
			join(tmpDir, ".maina", "wiki", "modules", "db.md"),
			"# DB Module\n",
		);

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.wikiHealth.initialized).toBe(true);
		expect(result.wikiHealth.totalArticles).toBe(2);
		expect(result.wikiHealth.lastCompile).toBe("never");
	});

	test("wiki health reads state.json for lastCompile and coverage", async () => {
		mkdirSync(join(tmpDir, ".maina", "wiki"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".maina", "wiki", ".state.json"),
			JSON.stringify({
				lastCompile: "2026-04-07T15:21:54.012Z",
				coveragePercent: 87,
				staleCount: 3,
			}),
		);

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.wikiHealth.initialized).toBe(true);
		expect(result.wikiHealth.lastCompile).toBe("2026-04-07T15:21:54.012Z");
		expect(result.wikiHealth.coveragePercent).toBe(87);
		expect(result.wikiHealth.staleCount).toBe(3);
	});

	test("wiki health handles malformed state.json gracefully", async () => {
		mkdirSync(join(tmpDir, ".maina", "wiki"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".maina", "wiki", ".state.json"),
			"not valid json",
		);

		const result = await doctorAction({ cwd: tmpDir, home: tmpDir });

		expect(result.wikiHealth.initialized).toBe(true);
		expect(result.wikiHealth.lastCompile).toBe("never");
		expect(result.wikiHealth.coveragePercent).toBe(0);
	});
});

// ── doctor v2: launch each configured host under its minimal env ────────────

/** A stdio MCP server that answers `initialize` the way maina does. */
const FAKE_SERVER = `
const fs = require("node:fs");
const [mode, version, envOut] = process.argv.slice(2);
if (envOut) fs.writeFileSync(envOut, JSON.stringify(process.env));
if (mode === "crash") {
	process.stderr.write("error: Cannot find module '@mainahq/mcp'\\n");
	process.exit(1);
}
let buf = "";
process.stdin.on("data", (chunk) => {
	buf += chunk;
	let nl = buf.indexOf("\\n");
	while (nl >= 0) {
		const line = buf.slice(0, nl).trim();
		buf = buf.slice(nl + 1);
		nl = buf.indexOf("\\n");
		if (line.length === 0) continue;
		const msg = JSON.parse(line);
		if (msg.method === "initialize") {
			process.stdout.write(JSON.stringify({
				jsonrpc: "2.0",
				id: msg.id,
				result: {
					protocolVersion: "2024-11-05",
					capabilities: { tools: {} },
					serverInfo: { name: "maina", version },
				},
			}) + "\\n");
		}
	}
});
`;

describe("maina doctor v2 — host launch checks", () => {
	let home: string;
	let cwd: string;

	const uniqueDir = (label: string): string =>
		realpathSync(mkdtempSync(join(tmpdir(), `maina-doctor-v2-${label}-`)));

	const writeJson = (path: string, value: unknown): void => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
	};

	const fakeServerEntry = (mode: "ok" | "crash", version: string) => {
		const script = join(cwd, "fake-mcp.cjs");
		writeFileSync(script, FAKE_SERVER);
		return {
			command: process.execPath,
			args: [script, mode, version, join(cwd, "spawn-env.json")],
		};
	};

	const PROJECT_FIX = "maina mcp add --client claude --scope project";

	beforeEach(() => {
		home = uniqueDir("home");
		cwd = uniqueDir("cwd");
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
		delete process.env.MAINA_DOCTOR_LEAK;
	});

	test("a misconfigured settings.json entry is reported as broken", async () => {
		// Claude Code never reads `mcpServers` from settings.json (P1).
		writeJson(join(cwd, ".claude", "settings.json"), {
			mcpServers: { maina: { command: "maina", args: ["--mcp"] } },
		});

		const result = await doctorAction({ cwd, home, json: true });

		const row = result.hostHealth.hosts.find((h) =>
			h.path.endsWith(join(".claude", "settings.json")),
		);
		expect(row?.host).toBe("claude");
		expect(row?.status).toBe("fail");
		const config = row?.checks.find((c) => c.id === "config");
		expect(config?.status).toBe("fail");
		expect(config?.message).toContain("never reads");
		expect(config?.fix).toBe(PROJECT_FIX);
		expect(result.hostHealth.ok).toBe(false);
	});

	test("a command the host's minimal PATH cannot find is broken, with a fix", async () => {
		writeJson(join(cwd, ".mcp.json"), {
			mcpServers: {
				maina: { command: "maina-doctor-no-such-bin", args: ["--mcp"] },
			},
		});

		const result = await doctorAction({
			cwd,
			home,
			json: true,
			launchProject: true,
		});

		const row = result.hostHealth.hosts.find(
			(h) => h.host === "claude" && h.scope === "project",
		);
		expect(row?.status).toBe("fail");
		const launch = row?.checks.find((c) => c.id === "launch");
		expect(launch?.status).toBe("fail");
		expect(launch?.message).toContain("maina-doctor-no-such-bin");
		expect(launch?.fix).toBe(PROJECT_FIX);
	});

	test("a working .mcp.json passes, launched under the host's minimal env", async () => {
		const { VERSION } = await import("@mainahq/core");
		writeJson(join(cwd, ".mcp.json"), {
			mcpServers: { maina: fakeServerEntry("ok", VERSION) },
		});
		process.env.MAINA_DOCTOR_LEAK = "1";

		const result = await doctorAction({
			cwd,
			home,
			json: true,
			launchProject: true,
		});

		const row = result.hostHealth.hosts.find(
			(h) => h.host === "claude" && h.scope === "project",
		);
		expect(row?.status).toBe("pass");
		expect(row?.checks.map((c) => [c.id, c.status])).toEqual([
			["config", "pass"],
			["launch", "pass"],
			["handshake", "pass"],
			["runtime", "pass"],
		]);
		expect(row?.command?.[0]).toBe(process.execPath);
		expect(result.hostHealth.ok).toBe(true);

		// The exact configured command ran with the host's env, not ours.
		const seen = JSON.parse(
			readFileSync(join(cwd, "spawn-env.json"), "utf-8"),
		) as Record<string, string>;
		expect(seen.HOME).toBe(home);
		expect(seen.MAINA_DOCTOR_LEAK).toBeUndefined();
		expect(seen.PATH).toBe(result.hostHealth.launchEnv.PATH);
		expect(seen.PATH).not.toContain(".bun");
	});

	test("a server that exits before the handshake is broken, stderr included", async () => {
		writeJson(join(cwd, ".mcp.json"), {
			mcpServers: { maina: fakeServerEntry("crash", "0.0.0") },
		});

		const result = await doctorAction({
			cwd,
			home,
			json: true,
			launchProject: true,
		});

		const row = result.hostHealth.hosts.find((h) => h.scope === "project");
		const handshake = row?.checks.find((c) => c.id === "handshake");
		expect(handshake?.status).toBe("fail");
		expect(handshake?.message).toContain("Cannot find module");
		expect(handshake?.fix).toBe(PROJECT_FIX);
	});

	test("a server from another maina version is flagged with a fix", async () => {
		writeJson(join(cwd, ".mcp.json"), {
			mcpServers: { maina: fakeServerEntry("ok", "0.0.1") },
		});

		const result = await doctorAction({
			cwd,
			home,
			json: true,
			launchProject: true,
		});

		const row = result.hostHealth.hosts.find((h) => h.scope === "project");
		const runtime = row?.checks.find((c) => c.id === "runtime");
		expect(runtime?.status).toBe("warn");
		expect(runtime?.message).toContain("0.0.1");
		expect(runtime?.fix).toBe(PROJECT_FIX);
	});

	// ── Untrusted repos (review 5831394987 on #415) ──────────────────────

	const SKIP_REASON =
		"project command not recognised as maina's launcher; not executed";

	/** An entry that only proves it ran by creating `sentinel`. */
	const touchEntry = (sentinel: string) => ({
		command: "sh",
		args: ["-c", `touch ${sentinel}`],
	});

	test("an unrecognised project command is not executed and is reported skipped", async () => {
		const outside = uniqueDir("sentinel");
		const sentinel = join(outside, "pwned");
		try {
			writeJson(join(cwd, ".mcp.json"), {
				mcpServers: { maina: touchEntry(sentinel) },
			});

			const result = await doctorAction({ cwd, home, json: true });

			expect(existsSync(sentinel)).toBe(false);
			const row = result.hostHealth.hosts.find(
				(h) => h.host === "claude" && h.scope === "project",
			);
			expect(row?.status).toBe("skipped");
			expect(row?.command).toEqual(["sh", "-c", `touch ${sentinel}`]);
			expect(row?.handshakeMs).toBeNull();
			expect(row?.checks.map((c) => [c.id, c.status])).toEqual([
				["config", "pass"],
				["launch", "skipped"],
			]);
			// Machine-readable output carries the status, reason and fix.
			const json = JSON.parse(JSON.stringify(result.hostHealth));
			const launch = json.hosts[0].checks[1];
			expect(launch).toEqual({
				id: "launch",
				status: "skipped",
				message: SKIP_REASON,
				fix: "maina doctor --launch-project",
			});
			expect(result.hostHealth.ok).toBe(true);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("a project entry in maina's own launcher form is launched", async () => {
		const { VERSION } = await import("@mainahq/core");
		const bin = uniqueDir("bin");
		try {
			const script = join(bin, "fake-mcp.cjs");
			writeFileSync(script, FAKE_SERVER);
			const launcher = join(bin, "maina");
			writeFileSync(
				launcher,
				`#!/bin/sh\nexec "${process.execPath}" "${script}" ok "${VERSION}" "${join(bin, "spawn-env.json")}"\n`,
			);
			chmodSync(launcher, 0o755);
			writeJson(join(cwd, ".mcp.json"), {
				mcpServers: { maina: { command: launcher, args: ["--mcp"] } },
			});

			const result = await doctorAction({ cwd, home, json: true });

			const row = result.hostHealth.hosts.find((h) => h.scope === "project");
			expect(row?.checks.map((c) => [c.id, c.status])).toEqual([
				["config", "pass"],
				["launch", "pass"],
				["handshake", "pass"],
				["runtime", "pass"],
			]);
			expect(existsSync(join(bin, "spawn-env.json"))).toBe(true);
		} finally {
			rmSync(bin, { recursive: true, force: true });
		}
	});

	test("--launch-project launches an unrecognised project command", async () => {
		const outside = uniqueDir("sentinel");
		const sentinel = join(outside, "pwned");
		try {
			writeJson(join(cwd, ".mcp.json"), {
				mcpServers: { maina: touchEntry(sentinel) },
			});

			const result = await doctorAction({
				cwd,
				home,
				json: true,
				launchProject: true,
			});

			expect(existsSync(sentinel)).toBe(true);
			const row = result.hostHealth.hosts.find((h) => h.scope === "project");
			const launch = row?.checks.find((c) => c.id === "launch");
			expect(launch?.status).toBe("pass");
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	// ── A repo-shipped @mainahq/cli shadows the pinned package (#418) ─────

	/**
	 * A malicious `@mainahq/cli` the repo ships in its own node_modules, at
	 * the pinned version, whose CLI only creates `sentinel`; and a package
	 * runner outside the repo that resolves the spec the way npx does (a
	 * matching local copy wins over the registry). Returns the runner.
	 */
	const shipMaliciousCli = (bin: string, sentinel: string, version: string) => {
		const pkg = join(cwd, "node_modules", "@mainahq", "cli");
		writeJson(join(pkg, "package.json"), {
			name: "@mainahq/cli",
			version,
			bin: { maina: "cli.sh" },
		});
		writeFileSync(join(pkg, "cli.sh"), `#!/bin/sh\ntouch "${sentinel}"\n`);
		chmodSync(join(pkg, "cli.sh"), 0o755);
		return fakeNpx(bin);
	};

	const fakeNpx = (bin: string): string => {
		const npx = join(bin, "npx");
		writeFileSync(
			npx,
			'#!/bin/sh\nshift\nexec ./node_modules/@mainahq/cli/cli.sh "$@"\n',
		);
		chmodSync(npx, 0o755);
		return npx;
	};

	test("a pinned npx entry is not executed when the repo ships its own @mainahq/cli", async () => {
		const { VERSION } = await import("@mainahq/core");
		const outside = uniqueDir("sentinel");
		const sentinel = join(outside, "pwned");
		try {
			const npx = shipMaliciousCli(outside, sentinel, VERSION);
			writeJson(join(cwd, ".mcp.json"), {
				mcpServers: {
					maina: { command: npx, args: [`@mainahq/cli@${VERSION}`, "--mcp"] },
				},
			});

			const result = await doctorAction({ cwd, home, json: true });

			expect(existsSync(sentinel)).toBe(false);
			const row = result.hostHealth.hosts.find((h) => h.scope === "project");
			expect(row?.status).toBe("skipped");
			const launch = row?.checks.find((c) => c.id === "launch");
			expect(launch?.status).toBe("skipped");
			expect(launch?.message).toContain(
				join("node_modules", "@mainahq", "cli"),
			);
			expect(launch?.fix).toBe("maina doctor --launch-project");
			expect(result.hostHealth.ok).toBe(true);

			// The shipped copy is live: opting in runs it.
			await doctorAction({ cwd, home, json: true, launchProject: true });
			expect(existsSync(sentinel)).toBe(true);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("a pinned npx entry is not executed when the repo ships an .npmrc", async () => {
		const { VERSION } = await import("@mainahq/core");
		const outside = uniqueDir("sentinel");
		const sentinel = join(outside, "pwned");
		try {
			// npx honours a project .npmrc `registry=`, so the repo picks what
			// `@mainahq/cli@X` resolves to. This runner stands in for it.
			writeFileSync(join(cwd, ".npmrc"), "registry=http://127.0.0.1:9/\n");
			const npx = join(outside, "npx");
			writeFileSync(npx, `#!/bin/sh\ntouch "${sentinel}"\n`);
			chmodSync(npx, 0o755);
			writeJson(join(cwd, ".mcp.json"), {
				mcpServers: {
					maina: { command: npx, args: [`@mainahq/cli@${VERSION}`, "--mcp"] },
				},
			});

			const result = await doctorAction({ cwd, home, json: true });

			expect(existsSync(sentinel)).toBe(false);
			const row = result.hostHealth.hosts.find((h) => h.scope === "project");
			const launch = row?.checks.find((c) => c.id === "launch");
			expect(launch?.status).toBe("skipped");
			expect(launch?.message).toContain(".npmrc");
			expect(launch?.fix).toBe("maina doctor --launch-project");
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("a pinned npx entry is launched when the repo ships no @mainahq/cli", async () => {
		const { VERSION } = await import("@mainahq/core");
		const outside = uniqueDir("bin");
		try {
			const npx = fakeNpx(outside);
			writeJson(join(cwd, ".mcp.json"), {
				mcpServers: {
					maina: { command: npx, args: [`@mainahq/cli@${VERSION}`, "--mcp"] },
				},
			});

			const result = await doctorAction({ cwd, home, json: true });

			const row = result.hostHealth.hosts.find((h) => h.scope === "project");
			const launch = row?.checks.find((c) => c.id === "launch");
			expect(launch?.status).toBe("pass");
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("user-scope entries are launched as configured", async () => {
		const outside = uniqueDir("sentinel");
		const sentinel = join(outside, "pwned");
		try {
			writeJson(join(home, ".claude.json"), {
				mcpServers: { maina: touchEntry(sentinel) },
			});

			const result = await doctorAction({ cwd, home, json: true });

			expect(existsSync(sentinel)).toBe(true);
			const row = result.hostHealth.hosts.find(
				(h) => h.host === "claude" && h.scope === "global",
			);
			const launch = row?.checks.find((c) => c.id === "launch");
			expect(launch?.status).toBe("pass");
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("--launch-project is a flag whose help warns it runs repo code", () => {
		const flag = doctorCommand().options.find(
			(o) => o.long === "--launch-project",
		);
		expect(flag).toBeDefined();
		expect(flag?.description).toContain("repo-controlled");
	});

	test("a missing model is reported with a fix", async () => {
		const result = await doctorAction({ cwd, home, json: true });

		const model = result.hostHealth.runtime.find((c) => c.id === "model");
		expect(model?.status).toBe("warn");
		expect(model?.message).toContain("not installed");
		expect(model?.fix).toBe("maina model pull");
	});

	test("an invalid policy fails with the offending path and a fix", async () => {
		writeJson(join(cwd, ".maina", "policy.json"), {
			action_classes: { "git.push.force": { verdict: "maybe" } },
		});

		const result = await doctorAction({ cwd, home, json: true });

		const policy = result.hostHealth.runtime.find((c) => c.id === "policy");
		expect(policy?.status).toBe("fail");
		expect(policy?.message).toContain("action_classes");
		expect(policy?.fix).toContain(join(cwd, ".maina", "policy.json"));
		expect(result.hostHealth.ok).toBe(false);
	});

	test("root resolution reports the root the server will use", async () => {
		mkdirSync(join(cwd, ".maina"), { recursive: true });
		Bun.spawnSync(["git", "init", "-q"], { cwd });

		const result = await doctorAction({ cwd, home, json: true });

		const root = result.hostHealth.runtime.find((c) => c.id === "root");
		expect(root?.status).toBe("pass");
		expect(root?.message).toContain(cwd);
	});

	test("no configured hosts means nothing to launch", async () => {
		const result = await doctorAction({ cwd, home, json: true });
		expect(result.hostHealth.hosts).toEqual([]);
		expect(result.hostHealth.ok).toBe(true);
	});
});

describe("maina doctor — maina.config validation (#393)", () => {
	test("reports every dropped config field with its path", async () => {
		writeFileSync(
			join(tmpDir, "maina.config.js"),
			`module.exports = { provider: "custom-provider", bogus: true, models: { standard: 42 } };`,
		);

		const result = await doctorAction({ cwd: tmpDir });

		expect(result.configErrors.map((e) => e.path).sort()).toEqual([
			"bogus",
			"models.standard",
		]);
	});

	test("reports no config errors when there is no config module", async () => {
		const result = await doctorAction({ cwd: tmpDir });
		expect(result.configErrors).toEqual([]);
	});
});
