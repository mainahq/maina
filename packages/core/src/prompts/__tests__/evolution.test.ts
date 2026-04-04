import { afterEach, beforeEach, describe, expect, it, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { recordOutcome } from "../engine";
import {
	abTest,
	analyseFeedback,
	analyseWorkflowFeedback,
	analyseWorkflowRuns,
	createCandidate,
	promote,
	retire,
} from "../evolution";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-evolution-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("analyseFeedback", () => {
	test("returns low accept rate for task with many rejections", () => {
		// Record 30 rejections and 5 accepts for "review"
		for (let i = 0; i < 30; i++) {
			recordOutcome(tmpDir, "review-hash", {
				accepted: false,
				command: "review",
			});
		}
		for (let i = 0; i < 5; i++) {
			recordOutcome(tmpDir, "review-hash", {
				accepted: true,
				command: "review",
			});
		}

		const analysis = analyseFeedback(tmpDir, "review");
		expect(analysis.totalSamples).toBe(35);
		expect(analysis.acceptRate).toBeCloseTo(5 / 35, 5);
		expect(analysis.needsImprovement).toBe(true);
	});

	test("returns high accept rate for well-performing task", () => {
		for (let i = 0; i < 20; i++) {
			recordOutcome(tmpDir, "commit-hash", {
				accepted: true,
				command: "commit",
			});
		}
		for (let i = 0; i < 2; i++) {
			recordOutcome(tmpDir, "commit-hash", {
				accepted: false,
				command: "commit",
			});
		}

		const analysis = analyseFeedback(tmpDir, "commit");
		expect(analysis.acceptRate).toBeCloseTo(20 / 22, 5);
		expect(analysis.needsImprovement).toBe(false);
	});

	test("returns empty analysis for task with no feedback", () => {
		const analysis = analyseFeedback(tmpDir, "explain");
		expect(analysis.totalSamples).toBe(0);
		expect(analysis.acceptRate).toBe(0);
		expect(analysis.needsImprovement).toBe(false);
	});
});

describe("createCandidate", () => {
	test("stores candidate prompt version", () => {
		const candidate = createCandidate(
			tmpDir,
			"review",
			"Improved review prompt content",
		);

		expect(candidate.task).toBe("review");
		expect(candidate.content).toBe("Improved review prompt content");
		expect(candidate.status).toBe("candidate");
		expect(candidate.hash).toBeTruthy();
	});
});

describe("abTest", () => {
	test("returns active prompt when no candidate exists", () => {
		const result = abTest(tmpDir, "commit");
		expect(result.variant).toBe("active");
	});

	test("returns candidate ~20% of time when candidate exists", () => {
		createCandidate(tmpDir, "review", "Candidate review prompt");

		let candidateCount = 0;
		const trials = 1000;
		for (let i = 0; i < trials; i++) {
			const result = abTest(tmpDir, "review");
			if (result.variant === "candidate") {
				candidateCount++;
			}
		}

		// Should be roughly 20% ± tolerance
		const ratio = candidateCount / trials;
		expect(ratio).toBeGreaterThan(0.1);
		expect(ratio).toBeLessThan(0.35);
	});
});

describe("promote", () => {
	test("promotes candidate to active", () => {
		const candidate = createCandidate(tmpDir, "review", "Better review prompt");
		const promoted = promote(tmpDir, candidate.hash);

		expect(promoted).toBe(true);

		// After promotion, abTest should always return active (no candidate left)
		const result = abTest(tmpDir, "review");
		expect(result.variant).toBe("active");
	});
});

describe("retire", () => {
	test("retires candidate without promoting", () => {
		const candidate = createCandidate(tmpDir, "review", "Bad review prompt");
		const retired = retire(tmpDir, candidate.hash);

		expect(retired).toBe(true);

		// No candidate should exist
		const result = abTest(tmpDir, "review");
		expect(result.variant).toBe("active");
	});
});

describe("analyseWorkflowFeedback", () => {
	it("should return an array", () => {
		const result = analyseWorkflowFeedback(tmpDir);
		expect(Array.isArray(result)).toBe(true);
	});

	it("should have step and acceptRate fields when data exists", () => {
		const result = analyseWorkflowFeedback(tmpDir);
		for (const entry of result) {
			expect(typeof entry.step).toBe("string");
			expect(typeof entry.totalSamples).toBe("number");
			expect(typeof entry.acceptRate).toBe("number");
			expect(typeof entry.needsImprovement).toBe("boolean");
		}
	});
});

describe("analyseWorkflowRuns", () => {
	it("should return an array", () => {
		const result = analyseWorkflowRuns(tmpDir);
		expect(Array.isArray(result)).toBe(true);
	});

	it("should respect limit parameter", () => {
		const result = analyseWorkflowRuns(tmpDir, 3);
		expect(result.length).toBeLessThanOrEqual(3);
	});

	it("should have correct fields when data exists", () => {
		const result = analyseWorkflowRuns(tmpDir);
		for (const entry of result) {
			expect(typeof entry.workflowId).toBe("string");
			expect(typeof entry.totalSteps).toBe("number");
			expect(typeof entry.passedSteps).toBe("number");
			expect(typeof entry.successRate).toBe("number");
			expect(typeof entry.createdAt).toBe("string");
		}
	});
});
