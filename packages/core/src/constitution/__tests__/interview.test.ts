import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
	test("returns empty for missing file", () => {
		expect(loadRejectedRules(tmpDir)).toEqual([]);
	});

	test("saves and loads rules", () => {
		saveRejectedRules(tmpDir, ["Use tabs not spaces", "No console.log"]);
		const loaded = loadRejectedRules(tmpDir);
		expect(loaded).toContain("Use tabs not spaces");
		expect(loaded).toContain("No console.log");
	});

	test("appends without duplicates", () => {
		saveRejectedRules(tmpDir, ["Rule A"]);
		saveRejectedRules(tmpDir, ["Rule A", "Rule B"]);
		const loaded = loadRejectedRules(tmpDir);
		expect(loaded).toHaveLength(2);
	});

	test("file exists after save", () => {
		saveRejectedRules(tmpDir, ["test"]);
		expect(existsSync(join(tmpDir, "rejected.yml"))).toBe(true);
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
		const rules = buildRulesFromAnswers([
			{ questionId: "no-touch-files", answer: "migrations/**, *.lock" },
			{ questionId: "deploy-gotchas", answer: "Run migrations first" },
		]);

		expect(rules).toHaveLength(2);
		expect(rules[0]?.text).toContain("migrations/**");
		expect(rules[0]?.confidence).toBe(0.8);
		expect(rules[1]?.text).toContain("Run migrations first");
	});

	test("skips empty answers", () => {
		const rules = buildRulesFromAnswers([
			{ questionId: "no-touch-files", answer: "" },
			{ questionId: "deploy-gotchas", answer: "   " },
			{ questionId: "contributor-mistakes", answer: "Forget to install deps" },
		]);

		expect(rules).toHaveLength(1);
		expect(rules[0]?.text).toContain("Forget to install deps");
	});

	test("handles all question types", () => {
		const rules = buildRulesFromAnswers([
			{ questionId: "no-touch-files", answer: "*.env" },
			{ questionId: "deploy-gotchas", answer: "CDN cache" },
			{ questionId: "contributor-mistakes", answer: "Wrong branch" },
		]);

		expect(rules).toHaveLength(3);
		expect(rules[0]?.source).toContain("no-touch-files");
		expect(rules[1]?.source).toContain("deploy-gotchas");
		expect(rules[2]?.source).toContain("contributor-mistakes");
	});
});
