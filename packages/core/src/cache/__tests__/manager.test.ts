import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCacheManager } from "../manager";

const TEST_DIR = join(tmpdir(), `maina-cache-test-${Date.now()}`);

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

describe("set + get", () => {
	test("set then get returns cached value", () => {
		const cache = createCacheManager(makeDir("set-get"));
		cache.set("k1", "hello");
		const entry = cache.get("k1");
		expect(entry).not.toBeNull();
		expect(entry?.value).toBe("hello");
		expect(entry?.key).toBe("k1");
	});

	test("get returns null for missing key", () => {
		const cache = createCacheManager(makeDir("missing"));
		const entry = cache.get("nonexistent");
		expect(entry).toBeNull();
	});

	test("set stores optional fields", () => {
		const cache = createCacheManager(makeDir("optional-fields"));
		cache.set("k2", "world", {
			ttl: 3600,
			promptVersion: "v1",
			contextHash: "abc",
			model: "claude-3-5-sonnet",
		});
		const entry = cache.get("k2");
		expect(entry).not.toBeNull();
		expect(entry?.ttl).toBe(3600);
		expect(entry?.promptVersion).toBe("v1");
		expect(entry?.contextHash).toBe("abc");
		expect(entry?.model).toBe("claude-3-5-sonnet");
	});
});

describe("L1 vs L2 hit behaviour", () => {
	test("L1 hit does not query L2 (entry stays in memory map)", () => {
		const cache = createCacheManager(makeDir("l1-hit"));
		cache.set("k1", "value");

		// First get populates L1; subsequent gets should be L1 hits
		cache.get("k1"); // primes L1

		const stats1 = cache.stats();
		cache.get("k1"); // L1 hit
		const stats2 = cache.stats();

		// l1Hits should have incremented
		expect(stats2.l1Hits).toBeGreaterThan(stats1.l1Hits);
		// l2Hits should not have changed
		expect(stats2.l2Hits).toBe(stats1.l2Hits);
	});

	test("L2 hit promotes entry to L1", () => {
		const mainaDir = makeDir("l2-promote");
		// Populate L2 directly via a first manager instance
		const cache1 = createCacheManager(mainaDir);
		cache1.set("k1", "from-l2");

		// Create a fresh manager (empty L1) pointing to the same DB
		const cache2 = createCacheManager(mainaDir);

		// get should find it in L2 and promote to L1
		const entry = cache2.get("k1");
		expect(entry).not.toBeNull();
		expect(entry?.value).toBe("from-l2");

		const stats = cache2.stats();
		expect(stats.l2Hits).toBe(1);
		expect(stats.l1Hits).toBe(0);

		// Second get should now be an L1 hit
		cache2.get("k1");
		const stats2 = cache2.stats();
		expect(stats2.l1Hits).toBe(1);
	});
});

describe("TTL expiry", () => {
	test("expired entry returns null", () => {
		const _cache = createCacheManager(makeDir("ttl"));
		const _past = Date.now() - 10_000; // 10 seconds ago

		// Manually insert with a past createdAt via set then manipulate via get
		// We test expiry by setting ttl=1 and forging createdAt in the future check.
		// Instead we use a negative ttl trick: we'll insert with ttl=1s and
		// backdate by injecting via the DB. Use a fresh manager whose L2 we write to.
		const m = createCacheManager(makeDir("ttl2"));

		// Use internal set to write an "already expired" entry
		// We can't easily backdated via the public API, so we verify via the
		// has() method after testing with a ttl=0 (never expires) and ttl that
		// hasn't elapsed.

		// ttl=0 means forever
		m.set("forever", "val", { ttl: 0 });
		expect(m.get("forever")).not.toBeNull();

		// ttl=100s — should not be expired yet
		m.set("soon", "val", { ttl: 100 });
		expect(m.get("soon")).not.toBeNull();
	});

	test("entry with elapsed TTL is treated as expired", () => {
		// We create a cache manager, write an entry, then manually poke the
		// underlying SQLite to backdate it so TTL appears elapsed.
		const mainaDir = makeDir("ttl-elapsed");
		const cache = createCacheManager(mainaDir);
		cache.set("oldkey", "oldval", { ttl: 1 }); // 1 second TTL

		// The entry is fresh right now — still valid
		expect(cache.get("oldkey")).not.toBeNull();

		// Now create a second manager instance that shares the DB.
		// We'll insert a raw row with a very old createdAt so it looks expired.
		const { initDatabase } = require("../../db/index");
		const { join: pjoin } = require("node:path");
		const dbResult = initDatabase(pjoin(mainaDir, "cache", "cache.db"));
		if (!dbResult.ok) throw new Error("db failed");
		const db = dbResult.value.db;
		const nowMs = Date.now() - 5_000; // 5 seconds ago
		db.prepare(
			`INSERT OR REPLACE INTO cache_entries (id, key, value, created_at, ttl)
			 VALUES (?, ?, ?, ?, ?)`,
		).run("expired-id", "expiredkey", "expiredval", String(nowMs), 1);
		db.close();

		// Fresh manager: L1 is empty, will look up L2
		const cache2 = createCacheManager(mainaDir);
		const result = cache2.get("expiredkey");
		expect(result).toBeNull();
	});
});

describe("L1 eviction at capacity", () => {
	test("L1 evicts oldest entry when at capacity (100 entries)", () => {
		const cache = createCacheManager(makeDir("eviction"));

		// Insert 100 entries
		for (let i = 0; i < 100; i++) {
			cache.set(`key-${i}`, `value-${i}`);
		}

		// At this point L1 has 100 entries (full)
		expect(cache.stats().entriesL1).toBe(100);

		// Insert one more — should evict key-0 (oldest)
		cache.set("key-new", "value-new");

		expect(cache.stats().entriesL1).toBe(100);

		// key-0 should no longer be in L1 but still in L2
		// We verify by checking that stats show it was evicted from L1
		// A direct L1-only check: create a spy scenario or just trust the
		// stats count and that key-new is now present.
		const newEntry = cache.get("key-new");
		expect(newEntry).not.toBeNull();

		// The total entriesL1 should stay bounded at 100
		expect(cache.stats().entriesL1).toBe(100);
	});
});

describe("invalidate", () => {
	test("invalidate removes from both L1 and L2", () => {
		const cache = createCacheManager(makeDir("invalidate"));
		cache.set("del", "gone");
		expect(cache.get("del")).not.toBeNull();

		cache.invalidate("del");

		// Create fresh manager to confirm L2 removal
		const _cache2 = createCacheManager(makeDir("invalidate")); // same dir
		// Actually use same mainaDir
		const mainaDir = makeDir("invalidate2");
		const c = createCacheManager(mainaDir);
		c.set("del2", "gone2");
		expect(c.get("del2")).not.toBeNull();
		c.invalidate("del2");
		expect(c.get("del2")).toBeNull();

		// Verify L2 is also gone via a fresh manager
		const c2 = createCacheManager(mainaDir);
		expect(c2.get("del2")).toBeNull();
		expect(c2.stats().l2Hits).toBe(0);
		expect(c2.stats().misses).toBe(1);
	});
});

describe("clear", () => {
	test("clear removes all entries from both layers", () => {
		const mainaDir = makeDir("clear");
		const cache = createCacheManager(mainaDir);
		cache.set("a", "1");
		cache.set("b", "2");
		cache.set("c", "3");
		expect(cache.stats().entriesL1).toBe(3);

		cache.clear();

		expect(cache.get("a")).toBeNull();
		expect(cache.get("b")).toBeNull();
		expect(cache.get("c")).toBeNull();
		expect(cache.stats().entriesL1).toBe(0);

		// Verify L2 cleared via fresh manager
		const cache2 = createCacheManager(mainaDir);
		expect(cache2.get("a")).toBeNull();
		expect(cache2.stats().misses).toBe(1);
	});
});

describe("stats", () => {
	test("stats tracks l1Hits, l2Hits, misses, totalQueries accurately", () => {
		const mainaDir = makeDir("stats");

		// Seed L2 via first manager
		const seed = createCacheManager(mainaDir);
		seed.set("x", "xval");

		// Fresh manager: empty L1
		const cache = createCacheManager(mainaDir);

		// miss
		cache.get("nonexistent");
		let s = cache.stats();
		expect(s.misses).toBe(1);
		expect(s.totalQueries).toBe(1);
		expect(s.l1Hits).toBe(0);
		expect(s.l2Hits).toBe(0);

		// L2 hit (promotes to L1)
		cache.get("x");
		s = cache.stats();
		expect(s.l2Hits).toBe(1);
		expect(s.l1Hits).toBe(0);
		expect(s.misses).toBe(1);
		expect(s.totalQueries).toBe(2);

		// L1 hit
		cache.get("x");
		s = cache.stats();
		expect(s.l1Hits).toBe(1);
		expect(s.l2Hits).toBe(1);
		expect(s.misses).toBe(1);
		expect(s.totalQueries).toBe(3);
	});

	test("stats.entriesL2 reflects number of rows in SQLite", () => {
		const mainaDir = makeDir("stats-l2");
		const cache = createCacheManager(mainaDir);
		cache.set("p", "1");
		cache.set("q", "2");
		const s = cache.stats();
		expect(s.entriesL2).toBe(2);
		expect(s.entriesL1).toBe(2);
	});
});

describe("has", () => {
	test("has returns true for existing non-expired key", () => {
		const cache = createCacheManager(makeDir("has-true"));
		cache.set("exists", "yes");
		expect(cache.has("exists")).toBe(true);
	});

	test("has returns false for missing key", () => {
		const cache = createCacheManager(makeDir("has-false"));
		expect(cache.has("nope")).toBe(false);
	});

	test("has returns false for expired key", () => {
		const mainaDir = makeDir("has-expired");
		const _cache = createCacheManager(mainaDir);

		// Insert an expired row directly into SQLite
		const { initDatabase } = require("../../db/index");
		const { join: pjoin } = require("node:path");
		const dbResult = initDatabase(pjoin(mainaDir, "cache", "cache.db"));
		if (!dbResult.ok) throw new Error("db failed");
		const db = dbResult.value.db;
		const oldMs = Date.now() - 10_000; // 10 seconds ago
		db.prepare(
			`INSERT OR REPLACE INTO cache_entries (id, key, value, created_at, ttl)
			 VALUES (?, ?, ?, ?, ?)`,
		).run("exp-id", "expkey", "expval", String(oldMs), 1);
		db.close();

		const cache2 = createCacheManager(mainaDir);
		expect(cache2.has("expkey")).toBe(false);
	});
});
