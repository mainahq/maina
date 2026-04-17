import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConstitutionRule } from "../git-analyzer";
import {
	buildRulesFromAnswers,
	filterProposals,
	getInterviewQuestions,
	loadRejectedRules,
	saveRejectedRules,
} from "../interview";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`interview-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── getInterviewQuestions ────────────────────────────────────────────────

describe("getInterviewQuestions", () => {
	test("returns exactly 3 questions", () => {
		const questions = getInterviewQuestions();
		expect(questions).toHaveLength(3);
	});

	test("each question has id, question, hint, type", () => {
		for (const q of getInterviewQuestions()) {
			expect(q.id).toBeTruthy();
			expect(q.question).toBeTruthy();
			expect(q.hint).toBeTruthy();
			expect(["glob", "text"]).toContain(q.type);
		}
	});

	test("output is deterministic", () => {
		expect(getInterviewQuestions()).toEqual(getInterviewQuestions());
	});
});

// ── loadRejectedRules / saveRejectedRules ───────────────────────────────

describe("rejected rules persistence", () => {
	test("returns ok with empty array for missing file", () => {
		const result = loadRejectedRules(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	test("saves and loads rules", () => {
		const saveResult = saveRejectedRules(tmpDir, [
			"Use tabs not spaces",
			"No console.log",
		]);
		expect(saveResult.ok).toBe(true);

		const loadResult = loadRejectedRules(tmpDir);
		expect(loadResult.ok).toBe(true);
		if (loadResult.ok) {
			expect(loadResult.value).toContain("Use tabs not spaces");
			expect(loadResult.value).toContain("No console.log");
		}
	});

	test("appends without duplicates", () => {
		saveRejectedRules(tmpDir, ["Rule A"]);
		saveRejectedRules(tmpDir, ["Rule A", "Rule B"]);
		const result = loadRejectedRules(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toHaveLength(2);
	});

	test("file exists after save", () => {
		saveRejectedRules(tmpDir, ["test"]);
		expect(existsSync(join(tmpDir, "rejected.yml"))).toBe(true);
	});

	test("returns error for unwritable directory", () => {
		const result = saveRejectedRules("/nonexistent/path", ["test"]);
		expect(result.ok).toBe(false);
	});
});

// ── filterProposals ─────────────────────────────────────────────────────

describe("filterProposals", () => {
	test("removes rejected rules from proposals", () => {
		saveRejectedRules(tmpDir, ["Bad rule"]);

		const proposals: ConstitutionRule[] = [
			{ text: "Good rule", confidence: 0.8, source: "test" },
			{ text: "Bad rule", confidence: 0.6, source: "test" },
		];

		const filtered = filterProposals(proposals, tmpDir);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.text).toBe("Good rule");
	});

	test("returns all proposals when no rejections", () => {
		const proposals: ConstitutionRule[] = [
			{ text: "Rule 1", confidence: 0.7, source: "test" },
			{ text: "Rule 2", confidence: 0.5, source: "test" },
		];

		const filtered = filterProposals(proposals, tmpDir);
		expect(filtered).toHaveLength(2);
	});
});

// ── buildRulesFromAnswers ───────────────────────────────────────────────

describe("buildRulesFromAnswers", () => {
	test("converts answers to rules with confidence 0.8", () => {
		const result = buildRulesFromAnswers([
			{ questionId: "no-touch-files", answer: "migrations/**, *.lock" },
			{ questionId: "deploy-gotchas", answer: "Run migrations first" },
		]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(2);
			expect(result.value[0]?.text).toContain("migrations/**");
			expect(result.value[0]?.confidence).toBe(0.8);
			expect(result.value[1]?.text).toContain("Run migrations first");
		}
	});

	test("skips empty answers", () => {
		const result = buildRulesFromAnswers([
			{ questionId: "no-touch-files", answer: "" },
			{ questionId: "deploy-gotchas", answer: "   " },
			{ questionId: "contributor-mistakes", answer: "Forget to install deps" },
		]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0]?.text).toContain("Forget to install deps");
		}
	});

	test("handles all question types", () => {
		const result = buildRulesFromAnswers([
			{ questionId: "no-touch-files", answer: "*.env" },
			{ questionId: "deploy-gotchas", answer: "CDN cache" },
			{ questionId: "contributor-mistakes", answer: "Wrong branch" },
		]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(3);
			expect(result.value[0]?.source).toContain("no-touch-files");
			expect(result.value[1]?.source).toContain("deploy-gotchas");
			expect(result.value[2]?.source).toContain("contributor-mistakes");
		}
	});

	test("skips unknown question IDs gracefully", () => {
		const result = buildRulesFromAnswers([
			{ questionId: "unknown-question", answer: "some answer" },
			{ questionId: "no-touch-files", answer: "*.lock" },
		]);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(1);
			expect(result.value[0]?.text).toContain("*.lock");
		}
	});
});
