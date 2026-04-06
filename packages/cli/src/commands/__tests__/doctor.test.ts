import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

mock.module("@mainahq/core", () => ({
	detectTools: async () => mockDetectedTools,
	createCacheManager: () => ({
		stats: () => mockCacheStats,
		get: () => null,
		set: () => {},
		has: () => false,
		invalidate: () => {},
		clear: () => {},
	}),
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
}));

afterAll(() => {
	mock.restore();
});

// ── Import the module under test AFTER mocks ────────────────────────────────

const { doctorAction } = await import("../doctor");

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
		const result = await doctorAction({ cwd: tmpDir });

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

		const result = await doctorAction({ cwd: tmpDir });

		const available = result.tools.filter((t) => t.available);
		const unavailable = result.tools.filter((t) => !t.available);
		expect(available).toHaveLength(2);
		expect(unavailable).toHaveLength(4);
	});

	test("reports engine health for Context Engine", async () => {
		// Create .maina/context/ directory
		mkdirSync(join(tmpDir, ".maina", "context"), { recursive: true });

		const result = await doctorAction({ cwd: tmpDir });

		expect(result.engines.context).toBe("ready");
	});

	test("reports engine health as missing when directories absent", async () => {
		// No .maina directory at all
		const result = await doctorAction({ cwd: tmpDir });

		expect(result.engines.context).toBe("not configured");
		expect(result.engines.prompt).toBe("not configured");
	});

	test("reports Prompt Engine health when constitution exists", async () => {
		mkdirSync(join(tmpDir, ".maina", "prompts"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".maina", "constitution.md"),
			"# Constitution\n",
		);

		const result = await doctorAction({ cwd: tmpDir });

		expect(result.engines.prompt).toBe("ready");
	});

	test("reports Prompt Engine as partial when prompts dir exists but no constitution", async () => {
		mkdirSync(join(tmpDir, ".maina", "prompts"), { recursive: true });

		const result = await doctorAction({ cwd: tmpDir });

		expect(result.engines.prompt).toBe("partial (no constitution.md)");
	});

	test("Verify Engine is always ready", async () => {
		const result = await doctorAction({ cwd: tmpDir });

		expect(result.engines.verify).toBe("ready");
	});

	test("reports cache stats when .maina/cache exists", async () => {
		mkdirSync(join(tmpDir, ".maina", "cache"), { recursive: true });

		const result = await doctorAction({ cwd: tmpDir });

		expect(result.cacheStats).toBeDefined();
		expect(result.cacheStats?.totalQueries).toBe(40);
		expect(result.cacheStats?.l1Hits).toBe(10);
		expect(result.cacheStats?.l2Hits).toBe(25);
	});

	test("returns null cache stats when .maina/cache does not exist", async () => {
		const result = await doctorAction({ cwd: tmpDir });

		expect(result.cacheStats).toBeNull();
	});

	test("includes maina version", async () => {
		const result = await doctorAction({ cwd: tmpDir });

		expect(result.version).toBe("0.5.0");
	});
});
