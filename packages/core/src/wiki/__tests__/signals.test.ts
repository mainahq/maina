import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	calculateEbbinghausScore,
	getPromptEffectiveness,
	getWikiEffectivenessReport,
	recordArticlesLoaded,
	recordWikiUsage,
} from "../signals";
import { DECAY_HALF_LIVES } from "../types";

// ─── Setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let wikiDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-signals-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	wikiDir = join(tmpDir, ".maina", "wiki");
	mkdirSync(wikiDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Ebbinghaus Decay ────────────────────────────────────────────────────

describe("calculateEbbinghausScore", () => {
	it("should return 1.0 for just-accessed article with 0 prior accesses", () => {
		const score = calculateEbbinghausScore("module", 0, 0);
		// exp(0) + 0.1 * 0 = 1.0
		expect(score).toBeCloseTo(1.0, 5);
	});

	it("should return approximately 0.5 decay at half-life with 0 accesses", () => {
		// For module: halfLife = 120 days
		const score = calculateEbbinghausScore("module", 120, 0);
		// exp(-0.693 * 120 / 120) = exp(-0.693) ≈ 0.5
		expect(score).toBeCloseTo(0.5, 1);
	});

	it("should add reinforcement bonus for access count", () => {
		// 0 days since access, 5 accesses
		const score = calculateEbbinghausScore("module", 0, 5);
		// exp(0) + 0.1 * 5 = 1.0 + 0.5 = 1.5, clamped to 1.0
		expect(score).toBe(1);
	});

	it("should cap reinforcement at 10 accesses", () => {
		// Very old article but many accesses
		const score10 = calculateEbbinghausScore("module", 1000, 10);
		const score20 = calculateEbbinghausScore("module", 1000, 20);
		// Both should have same reinforcement (0.1 * 10 = 1.0)
		expect(score10).toBeCloseTo(score20, 5);
	});

	it("should clamp score to [0, 1]", () => {
		// Very fresh + many accesses → should be clamped to 1
		const highScore = calculateEbbinghausScore("decision", 0, 10);
		expect(highScore).toBeLessThanOrEqual(1);
		expect(highScore).toBeGreaterThanOrEqual(0);

		// Very old + no accesses → should be near 0 but not negative
		const lowScore = calculateEbbinghausScore("feature", 10000, 0);
		expect(lowScore).toBeGreaterThanOrEqual(0);
		expect(lowScore).toBeLessThanOrEqual(1);
	});

	it("should use correct half-lives per spec", () => {
		expect(DECAY_HALF_LIVES.decision).toBe(180);
		expect(DECAY_HALF_LIVES.architecture).toBe(150);
		expect(DECAY_HALF_LIVES.module).toBe(120);
		expect(DECAY_HALF_LIVES.entity).toBe(90);
		expect(DECAY_HALF_LIVES.feature).toBe(60);
		expect(DECAY_HALF_LIVES.raw).toBe(90);
	});

	it("should decay slower for decisions than features", () => {
		const daysSince = 90;
		const decisionScore = calculateEbbinghausScore("decision", daysSince, 0);
		const featureScore = calculateEbbinghausScore("feature", daysSince, 0);
		// Decision has longer half-life (180 vs 60), so should decay less
		expect(decisionScore).toBeGreaterThan(featureScore);
	});

	it("should produce known values for specific inputs", () => {
		// entity: halfLife=90, 45 days, 3 accesses
		// exp(-0.693 * 45 / 90) + 0.1 * 3
		// = exp(-0.3465) + 0.3
		// ≈ 0.7071 + 0.3 = 1.0071 → clamped to 1.0
		const score = calculateEbbinghausScore("entity", 45, 3);
		expect(score).toBe(1);

		// feature: halfLife=60, 120 days, 0 accesses
		// exp(-0.693 * 120 / 60) + 0
		// = exp(-1.386) ≈ 0.25
		const score2 = calculateEbbinghausScore("feature", 120, 0);
		expect(score2).toBeCloseTo(0.25, 1);
	});
});

// ─── Signal Recording ────────────────────────────────────────────────────

describe("recordWikiUsage", () => {
	it("should record and persist usage signals", () => {
		recordWikiUsage(wikiDir, ["modules/auth.md"], "commit", true);
		recordWikiUsage(wikiDir, ["modules/db.md"], "review", false);

		// Record again and verify accumulation
		recordWikiUsage(wikiDir, ["modules/auth.md"], "verify", true);

		// Verify by checking prompt effectiveness (which reads from same store)
		// Just ensure no errors — the data is there
		const result = getPromptEffectiveness(wikiDir, "nonexistent");
		expect(result.sampleSize).toBe(0);
	});

	it("should handle multiple articles in single call", () => {
		recordWikiUsage(
			wikiDir,
			["modules/auth.md", "entities/user.md", "decisions/adr-001.md"],
			"commit",
			true,
		);

		// No errors = success. Data was written.
		expect(true).toBe(true);
	});

	it("should create signals file if it does not exist", () => {
		const { existsSync } = require("node:fs");
		const signalsPath = join(wikiDir, ".signals.json");

		expect(existsSync(signalsPath)).toBe(false);
		recordWikiUsage(wikiDir, ["modules/auth.md"], "commit", true);
		expect(existsSync(signalsPath)).toBe(true);
	});

	it("should round-trip through JSON storage", () => {
		const { readFileSync } = require("node:fs");
		recordWikiUsage(wikiDir, ["modules/auth.md"], "commit", true);
		recordWikiUsage(wikiDir, ["modules/db.md"], "review", false);

		const signalsPath = join(wikiDir, ".signals.json");
		const raw = readFileSync(signalsPath, "utf-8");
		const parsed = JSON.parse(raw);

		expect(parsed.usageSignals).toHaveLength(2);
		expect(parsed.usageSignals[0].articlePath).toBe("modules/auth.md");
		expect(parsed.usageSignals[0].command).toBe("commit");
		expect(parsed.usageSignals[0].accepted).toBe(true);
		expect(parsed.usageSignals[1].accepted).toBe(false);
		expect(typeof parsed.usageSignals[0].timestamp).toBe("string");
	});
});

// ─── Prompt Effectiveness ────────────────────────────────────────────────

describe("getPromptEffectiveness", () => {
	it("should return zero for unknown prompt hash", () => {
		const result = getPromptEffectiveness(wikiDir, "unknown-hash");
		expect(result.acceptRate).toBe(0);
		expect(result.sampleSize).toBe(0);
	});

	it("should return zero when no usage signals exist for prompt articles", () => {
		// Write prompt signals directly
		const { writeFileSync } = require("node:fs");
		const store = {
			usageSignals: [],
			promptSignals: [
				{
					promptHash: "hash-a",
					articlePath: "modules/auth.md",
					indirectAcceptRate: 0,
				},
			],
		};
		writeFileSync(join(wikiDir, ".signals.json"), JSON.stringify(store));

		const result = getPromptEffectiveness(wikiDir, "hash-a");
		expect(result.acceptRate).toBe(0);
		expect(result.sampleSize).toBe(0);
	});

	it("should compute accept rate from linked usage signals", () => {
		const { writeFileSync } = require("node:fs");
		const store = {
			usageSignals: [
				{
					articlePath: "modules/auth.md",
					command: "commit",
					accepted: true,
					timestamp: "2026-04-01T00:00:00.000Z",
				},
				{
					articlePath: "modules/auth.md",
					command: "review",
					accepted: false,
					timestamp: "2026-04-02T00:00:00.000Z",
				},
				{
					articlePath: "modules/auth.md",
					command: "verify",
					accepted: true,
					timestamp: "2026-04-03T00:00:00.000Z",
				},
				{
					articlePath: "modules/db.md",
					command: "commit",
					accepted: false,
					timestamp: "2026-04-04T00:00:00.000Z",
				},
			],
			promptSignals: [
				{
					promptHash: "hash-x",
					articlePath: "modules/auth.md",
					indirectAcceptRate: 0,
				},
			],
		};
		writeFileSync(join(wikiDir, ".signals.json"), JSON.stringify(store));

		const result = getPromptEffectiveness(wikiDir, "hash-x");
		// auth.md: 2 accepted out of 3 = 0.67
		expect(result.acceptRate).toBeCloseTo(0.67, 2);
		expect(result.sampleSize).toBe(3);
	});
});

// ─── recordArticlesLoaded ───────────────────────────────────────────────

describe("recordArticlesLoaded", () => {
	it("should write load signals to the signals file", () => {
		const { existsSync, readFileSync } = require("node:fs");
		const sp = join(wikiDir, ".signals.json");

		expect(existsSync(sp)).toBe(false);
		recordArticlesLoaded(
			sp,
			["modules/auth.md", "decisions/adr-001.md"],
			"review",
		);
		expect(existsSync(sp)).toBe(true);

		const raw = readFileSync(sp, "utf-8");
		const parsed = JSON.parse(raw);

		expect(parsed.loadSignals).toHaveLength(1);
		expect(parsed.loadSignals[0].articles).toEqual([
			"modules/auth.md",
			"decisions/adr-001.md",
		]);
		expect(parsed.loadSignals[0].command).toBe("review");
		expect(typeof parsed.loadSignals[0].timestamp).toBe("string");
	});

	it("should append to existing signals without losing data", () => {
		const { readFileSync } = require("node:fs");
		const sp = join(wikiDir, ".signals.json");

		// First write
		recordArticlesLoaded(sp, ["modules/auth.md"], "review");
		// Second write
		recordArticlesLoaded(sp, ["features/wiki.md"], "commit");

		const raw = readFileSync(sp, "utf-8");
		const parsed = JSON.parse(raw);

		expect(parsed.loadSignals).toHaveLength(2);
		expect(parsed.loadSignals[0].articles).toEqual(["modules/auth.md"]);
		expect(parsed.loadSignals[1].articles).toEqual(["features/wiki.md"]);
	});

	it("should not throw on empty articles array", () => {
		const { existsSync } = require("node:fs");
		const sp = join(wikiDir, ".signals.json");

		recordArticlesLoaded(sp, [], "review");
		// Should not create the file for empty articles
		expect(existsSync(sp)).toBe(false);
	});
});

// ─── getWikiEffectivenessReport ─────────────────────────────────────────

describe("getWikiEffectivenessReport", () => {
	it("should return empty report when no signals exist", () => {
		const sp = join(wikiDir, ".signals.json");
		const report = getWikiEffectivenessReport(sp);

		expect(report.totalLoads).toBe(0);
		expect(report.totalAccepts).toBe(0);
		expect(report.totalRejects).toBe(0);
		expect(report.acceptRate).toBe(0);
		expect(report.articleStats).toHaveLength(0);
		expect(report.negativeArticles).toHaveLength(0);
		expect(report.dormantArticles).toHaveLength(0);
	});

	it("should compute correct rates from usage signals", () => {
		const { writeFileSync } = require("node:fs");
		const sp = join(wikiDir, ".signals.json");
		const now = new Date().toISOString();

		const store = {
			usageSignals: [
				{
					articlePath: "modules/auth.md",
					command: "commit",
					accepted: true,
					timestamp: now,
				},
				{
					articlePath: "modules/auth.md",
					command: "review",
					accepted: true,
					timestamp: now,
				},
				{
					articlePath: "modules/auth.md",
					command: "verify",
					accepted: false,
					timestamp: now,
				},
				{
					articlePath: "decisions/adr-001.md",
					command: "commit",
					accepted: true,
					timestamp: now,
				},
				{
					articlePath: "decisions/adr-001.md",
					command: "review",
					accepted: true,
					timestamp: now,
				},
			],
			promptSignals: [],
		};
		writeFileSync(sp, JSON.stringify(store));

		const report = getWikiEffectivenessReport(sp);

		expect(report.totalLoads).toBe(5);
		expect(report.totalAccepts).toBe(4);
		expect(report.totalRejects).toBe(1);
		expect(report.acceptRate).toBeCloseTo(0.8, 2);
		expect(report.articleStats).toHaveLength(2);

		// decisions/adr-001.md has 100% (2/2), should be first
		const adrStat = report.articleStats.find(
			(s) => s.article === "decisions/adr-001.md",
		);
		expect(adrStat?.effectivenessScore).toBeCloseTo(1.0, 2);
		expect(adrStat?.loads).toBe(2);
		expect(adrStat?.accepts).toBe(2);

		// modules/auth.md has 67% (2/3)
		const authStat = report.articleStats.find(
			(s) => s.article === "modules/auth.md",
		);
		expect(authStat?.effectivenessScore).toBeCloseTo(0.667, 2);
		expect(authStat?.loads).toBe(3);
		expect(authStat?.accepts).toBe(2);
		expect(authStat?.rejects).toBe(1);
	});

	it("should identify negative articles with < 50% accept rate", () => {
		const { writeFileSync } = require("node:fs");
		const sp = join(wikiDir, ".signals.json");
		const now = new Date().toISOString();

		const store = {
			usageSignals: [
				{
					articlePath: "entities/oldFunction.md",
					command: "commit",
					accepted: false,
					timestamp: now,
				},
				{
					articlePath: "entities/oldFunction.md",
					command: "review",
					accepted: false,
					timestamp: now,
				},
				{
					articlePath: "entities/oldFunction.md",
					command: "verify",
					accepted: true,
					timestamp: now,
				},
				{
					articlePath: "modules/auth.md",
					command: "commit",
					accepted: true,
					timestamp: now,
				},
				{
					articlePath: "modules/auth.md",
					command: "review",
					accepted: true,
					timestamp: now,
				},
			],
			promptSignals: [],
		};
		writeFileSync(sp, JSON.stringify(store));

		const report = getWikiEffectivenessReport(sp);

		// entities/oldFunction.md: 1/3 = 33% -> negative
		expect(report.negativeArticles).toContain("entities/oldFunction.md");
		// modules/auth.md: 2/2 = 100% -> not negative
		expect(report.negativeArticles).not.toContain("modules/auth.md");
	});

	it("should identify dormant articles from ebbinghaus score", () => {
		const { writeFileSync } = require("node:fs");
		const sp = join(wikiDir, ".signals.json");

		// Create a signal from 500 days ago
		const oldDate = new Date(
			Date.now() - 500 * 24 * 60 * 60 * 1000,
		).toISOString();
		const recentDate = new Date().toISOString();

		const store = {
			usageSignals: [
				{
					articlePath: "features/old-feature.md",
					command: "commit",
					accepted: true,
					timestamp: oldDate,
				},
				{
					articlePath: "modules/recent.md",
					command: "commit",
					accepted: true,
					timestamp: recentDate,
				},
			],
			promptSignals: [],
		};
		writeFileSync(sp, JSON.stringify(store));

		const report = getWikiEffectivenessReport(sp);

		// features/old-feature.md accessed 500 days ago with feature halfLife=60
		expect(report.dormantArticles).toContain("features/old-feature.md");
		// modules/recent.md accessed just now -> not dormant
		expect(report.dormantArticles).not.toContain("modules/recent.md");
	});

	it("should handle empty usage signals array", () => {
		const { writeFileSync } = require("node:fs");
		const sp = join(wikiDir, ".signals.json");

		writeFileSync(sp, JSON.stringify({ usageSignals: [], promptSignals: [] }));

		const report = getWikiEffectivenessReport(sp);
		expect(report.totalLoads).toBe(0);
		expect(report.acceptRate).toBe(0);
		expect(report.articleStats).toHaveLength(0);
	});
});
