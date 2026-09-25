/**
 * Store getters behind `DbPort` (#392).
 *
 * The published barrel hands out `.maina` SQLite stores as a `DbPort` plus
 * `close`, never the raw connection or the Drizzle instance, so the public
 * declarations carry no `bun:sqlite` or `drizzle-orm` types.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "../../index";
import { openDecisionStore, openFeedbackStore } from "../stores";

const root = mkdtempSync(join(tmpdir(), "maina-stores-"));

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("openFeedbackStore", () => {
	test("opens the feedback db with its tables as a DbPort", () => {
		const store = openFeedbackStore(join(root, "fb"));
		if (!store.ok) throw new Error(store.error);
		const inserted = store.value.db.run(
			"INSERT INTO feedback (id, prompt_hash, command, accepted, created_at) VALUES (?, ?, ?, ?, ?)",
			["f1", "h", "review", 1, "2026-01-01"],
		);
		expect(inserted.ok).toBe(true);
		const rows = store.value.db.all(
			"SELECT COUNT(*) AS total FROM feedback WHERE accepted = ?",
			[1],
		);
		expect(rows).toEqual({ ok: true, value: [{ total: 1 }] });
		store.value.close();
	});

	test("query failures come back as a Result", () => {
		const store = openFeedbackStore(join(root, "fb-err"));
		if (!store.ok) throw new Error(store.error);
		const rows = store.value.db.all("SELECT * FROM no_such_table");
		expect(rows.ok).toBe(false);
		store.value.close();
	});

	test("an unopenable path is an Err, not a throw", () => {
		const store = openFeedbackStore("/dev/null/not-a-dir");
		expect(store.ok).toBe(false);
	});
});

describe("openDecisionStore", () => {
	test("opens the decision db as a DbPort", () => {
		const store = openDecisionStore(join(root, "dec"));
		if (!store.ok) throw new Error(store.error);
		expect(store.value.db.run("CREATE TABLE t (x INTEGER)").ok).toBe(true);
		expect(store.value.db.run("INSERT INTO t VALUES (?)", [7]).ok).toBe(true);
		expect(store.value.db.all("SELECT x FROM t")).toEqual({
			ok: true,
			value: [{ x: 7 }],
		});
		store.value.close();
	});
});

describe("core barrel exposes stores only through DbPort", () => {
	const exported = Object.keys(core);

	test.each([
		"openDecisionStore",
		"openFeedbackStore",
	])("exports %s", (name) => {
		expect(exported).toContain(name);
	});

	test.each([
		"getDecisionDb",
		"getFeedbackDb",
		"getContextDb",
		"getCacheDb",
		"getStatsDb",
		"initDatabase",
		"toDbPort",
	])("does not export the raw-connection getter %s", (name) => {
		expect(exported).not.toContain(name);
	});
});
