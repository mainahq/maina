import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createCacheManager } from "@maina/core";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		const { rmSync } = require("node:fs");
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("cache stats", () => {
	test("shows accurate counts after cached queries", () => {
		const manager = createCacheManager(tmpDir);

		// Seed some entries
		manager.set("key1", "value1");
		manager.set("key2", "value2");

		// Hit one
		manager.get("key1");

		// Miss one
		manager.get("nonexistent");

		const stats = manager.stats();
		expect(stats.l1Hits).toBe(1);
		expect(stats.misses).toBe(1);
		expect(stats.entriesL1).toBe(2);
		expect(stats.entriesL2).toBe(2);
		expect(stats.totalQueries).toBe(2);
	});
});
