import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getFeedbackDb } from "../../db/index";
import { recordFeedback } from "../collector";
import { emitAcceptSignal, emitRejectSignal } from "../signals";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-signals-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

/** Insert a feedback row and set its workflow_id. */
function insertFeedback(
	tool: string,
	workflowId: string,
	accepted: boolean,
): void {
	recordFeedback(tmpDir, {
		promptHash: `${tool}-mcp`,
		task: tool,
		accepted,
		timestamp: new Date().toISOString(),
	});
	const dbResult = getFeedbackDb(tmpDir);
	if (!dbResult.ok) return;
	const { db } = dbResult.value;
	db.prepare(
		`UPDATE feedback SET workflow_id = ?
		 WHERE id = (SELECT id FROM feedback ORDER BY rowid DESC LIMIT 1)`,
	).run(workflowId);
}

describe("emitAcceptSignal", () => {
	test("marks recent review/verify entries as accepted", () => {
		insertFeedback("reviewCode", "wf-1", false);
		insertFeedback("verify", "wf-1", false);

		emitAcceptSignal(tmpDir, "wf-1");

		const dbResult = getFeedbackDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;
		const rows = db
			.query("SELECT command, accepted FROM feedback WHERE workflow_id = ?")
			.all("wf-1") as Array<{ command: string; accepted: number }>;
		for (const row of rows) {
			expect(row.accepted).toBe(1);
		}
	});

	test("does not affect entries from a different workflow", () => {
		insertFeedback("reviewCode", "wf-1", false);
		insertFeedback("reviewCode", "wf-2", false);

		emitAcceptSignal(tmpDir, "wf-1");

		const dbResult = getFeedbackDb(tmpDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;
		const wf2 = db
			.query("SELECT accepted FROM feedback WHERE workflow_id = ?")
			.get("wf-2") as { accepted: number } | null;
		expect(wf2?.accepted).toBe(0);
	});

	test("accepts custom tool list", () => {
		insertFeedback("reviewCode", "wf-1", false);
		insertFeedback("verify", "wf-1", false);

		emitAcceptSignal(tmpDir, "wf-1", ["reviewCode"]);

		const dbResult = getFeedbackDb(tmpDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;
		const review = db
			.query(
				"SELECT accepted FROM feedback WHERE command = ? AND workflow_id = ?",
			)
			.get("reviewCode", "wf-1") as { accepted: number } | null;
		expect(review?.accepted).toBe(1);
		const verify = db
			.query(
				"SELECT accepted FROM feedback WHERE command = ? AND workflow_id = ?",
			)
			.get("verify", "wf-1") as { accepted: number } | null;
		expect(verify?.accepted).toBe(0);
	});
});

describe("emitRejectSignal", () => {
	test("marks the most recent entry for a tool+workflow as rejected", () => {
		insertFeedback("reviewCode", "wf-1", true);
		emitRejectSignal(tmpDir, "reviewCode", "wf-1");

		const dbResult = getFeedbackDb(tmpDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;
		const row = db
			.query(
				"SELECT accepted FROM feedback WHERE command = ? AND workflow_id = ? ORDER BY created_at DESC LIMIT 1",
			)
			.get("reviewCode", "wf-1") as { accepted: number } | null;
		expect(row?.accepted).toBe(0);
	});

	test("only rejects the most recent entry, not older ones", () => {
		insertFeedback("reviewCode", "wf-1", true);
		insertFeedback("reviewCode", "wf-1", true);
		emitRejectSignal(tmpDir, "reviewCode", "wf-1");

		const dbResult = getFeedbackDb(tmpDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;
		const rows = db
			.query(
				"SELECT accepted FROM feedback WHERE command = ? AND workflow_id = ? ORDER BY created_at ASC",
			)
			.all("reviewCode", "wf-1") as Array<{ accepted: number }>;
		expect(rows).toHaveLength(2);
		expect(rows[0]?.accepted).toBe(1);
		expect(rows[1]?.accepted).toBe(0);
	});

	test("does not throw when no matching entries exist", () => {
		expect(() => {
			emitRejectSignal(tmpDir, "reviewCode", "nonexistent");
		}).not.toThrow();
	});
});
