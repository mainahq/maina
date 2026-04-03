import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { analyseFeedback, getPromptStats, recordOutcome } from "@maina/core";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-learn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("maina learn", () => {
	test("identifies tasks needing improvement after 30 rejections", () => {
		// Simulate 30 rejections for review
		for (let i = 0; i < 30; i++) {
			recordOutcome(tmpDir, "review-v1", {
				accepted: false,
				command: "review",
			});
		}
		// 5 accepts
		for (let i = 0; i < 5; i++) {
			recordOutcome(tmpDir, "review-v1", {
				accepted: true,
				command: "review",
			});
		}

		// Verify the records were written via prompt stats before analysing
		const stats = getPromptStats(tmpDir);
		const reviewStat = stats.find((s) => s.promptHash === "review-v1");
		expect(reviewStat).toBeDefined();
		expect(reviewStat?.totalUsage).toBe(35);

		const analysis = analyseFeedback(tmpDir, "review");
		expect(analysis.totalSamples).toBe(35);
		expect(analysis.needsImprovement).toBe(true);
		expect(analysis.acceptRate).toBeCloseTo(5 / 35, 5);
	});

	test("healthy task does not need improvement", () => {
		for (let i = 0; i < 30; i++) {
			recordOutcome(tmpDir, "commit-v1", {
				accepted: true,
				command: "commit",
			});
		}
		for (let i = 0; i < 3; i++) {
			recordOutcome(tmpDir, "commit-v1", {
				accepted: false,
				command: "commit",
			});
		}

		const analysis = analyseFeedback(tmpDir, "commit");
		expect(analysis.needsImprovement).toBe(false);
	});
});
