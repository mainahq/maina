import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { recordOutcome } from "../engine";
import { createCandidate, resolveABTests } from "../evolution";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-resolve-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("resolveABTests", () => {
	test("returns empty array when no candidates exist", () => {
		const resolutions = resolveABTests(tmpDir);
		expect(resolutions).toEqual([]);
	});

	test("promotes candidate that outperforms incumbent by >5%", () => {
		// Create a candidate for "review"
		const candidate = createCandidate(tmpDir, "review", "Better review prompt");

		// Record 35 samples for the candidate hash: 30 accepted, 5 rejected (85.7% accept)
		for (let i = 0; i < 30; i++) {
			recordOutcome(tmpDir, candidate.hash, {
				accepted: true,
				command: "review",
			});
		}
		for (let i = 0; i < 5; i++) {
			recordOutcome(tmpDir, candidate.hash, {
				accepted: false,
				command: "review",
			});
		}

		// Record 35 samples for the incumbent hash: 20 accepted, 15 rejected (57.1% accept)
		for (let i = 0; i < 20; i++) {
			recordOutcome(tmpDir, "incumbent-hash", {
				accepted: true,
				command: "review",
			});
		}
		for (let i = 0; i < 15; i++) {
			recordOutcome(tmpDir, "incumbent-hash", {
				accepted: false,
				command: "review",
			});
		}

		const resolutions = resolveABTests(tmpDir);
		expect(resolutions.length).toBe(1);
		expect(resolutions[0]?.action).toBe("promoted");
		expect(resolutions[0]?.task).toBe("review");
		expect(resolutions[0]?.candidateAcceptRate).toBeGreaterThan(0.8);
	});

	test("retires candidate that underperforms incumbent by >5%", () => {
		const candidate = createCandidate(tmpDir, "commit", "Worse commit prompt");

		// Record 35 samples for the candidate: 10 accepted, 25 rejected (28.6% accept)
		for (let i = 0; i < 10; i++) {
			recordOutcome(tmpDir, candidate.hash, {
				accepted: true,
				command: "commit",
			});
		}
		for (let i = 0; i < 25; i++) {
			recordOutcome(tmpDir, candidate.hash, {
				accepted: false,
				command: "commit",
			});
		}

		// Record 35 samples for the incumbent: 25 accepted, 10 rejected (71.4% accept)
		for (let i = 0; i < 25; i++) {
			recordOutcome(tmpDir, "incumbent-commit", {
				accepted: true,
				command: "commit",
			});
		}
		for (let i = 0; i < 10; i++) {
			recordOutcome(tmpDir, "incumbent-commit", {
				accepted: false,
				command: "commit",
			});
		}

		const resolutions = resolveABTests(tmpDir);
		expect(resolutions.length).toBe(1);
		expect(resolutions[0]?.action).toBe("retired");
		expect(resolutions[0]?.task).toBe("commit");
		expect(resolutions[0]?.candidateAcceptRate).toBeLessThan(0.35);
	});

	test("continues testing with insufficient samples (<30)", () => {
		const candidate = createCandidate(tmpDir, "fix", "Trial fix prompt");

		// Only 10 samples for candidate
		for (let i = 0; i < 8; i++) {
			recordOutcome(tmpDir, candidate.hash, {
				accepted: true,
				command: "fix",
			});
		}
		for (let i = 0; i < 2; i++) {
			recordOutcome(tmpDir, candidate.hash, {
				accepted: false,
				command: "fix",
			});
		}

		const resolutions = resolveABTests(tmpDir);
		expect(resolutions.length).toBe(1);
		expect(resolutions[0]?.action).toBe("continuing");
		expect(resolutions[0]?.task).toBe("fix");
		expect(resolutions[0]?.reason).toContain("sample");
	});

	test("continues testing when difference is within 5% margin", () => {
		const candidate = createCandidate(tmpDir, "tests", "Similar tests prompt");

		// Record 35 samples for candidate: 25 accepted, 10 rejected (71.4%)
		for (let i = 0; i < 25; i++) {
			recordOutcome(tmpDir, candidate.hash, {
				accepted: true,
				command: "tests",
			});
		}
		for (let i = 0; i < 10; i++) {
			recordOutcome(tmpDir, candidate.hash, {
				accepted: false,
				command: "tests",
			});
		}

		// Record 35 samples for incumbent: 24 accepted, 11 rejected (68.6%)
		for (let i = 0; i < 24; i++) {
			recordOutcome(tmpDir, "incumbent-tests", {
				accepted: true,
				command: "tests",
			});
		}
		for (let i = 0; i < 11; i++) {
			recordOutcome(tmpDir, "incumbent-tests", {
				accepted: false,
				command: "tests",
			});
		}

		const resolutions = resolveABTests(tmpDir);
		expect(resolutions.length).toBe(1);
		expect(resolutions[0]?.action).toBe("continuing");
		expect(resolutions[0]?.reason).toContain("margin");
	});
});
