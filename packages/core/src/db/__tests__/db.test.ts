import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getCacheDb,
	getContextDb,
	getFeedbackDb,
	initDatabase,
} from "../index.ts";

const TEST_DIR = join(tmpdir(), `maina-test-${Date.now()}`);

beforeAll(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("initDatabase", () => {
	test("creates a database file on first access", () => {
		const dbPath = join(TEST_DIR, "test.db");
		const result = initDatabase(dbPath);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { db } = result.value;
		expect(db).toBeDefined();
		db.close();
	});

	test("all expected tables exist after init (context db)", () => {
		const mainaDir = join(TEST_DIR, "tables-test");
		const result = getContextDb(mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { db } = result.value;

		const rows = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
			)
			.all() as Array<{ name: string }>;
		const tableNames = rows.map((r) => r.name);

		expect(tableNames).toContain("episodic_entries");
		expect(tableNames).toContain("semantic_entities");
		expect(tableNames).toContain("dependency_edges");
		db.close();
	});

	test("all expected tables exist after init (cache db)", () => {
		const mainaDir = join(TEST_DIR, "cache-tables-test");
		const result = getCacheDb(mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { db } = result.value;

		const rows = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
			)
			.all() as Array<{ name: string }>;
		const tableNames = rows.map((r) => r.name);

		expect(tableNames).toContain("cache_entries");
		db.close();
	});

	test("all expected tables exist after init (feedback db)", () => {
		const mainaDir = join(TEST_DIR, "feedback-tables-test");
		const result = getFeedbackDb(mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { db } = result.value;

		const rows = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
			)
			.all() as Array<{ name: string }>;
		const tableNames = rows.map((r) => r.name);

		expect(tableNames).toContain("feedback");
		expect(tableNames).toContain("prompt_versions");
		db.close();
	});
});

describe("episodic_entries CRUD", () => {
	test("can insert and query episodic_entries", async () => {
		const mainaDir = join(TEST_DIR, "episodic-crud");
		const result = getContextDb(mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { drizzle: orm, db } = result.value;

		const { episodicEntries } = await import("../schema.ts");

		const id = "test-entry-1";
		await orm.insert(episodicEntries).values({
			id,
			content: "User added auth module",
			summary: "Auth",
			relevance: 0.9,
			accessCount: 1,
			createdAt: new Date().toISOString(),
			lastAccessedAt: new Date().toISOString(),
			type: "observation",
		});

		const rows = await orm.select().from(episodicEntries);
		expect(rows.length).toBe(1);
		expect(rows[0]?.id).toBe(id);
		expect(rows[0]?.content).toBe("User added auth module");
		expect(rows[0]?.relevance).toBeCloseTo(0.9);
		db.close();
	});
});

describe("cache_entries CRUD", () => {
	test("can insert and query cache_entries", async () => {
		const mainaDir = join(TEST_DIR, "cache-crud");
		const result = getCacheDb(mainaDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { drizzle: orm, db } = result.value;

		const { cacheEntries } = await import("../schema.ts");

		const id = "cache-entry-1";
		await orm.insert(cacheEntries).values({
			id,
			key: "prompt-hash-abc123",
			value: '{"tokens": 500}',
			promptVersion: "v1.0",
			contextHash: "ctx-hash-xyz",
			model: "claude-3-5-sonnet",
			createdAt: new Date().toISOString(),
			ttl: 3600,
		});

		const rows = await orm.select().from(cacheEntries);
		expect(rows.length).toBe(1);
		expect(rows[0]?.id).toBe(id);
		expect(rows[0]?.key).toBe("prompt-hash-abc123");
		expect(rows[0]?.ttl).toBe(3600);
		db.close();
	});
});
