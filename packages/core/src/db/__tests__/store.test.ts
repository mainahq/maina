/**
 * Stores behind `DbPort` (#392). The package entry hands out SQLite stores
 * only as a `DbPort` plus `close`, never the raw connection or its drizzle
 * instance, so the published declarations name no driver type.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "../../index";
import { openDecisionStore, openFeedbackStore } from "../store";

const root = mkdtempSync(join(tmpdir(), "maina-db-store-"));

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("openFeedbackStore", () => {
	test("opens .maina/feedback.db with the feedback tables, as a DbPort", () => {
		const mainaDir = join(root, "feedback");
		const store = openFeedbackStore(mainaDir);
		expect(store.ok).toBe(true);
		if (!store.ok) return;
		expect(existsSync(join(mainaDir, "feedback.db"))).toBe(true);

		const { db } = store.value;
		const inserted = db.run(
			"INSERT INTO feedback (id, prompt_hash, command, accepted, created_at) VALUES (?, ?, ?, ?, ?)",
			["f1", "h", "review", 1, "2026-01-01T00:00:00Z"],
		);
		expect(inserted.ok).toBe(true);
		expect(db.all("SELECT id, accepted FROM feedback")).toEqual({
			ok: true,
			value: [{ id: "f1", accepted: 1 }],
		});
		store.value.close();
	});

	test("query failures come back as a DbError, not a throw", () => {
		const store = openFeedbackStore(join(root, "errors"));
		if (!store.ok) throw new Error(store.error);
		const result = store.value.db.all("SELECT * FROM no_such_table");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("query_failed");
		store.value.close();
	});

	test("close releases the connection", () => {
		const store = openFeedbackStore(join(root, "closed"));
		if (!store.ok) throw new Error(store.error);
		store.value.close();
		expect(store.value.db.all("SELECT 1").ok).toBe(false);
	});
});

describe("openDecisionStore", () => {
	test("opens .maina/decisions.db as a DbPort", () => {
		const mainaDir = join(root, "decisions");
		const store = openDecisionStore(mainaDir);
		expect(store.ok).toBe(true);
		if (!store.ok) return;
		expect(existsSync(join(mainaDir, "decisions.db"))).toBe(true);
		expect(store.value.db.run("CREATE TABLE t (x INTEGER)").ok).toBe(true);
		expect(store.value.db.run("INSERT INTO t (x) VALUES (?)", [7]).ok).toBe(
			true,
		);
		expect(store.value.db.all("SELECT x FROM t")).toEqual({
			ok: true,
			value: [{ x: 7 }],
		});
		store.value.close();
	});

	test("an unopenable path is an Err", () => {
		// A file where the store's directory should be.
		const blocker = join(root, "blocker");
		writeFileSync(blocker, "");
		const store = openDecisionStore(join(blocker, "nested"));
		expect(store.ok).toBe(false);
	});
});

describe("package entry", () => {
	test("exposes the store openers", () => {
		expect(typeof core.openFeedbackStore).toBe("function");
		expect(typeof core.openDecisionStore).toBe("function");
	});

	test("no longer exposes the raw connection getters", () => {
		const exported = Object.keys(core);
		expect(
			["getFeedbackDb", "getDecisionDb", "initDatabase"].filter((name) =>
				exported.includes(name),
			),
		).toEqual([]);
	});
});
