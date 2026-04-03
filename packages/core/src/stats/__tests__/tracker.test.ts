import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CommitSnapshot,
	getLatest,
	getSkipRate,
	getStats,
	getTrends,
	recordSnapshot,
	type SnapshotInput,
} from "../tracker.ts";

const TEST_DIR = join(tmpdir(), `maina-stats-test-${Date.now()}`);

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeDir(sub: string): string {
	const d = join(TEST_DIR, sub);
	mkdirSync(d, { recursive: true });
	return d;
}

function makeSnapshot(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
	return {
		branch: "main",
		commitHash: "abc123",
		verifyDurationMs: 1500,
		totalDurationMs: 3000,
		contextTokens: 2000,
		contextBudget: 4000,
		cacheHits: 5,
		cacheMisses: 3,
		findingsTotal: 2,
		findingsErrors: 1,
		findingsWarnings: 1,
		toolsRun: 4,
		syntaxPassed: true,
		pipelinePassed: true,
		...overrides,
	};
}

describe("recordSnapshot", () => {
	test("inserts a row, returns ok", () => {
		const dir = makeDir("record-ok");
		const result = recordSnapshot(dir, makeSnapshot());
		expect(result.ok).toBe(true);
	});

	test("generates id and timestamp automatically", () => {
		const dir = makeDir("record-auto");
		const result = recordSnapshot(dir, makeSnapshot());
		expect(result.ok).toBe(true);

		const latest = getLatest(dir);
		expect(latest.ok).toBe(true);
		if (!latest.ok) return;
		expect(latest.value).not.toBeNull();
		const snap = latest.value as CommitSnapshot;
		expect(snap.id).toBeDefined();
		expect(snap.id.length).toBeGreaterThan(0);
		expect(snap.timestamp).toBeDefined();
		// UUID format: 8-4-4-4-12
		expect(snap.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		// ISO 8601 timestamp
		expect(Number.isNaN(Date.parse(snap.timestamp))).toBe(false);
	});

	test("computes contextUtilization from tokens/budget", () => {
		const dir = makeDir("record-util");
		recordSnapshot(
			dir,
			makeSnapshot({ contextTokens: 3000, contextBudget: 4000 }),
		);

		const latest = getLatest(dir);
		expect(latest.ok).toBe(true);
		if (!latest.ok) return;
		const snap = latest.value as CommitSnapshot;
		expect(snap.contextUtilization).toBeCloseTo(0.75, 4);
	});
});

describe("getLatest", () => {
	test("returns null when no snapshots exist", () => {
		const dir = makeDir("latest-empty");
		const result = getLatest(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toBeNull();
	});

	test("returns the most recent snapshot", () => {
		const dir = makeDir("latest-recent");
		recordSnapshot(dir, makeSnapshot({ commitHash: "first" }));
		recordSnapshot(dir, makeSnapshot({ commitHash: "second" }));
		recordSnapshot(dir, makeSnapshot({ commitHash: "third" }));

		const result = getLatest(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).not.toBeNull();
		const snap = result.value as CommitSnapshot;
		expect(snap.commitHash).toBe("third");
	});
});

describe("getStats", () => {
	test("returns correct averages over last N snapshots", () => {
		const dir = makeDir("stats-avg");
		// Insert 3 snapshots with known values
		recordSnapshot(
			dir,
			makeSnapshot({
				verifyDurationMs: 1000,
				contextTokens: 2000,
				cacheHits: 4,
				cacheMisses: 6,
				findingsTotal: 3,
			}),
		);
		recordSnapshot(
			dir,
			makeSnapshot({
				verifyDurationMs: 2000,
				contextTokens: 3000,
				cacheHits: 6,
				cacheMisses: 4,
				findingsTotal: 5,
			}),
		);
		recordSnapshot(
			dir,
			makeSnapshot({
				verifyDurationMs: 3000,
				contextTokens: 4000,
				cacheHits: 10,
				cacheMisses: 0,
				findingsTotal: 7,
			}),
		);

		const result = getStats(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const report = result.value;
		expect(report.averages.verifyDurationMs).toBeCloseTo(2000, 0);
		expect(report.averages.contextTokens).toBeCloseTo(3000, 0);
		// cache hit rate: (4+6+10) / (4+6+6+4+10+0) = 20/30 ≈ 0.6667
		expect(report.averages.cacheHitRate).toBeCloseTo(20 / 30, 2);
		expect(report.averages.findingsPerCommit).toBeCloseTo(5, 0);
	});

	test("with --last flag limits to N", () => {
		const dir = makeDir("stats-last");
		// Insert 5 snapshots
		for (let i = 1; i <= 5; i++) {
			recordSnapshot(
				dir,
				makeSnapshot({
					verifyDurationMs: i * 1000,
					contextTokens: i * 1000,
					findingsTotal: i,
				}),
			);
		}

		const result = getStats(dir, { last: 2 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const report = result.value;
		// Last 2: verifyDurationMs 4000, 5000 => avg 4500
		expect(report.averages.verifyDurationMs).toBeCloseTo(4500, 0);
		expect(report.totalCommits).toBe(5);
	});

	test("returns totalCommits count", () => {
		const dir = makeDir("stats-total");
		recordSnapshot(dir, makeSnapshot());
		recordSnapshot(dir, makeSnapshot());
		recordSnapshot(dir, makeSnapshot());

		const result = getStats(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.totalCommits).toBe(3);
	});
});

describe("getTrends", () => {
	test("returns 'stable' when not enough data (< 2*window)", () => {
		const dir = makeDir("trends-stable-nodata");
		// Insert only 3 snapshots with default window of 5 (needs 10)
		for (let i = 0; i < 3; i++) {
			recordSnapshot(dir, makeSnapshot());
		}

		const result = getTrends(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.verifyDuration).toBe("stable");
		expect(result.value.contextTokens).toBe("stable");
		expect(result.value.cacheHitRate).toBe("stable");
		expect(result.value.findingsPerCommit).toBe("stable");
	});

	test("returns 'down' for verify time when improving", () => {
		const dir = makeDir("trends-verify-down");
		const window = 3;
		// Older window: high verify times
		for (let i = 0; i < window; i++) {
			recordSnapshot(dir, makeSnapshot({ verifyDurationMs: 5000 }));
		}
		// Recent window: low verify times (improving)
		for (let i = 0; i < window; i++) {
			recordSnapshot(dir, makeSnapshot({ verifyDurationMs: 1000 }));
		}

		const result = getTrends(dir, { window });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.verifyDuration).toBe("down");
		expect(result.value.window).toBe(window);
	});

	test("returns 'up' for cache hit rate when improving", () => {
		const dir = makeDir("trends-cache-up");
		const window = 3;
		// Older window: low cache hit rate
		for (let i = 0; i < window; i++) {
			recordSnapshot(dir, makeSnapshot({ cacheHits: 1, cacheMisses: 9 }));
		}
		// Recent window: high cache hit rate (improving)
		for (let i = 0; i < window; i++) {
			recordSnapshot(dir, makeSnapshot({ cacheHits: 9, cacheMisses: 1 }));
		}

		const result = getTrends(dir, { window });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.cacheHitRate).toBe("up");
	});

	test("5% threshold — small changes are 'stable'", () => {
		const dir = makeDir("trends-threshold");
		const window = 3;
		// Older window
		for (let i = 0; i < window; i++) {
			recordSnapshot(dir, makeSnapshot({ verifyDurationMs: 1000 }));
		}
		// Recent window: only 2% change (below 5% threshold)
		for (let i = 0; i < window; i++) {
			recordSnapshot(dir, makeSnapshot({ verifyDurationMs: 980 }));
		}

		const result = getTrends(dir, { window });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.verifyDuration).toBe("stable");
	});
});

describe("skip tracking", () => {
	test("recordSnapshot with skipped=true stores correctly", () => {
		const dir = makeDir("skip-true");
		recordSnapshot(dir, makeSnapshot({ skipped: true }));

		const latest = getLatest(dir);
		expect(latest.ok).toBe(true);
		if (!latest.ok) return;
		const snap = latest.value as CommitSnapshot;
		expect(snap.skipped).toBe(true);
	});

	test("recordSnapshot without skipped defaults to false", () => {
		const dir = makeDir("skip-default");
		recordSnapshot(dir, makeSnapshot());

		const latest = getLatest(dir);
		expect(latest.ok).toBe(true);
		if (!latest.ok) return;
		const snap = latest.value as CommitSnapshot;
		expect(snap.skipped).toBe(false);
	});

	test("getSkipRate with 5 commits, 2 skipped returns rate 0.4", () => {
		const dir = makeDir("skip-rate-mixed");
		recordSnapshot(dir, makeSnapshot({ skipped: true }));
		recordSnapshot(dir, makeSnapshot({ skipped: false }));
		recordSnapshot(dir, makeSnapshot({ skipped: true }));
		recordSnapshot(dir, makeSnapshot({ skipped: false }));
		recordSnapshot(dir, makeSnapshot({ skipped: false }));

		const result = getSkipRate(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.total).toBe(5);
		expect(result.value.skipped).toBe(2);
		expect(result.value.rate).toBeCloseTo(0.4, 4);
	});

	test("getSkipRate with 0 commits returns rate 0", () => {
		const dir = makeDir("skip-rate-empty");
		const result = getSkipRate(dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.total).toBe(0);
		expect(result.value.skipped).toBe(0);
		expect(result.value.rate).toBe(0);
	});
});
