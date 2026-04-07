import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getStatsDb } from "../../db/index";
import { getToolUsageStats, trackToolUsage } from "../tracker";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-tool-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe("tool_usage table", () => {
	test("getStatsDb creates tool_usage table", () => {
		const result = getStatsDb(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { db } = result.value;
		const tables = db
			.query(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='tool_usage'",
			)
			.all();
		expect(tables).toHaveLength(1);
	});
});

describe("trackToolUsage", () => {
	test("inserts a tool usage row", () => {
		trackToolUsage(tmpDir, {
			tool: "reviewCode",
			inputHash: "abc123",
			durationMs: 150,
			cacheHit: false,
		});
		const result = getStatsDb(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { db } = result.value;
		const rows = db.query("SELECT * FROM tool_usage").all() as Array<{
			tool: string;
			duration_ms: number;
			cache_hit: number;
		}>;
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row).toBeDefined();
		expect(row?.tool).toBe("reviewCode");
		expect(row?.duration_ms).toBe(150);
		expect(row?.cache_hit).toBe(0);
	});

	test("tracks cache hit", () => {
		trackToolUsage(tmpDir, {
			tool: "reviewCode",
			inputHash: "abc123",
			durationMs: 0,
			cacheHit: true,
		});
		const result = getStatsDb(tmpDir);
		if (!result.ok) return;
		const { db } = result.value;
		const rows = db.query("SELECT * FROM tool_usage WHERE cache_hit = 1").all();
		expect(rows).toHaveLength(1);
	});

	test("stores workflow_id when provided", () => {
		trackToolUsage(tmpDir, {
			tool: "verify",
			inputHash: "def456",
			durationMs: 200,
			cacheHit: false,
			workflowId: "wf-123",
		});
		const result = getStatsDb(tmpDir);
		if (!result.ok) return;
		const { db } = result.value;
		const row = db.query("SELECT workflow_id FROM tool_usage").get() as {
			workflow_id: string;
		} | null;
		expect(row?.workflow_id).toBe("wf-123");
	});
});

describe("getToolUsageStats", () => {
	test("returns stats across multiple tool calls", () => {
		trackToolUsage(tmpDir, {
			tool: "reviewCode",
			inputHash: "a",
			durationMs: 100,
			cacheHit: false,
		});
		trackToolUsage(tmpDir, {
			tool: "reviewCode",
			inputHash: "b",
			durationMs: 200,
			cacheHit: true,
		});
		trackToolUsage(tmpDir, {
			tool: "verify",
			inputHash: "c",
			durationMs: 50,
			cacheHit: false,
		});
		const stats = getToolUsageStats(tmpDir);
		expect(stats.totalCalls).toBe(3);
		expect(stats.cacheHits).toBe(1);
		expect(stats.cacheHitRate).toBeCloseTo(1 / 3, 2);
		expect(stats.byTool.reviewCode).toBeDefined();
		expect(stats.byTool.reviewCode?.calls).toBe(2);
		expect(stats.byTool.reviewCode?.cacheHits).toBe(1);
		expect(stats.byTool.verify).toBeDefined();
		expect(stats.byTool.verify?.calls).toBe(1);
	});

	test("returns empty stats when no data", () => {
		const stats = getToolUsageStats(tmpDir);
		expect(stats.totalCalls).toBe(0);
		expect(stats.cacheHitRate).toBe(0);
	});
});
