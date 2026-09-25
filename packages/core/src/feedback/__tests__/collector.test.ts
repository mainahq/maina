import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getContextDb, getFeedbackDb } from "../../db/index";
import { envFromRecord } from "../../ports/env";
import { recordOutcome } from "../../prompts/engine";
import {
	type FeedbackRecord,
	getFeedbackSummary,
	recordFeedback,
	recordFeedbackWithCompression,
} from "../collector";

// No auth dir: feedback tests never sync to the cloud.
const sync = {
	env: envFromRecord({}),
	authDir: join(import.meta.dir, "no-auth-292"),
};

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-collector-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("recordFeedback", () => {
	test("writes to feedback.db", () => {
		const record: FeedbackRecord = {
			promptHash: "test-hash-123",
			task: "commit",
			accepted: true,
			timestamp: new Date().toISOString(),
		};

		recordFeedback(tmpDir, record);

		// Verify directly in db
		const dbResult = getFeedbackDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db
			.query("SELECT * FROM feedback WHERE prompt_hash = ?")
			.all("test-hash-123") as Array<{
			prompt_hash: string;
			command: string;
			accepted: number;
			context: string | null;
		}>;

		expect(rows.length).toBe(1);
		expect(rows[0]?.prompt_hash).toBe("test-hash-123");
		expect(rows[0]?.command).toBe("commit");
		expect(rows[0]?.accepted).toBe(1);
	});

	test("records modification as context", () => {
		const record: FeedbackRecord = {
			promptHash: "mod-hash",
			task: "commit",
			accepted: true,
			modification: "user edited the message",
			timestamp: new Date().toISOString(),
		};

		recordFeedback(tmpDir, record);

		const dbResult = getFeedbackDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db
			.query("SELECT * FROM feedback WHERE prompt_hash = ?")
			.all("mod-hash") as Array<{ context: string | null }>;

		expect(rows[0]?.context).toBe("user edited the message");
	});
});

describe("getFeedbackSummary", () => {
	test("returns correct counts and rate", () => {
		// Record some feedback using recordOutcome directly (same underlying storage)
		recordOutcome(tmpDir, "hash-1", { accepted: true, command: "commit" });
		recordOutcome(tmpDir, "hash-2", { accepted: true, command: "commit" });
		recordOutcome(tmpDir, "hash-3", { accepted: false, command: "commit" });
		recordOutcome(tmpDir, "hash-4", { accepted: false, command: "commit" });
		recordOutcome(tmpDir, "hash-5", { accepted: true, command: "review" });

		const summary = getFeedbackSummary(tmpDir, "commit");

		expect(summary.total).toBe(4);
		expect(summary.accepted).toBe(2);
		expect(summary.rejected).toBe(2);
		expect(summary.acceptRate).toBeCloseTo(0.5, 5);
	});

	test("returns zeros when no data exists", () => {
		const summary = getFeedbackSummary(tmpDir, "commit");

		expect(summary.total).toBe(0);
		expect(summary.accepted).toBe(0);
		expect(summary.rejected).toBe(0);
		expect(summary.acceptRate).toBe(0);
	});
});

describe("recordFeedbackWithCompression", () => {
	test("accepted review with aiOutput triggers compression and episodic storage", () => {
		recordFeedbackWithCompression(
			tmpDir,
			{
				promptHash: "review-hash-1",
				task: "review",
				accepted: true,
				timestamp: new Date().toISOString(),
				aiOutput: "Overall: code looks good. Warning: missing null check.",
				diff: `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+import { bar } from './bar';`,
			},
			sync,
		);

		// Verify episodic entry was created in context DB
		const dbResult = getContextDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db
			.query(
				"SELECT * FROM episodic_entries WHERE type = 'review' ORDER BY created_at DESC",
			)
			.all() as Array<{
			content: string;
			summary: string;
			type: string;
		}>;

		expect(rows.length).toBe(1);
		expect(rows[0]?.type).toBe("review");
		expect(rows[0]?.summary).toBe("Accepted review");
		expect(rows[0]?.content).toContain("[review] Accepted review");
	});

	test("rejected review does NOT trigger compression", () => {
		recordFeedbackWithCompression(
			tmpDir,
			{
				promptHash: "review-hash-2",
				task: "review",
				accepted: false,
				timestamp: new Date().toISOString(),
				aiOutput: "Some review output",
				diff: "some diff",
			},
			sync,
		);

		// Verify no episodic entry was created
		const dbResult = getContextDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db
			.query("SELECT * FROM episodic_entries WHERE type = 'review'")
			.all();

		expect(rows.length).toBe(0);
	});

	test("accepted non-review task does NOT trigger compression", () => {
		recordFeedbackWithCompression(
			tmpDir,
			{
				promptHash: "commit-hash-1",
				task: "commit",
				accepted: true,
				timestamp: new Date().toISOString(),
				aiOutput: "Generated commit message",
				diff: "some diff",
			},
			sync,
		);

		// Verify no episodic entry was created
		const dbResult = getContextDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db
			.query("SELECT * FROM episodic_entries WHERE type = 'review'")
			.all();

		expect(rows.length).toBe(0);
	});

	test("missing aiOutput on accepted review does NOT trigger compression", () => {
		recordFeedbackWithCompression(
			tmpDir,
			{
				promptHash: "review-hash-3",
				task: "review",
				accepted: true,
				timestamp: new Date().toISOString(),
				// No aiOutput provided
				diff: "some diff",
			},
			sync,
		);

		// Verify no episodic entry was created
		const dbResult = getContextDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db
			.query("SELECT * FROM episodic_entries WHERE type = 'review'")
			.all();

		expect(rows.length).toBe(0);
	});
});
