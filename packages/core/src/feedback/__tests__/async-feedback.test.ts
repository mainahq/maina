import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { envFromRecord } from "../../ports/env";
import { getWorkflowId, recordFeedbackAsync } from "../collector";

// No auth dir: feedback tests never sync to the cloud.
const sync = {
	env: envFromRecord({}),
	authDir: join(import.meta.dir, "no-auth-292"),
};

describe("recordFeedbackAsync", () => {
	it("should not throw when called", () => {
		// Fire-and-forget — should never throw
		expect(() => {
			recordFeedbackAsync(
				".maina",
				{
					promptHash: "test-hash",
					task: "commit",
					accepted: true,
					timestamp: new Date().toISOString(),
					workflowStep: "commit",
					workflowId: "test-wf-id",
				},
				sync,
			);
		}).not.toThrow();
	});

	it("should not block execution", () => {
		const start = performance.now();
		recordFeedbackAsync(
			".maina",
			{
				promptHash: "test-hash",
				task: "verify",
				accepted: true,
				timestamp: new Date().toISOString(),
				workflowStep: "verify",
				workflowId: "test-wf-id",
			},
			sync,
		);
		const elapsed = performance.now() - start;
		// Should complete in <1ms (just queues a microtask)
		expect(elapsed).toBeLessThan(5);
	});
});

describe("getWorkflowId", () => {
	it("should return consistent ID for same branch", () => {
		const id1 = getWorkflowId("feature/015-test");
		const id2 = getWorkflowId("feature/015-test");
		expect(id1).toBe(id2);
	});

	it("should return different IDs for different branches", () => {
		const id1 = getWorkflowId("feature/015-test");
		const id2 = getWorkflowId("feature/016-other");
		expect(id1).not.toBe(id2);
	});

	it("should return a 12-char string", () => {
		const id = getWorkflowId("feature/test");
		expect(id).toHaveLength(12);
	});
});
