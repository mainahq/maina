import { describe, expect, test } from "bun:test";
import type { DbPort } from "../../ports/index";
import { createMemoryDb } from "../../ports/testing";
import { GRAPH_SCHEMA_VERSION, migrateGraphStore } from "../graph-migrations";

function tables(db: DbPort): readonly string[] {
	const rows = db.all(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'graph_%' ORDER BY name",
	);
	return rows.ok ? rows.value.map((r) => String(r.name)) : [];
}

describe("migrateGraphStore", () => {
	test("creates the graph tables and records the schema version", () => {
		const db = createMemoryDb();
		expect(migrateGraphStore(db)).toEqual({ ok: true, value: undefined });
		expect(tables(db)).toEqual([
			"graph_blobs",
			"graph_deps",
			"graph_edges",
			"graph_files",
			"graph_meta",
			"graph_nodes",
		]);
		const version = db.all(
			"SELECT value FROM graph_meta WHERE key = 'schema_version'",
		);
		expect(version).toEqual({
			ok: true,
			value: [{ value: String(GRAPH_SCHEMA_VERSION) }],
		});
	});

	test("is idempotent", () => {
		const db = createMemoryDb();
		expect(migrateGraphStore(db).ok).toBe(true);
		expect(migrateGraphStore(db).ok).toBe(true);
		expect(tables(db)).toHaveLength(6);
	});

	test("rolls a failed step back and reports it", () => {
		const real = createMemoryDb();
		const failing: DbPort = {
			all: real.all,
			run: (sql, params) =>
				sql.includes("CREATE TABLE graph_edges")
					? { ok: false, error: { kind: "query_failed", message: "no space" } }
					: real.run(sql, params),
		};
		const result = migrateGraphStore(failing);
		expect(result).toEqual({
			ok: false,
			error: { kind: "query_failed", message: "no space" },
		});
		expect(tables(real)).toEqual(["graph_meta"]);
		expect(migrateGraphStore(real).ok).toBe(true);
		expect(tables(real)).toHaveLength(6);
	});
});
