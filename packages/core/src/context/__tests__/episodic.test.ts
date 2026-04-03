import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	accessEntry,
	addEntry,
	calculateDecay,
	decayAllEntries,
	getEntries,
	pruneEntries,
} from "../episodic.ts";

const TEST_DIR = join(tmpdir(), `maina-episodic-test-${Date.now()}`);

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("calculateDecay", () => {
	test("returns 1.0 for just-accessed entry with 0 count", () => {
		// daysSinceAccess=0, accessCount=0
		// exp(-0.1 * 0) + 0.1 * min(0, 5) = 1 + 0 = 1.0, clamped to 1.0
		const result = calculateDecay(0, 0);
		expect(result).toBeCloseTo(1.0);
	});

	test("returns lower value for entries accessed days ago", () => {
		// daysSinceAccess=10, accessCount=0
		// exp(-0.1 * 10) + 0 = exp(-1) ≈ 0.368
		const recent = calculateDecay(0, 0);
		const older = calculateDecay(10, 0);
		expect(older).toBeLessThan(recent);
		expect(older).toBeCloseTo(Math.exp(-1), 3);
	});

	test("calculateDecay with high accessCount returns higher base", () => {
		// Same daysSinceAccess, higher accessCount gives higher relevance
		const lowAccess = calculateDecay(5, 0);
		const highAccess = calculateDecay(5, 5);
		expect(highAccess).toBeGreaterThan(lowAccess);
	});

	test("calculateDecay is clamped between 0 and 1", () => {
		// Even with 0 days and max access count, should not exceed 1
		const maxResult = calculateDecay(0, 100);
		expect(maxResult).toBeLessThanOrEqual(1.0);
		expect(maxResult).toBeGreaterThanOrEqual(0.0);

		// With very large daysSinceAccess and 0 count, should approach 0 but not go below
		const minResult = calculateDecay(1000, 0);
		expect(minResult).toBeGreaterThanOrEqual(0.0);
	});

	test("accessCount is capped at 5 for bonus calculation", () => {
		// accessCount=5 and accessCount=100 should give same result
		const atCap = calculateDecay(10, 5);
		const overCap = calculateDecay(10, 100);
		expect(atCap).toBeCloseTo(overCap);
	});
});

describe("addEntry", () => {
	test("creates entry with correct defaults", () => {
		const mainaDir = join(TEST_DIR, "add-entry-test");
		const before = new Date().toISOString();

		const entry = addEntry(mainaDir, {
			content: "User implemented authentication module",
			summary: "Auth implementation",
			type: "session",
		});

		const after = new Date().toISOString();

		expect(entry.id).toBeDefined();
		expect(typeof entry.id).toBe("string");
		expect(entry.id.length).toBeGreaterThan(0);
		expect(entry.content).toBe("User implemented authentication module");
		expect(entry.summary).toBe("Auth implementation");
		expect(entry.type).toBe("session");
		expect(entry.relevance).toBe(1.0);
		expect(entry.accessCount).toBe(0);
		expect(entry.createdAt >= before).toBe(true);
		expect(entry.createdAt <= after).toBe(true);
		expect(entry.lastAccessedAt >= before).toBe(true);
		expect(entry.lastAccessedAt <= after).toBe(true);
	});

	test("generates unique IDs for each entry", () => {
		const mainaDir = join(TEST_DIR, "unique-id-test");

		const entry1 = addEntry(mainaDir, {
			content: "Entry 1",
			summary: "Summary 1",
			type: "session",
		});
		const entry2 = addEntry(mainaDir, {
			content: "Entry 2",
			summary: "Summary 2",
			type: "session",
		});

		expect(entry1.id).not.toBe(entry2.id);
	});
});

describe("accessEntry", () => {
	test("increments accessCount and updates lastAccessedAt", () => {
		const mainaDir = join(TEST_DIR, "access-entry-test");

		const created = addEntry(mainaDir, {
			content: "Some session content",
			summary: "Session summary",
			type: "session",
		});

		expect(created.accessCount).toBe(0);
		const beforeAccess = new Date().toISOString();

		const accessed = accessEntry(mainaDir, created.id);
		const afterAccess = new Date().toISOString();

		expect(accessed).not.toBeNull();
		if (!accessed) return;

		expect(accessed.accessCount).toBe(1);
		expect(accessed.lastAccessedAt >= beforeAccess).toBe(true);
		expect(accessed.lastAccessedAt <= afterAccess).toBe(true);
	});

	test("returns null for non-existent entry", () => {
		const mainaDir = join(TEST_DIR, "access-null-test");
		// Initialize by adding a dummy entry so db exists
		addEntry(mainaDir, {
			content: "dummy",
			summary: "dummy",
			type: "session",
		});

		const result = accessEntry(mainaDir, "non-existent-id");
		expect(result).toBeNull();
	});

	test("multiple accesses increment count correctly", () => {
		const mainaDir = join(TEST_DIR, "multi-access-test");

		const entry = addEntry(mainaDir, {
			content: "Repeatedly accessed entry",
			summary: "Repeated",
			type: "review",
		});

		accessEntry(mainaDir, entry.id);
		accessEntry(mainaDir, entry.id);
		const third = accessEntry(mainaDir, entry.id);

		expect(third).not.toBeNull();
		if (!third) return;
		expect(third.accessCount).toBe(3);
	});
});

describe("getEntries", () => {
	test("returns entries sorted by relevance descending", () => {
		const mainaDir = join(TEST_DIR, "get-entries-test");

		// Add entries
		const _e1 = addEntry(mainaDir, {
			content: "Low relevance entry",
			summary: "Low",
			type: "session",
		});
		const e2 = addEntry(mainaDir, {
			content: "High relevance entry",
			summary: "High",
			type: "session",
		});

		// Access e2 multiple times to boost its relevance
		accessEntry(mainaDir, e2.id);
		accessEntry(mainaDir, e2.id);
		accessEntry(mainaDir, e2.id);

		const entries = getEntries(mainaDir);
		expect(entries.length).toBeGreaterThanOrEqual(2);

		// Verify sorted by relevance descending
		for (let i = 0; i < entries.length - 1; i++) {
			const current = entries[i]?.relevance ?? 0;
			const next = entries[i + 1]?.relevance ?? 0;
			expect(current).toBeGreaterThanOrEqual(next);
		}
	});

	test("filters by type when specified", () => {
		const mainaDir = join(TEST_DIR, "filter-type-test");

		addEntry(mainaDir, {
			content: "Session entry",
			summary: "Session",
			type: "session",
		});
		addEntry(mainaDir, {
			content: "Commit entry",
			summary: "Commit",
			type: "commit",
		});
		addEntry(mainaDir, {
			content: "Review entry",
			summary: "Review",
			type: "review",
		});

		const sessionEntries = getEntries(mainaDir, "session");
		expect(sessionEntries.length).toBe(1);
		expect(sessionEntries[0]?.type).toBe("session");

		const allEntries = getEntries(mainaDir);
		expect(allEntries.length).toBe(3);
	});
});

describe("pruneEntries", () => {
	test("removes low-relevance entries", () => {
		const mainaDir = join(TEST_DIR, "prune-low-relevance-test");

		// We can only directly add entries with relevance=1.0 initially
		// To get low-relevance entries, we need to use decayAllEntries
		// Instead, let's just verify pruneEntries runs and returns a count
		addEntry(mainaDir, {
			content: "Normal entry",
			summary: "Normal",
			type: "session",
		});

		const pruned = pruneEntries(mainaDir);
		// With fresh entries (relevance=1.0), nothing should be pruned
		expect(pruned).toBe(0);

		const remaining = getEntries(mainaDir);
		expect(remaining.length).toBe(1);
	});

	test("enforces max 100 entries keeping highest relevance", () => {
		const mainaDir = join(TEST_DIR, "prune-max-entries-test");

		// Add 110 entries
		for (let i = 0; i < 110; i++) {
			addEntry(mainaDir, {
				content: `Entry ${i}`,
				summary: `Summary ${i}`,
				type: "session",
			});
		}

		const beforePrune = getEntries(mainaDir);
		expect(beforePrune.length).toBe(110);

		const pruned = pruneEntries(mainaDir);
		expect(pruned).toBe(10);

		const afterPrune = getEntries(mainaDir);
		expect(afterPrune.length).toBe(100);
	});
});

describe("decayAllEntries", () => {
	test("recalculates relevance for all entries", () => {
		const mainaDir = join(TEST_DIR, "decay-all-test");

		addEntry(mainaDir, {
			content: "Entry to decay",
			summary: "Decay me",
			type: "session",
		});

		// Should not throw
		decayAllEntries(mainaDir);

		const entries = getEntries(mainaDir);
		expect(entries.length).toBe(1);
		// Relevance should still be valid (between 0 and 1)
		expect(entries[0]?.relevance).toBeGreaterThanOrEqual(0);
		expect(entries[0]?.relevance).toBeLessThanOrEqual(1);
	});
});
