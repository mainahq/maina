import { describe, expect, test } from "bun:test";
import type {
	BackendError as PublicBackendError,
	BoolQuestion as PublicBoolQuestion,
	ChoiceQuestion as PublicChoiceQuestion,
	DecisionBackend as PublicDecisionBackend,
	DecisionType as PublicDecisionType,
	QuestionKind as PublicQuestionKind,
	ScoreQuestion as PublicScoreQuestion,
} from "../../index";
import { DEFAULT_POLICY } from "../../policy/defaults";
import { DECISION_TYPES } from "../../policy/schema";
import type { Question } from "../types";
import { DECISION_CATALOG, validateQuestions } from "../types-catalog";

function errorOf(type: string, questions: readonly Question[]): string {
	const result = validateQuestions(type, questions);
	if (result.ok) return "ok";
	return result.error.kind;
}

describe("decision type catalog", () => {
	test("has exactly one entry per policy DECISION_TYPES entry", () => {
		expect(Object.keys(DECISION_CATALOG).sort()).toEqual(
			[...DECISION_TYPES].sort(),
		);
		for (const type of DECISION_TYPES) {
			expect(DECISION_CATALOG[type].type).toBe(type);
			expect(DECISION_CATALOG[type].kinds.length).toBeGreaterThan(0);
		}
	});

	test("the default policy routes every type to its catalog default backend", () => {
		for (const type of DECISION_TYPES) {
			expect(DEFAULT_POLICY.decisions[type].backend).toBe(
				DECISION_CATALOG[type].defaultBackend,
			);
		}
	});
});

describe("validateQuestions", () => {
	const tier: Question = {
		kind: "choice",
		id: "tier",
		options: ["mechanical", "standard", "architectural", "local"],
	};

	test("accepts well-formed choice, bool and score questions", () => {
		expect(errorOf("task.tier", [tier])).toBe("ok");
		expect(errorOf("slop", [{ kind: "bool", id: "a" }])).toBe("ok");
		expect(
			errorOf("spec.quality", [{ kind: "score", id: "q", min: 0, max: 100 }]),
		).toBe("ok");
	});

	test("rejects an unknown decision type", () => {
		expect(errorOf("gate.vibes", [{ kind: "bool", id: "a" }])).toBe(
			"unknown_type",
		);
	});

	test("rejects an empty question list", () => {
		expect(errorOf("slop", [])).toBe("invalid_question");
	});

	test("rejects empty and duplicate question ids", () => {
		expect(errorOf("slop", [{ kind: "bool", id: "" }])).toBe(
			"invalid_question",
		);
		expect(
			errorOf("slop", [
				{ kind: "bool", id: "a" },
				{ kind: "bool", id: "a" },
			]),
		).toBe("invalid_question");
	});

	test("rejects a question kind the type does not take", () => {
		expect(errorOf("task.tier", [{ kind: "bool", id: "tier" }])).toBe(
			"invalid_question",
		);
		expect(errorOf("slop", [{ kind: "score", id: "s", min: 0, max: 1 }])).toBe(
			"invalid_question",
		);
	});

	test("choice questions take between 2 and 255 distinct options", () => {
		expect(
			errorOf("review.category", [
				{ kind: "choice", id: "c", options: ["other"] },
			]),
		).toBe("invalid_question");
		expect(
			errorOf("review.category", [
				{ kind: "choice", id: "c", options: ["other", "other"] },
			]),
		).toBe("invalid_question");
		const many = Array.from({ length: 256 }, (_, i) => `o${i}`);
		expect(
			errorOf("context.select", [{ kind: "choice", id: "c", options: many }]),
		).toBe("invalid_question");
		expect(
			errorOf("context.select", [
				{ kind: "choice", id: "c", options: many.slice(0, 255) },
			]),
		).toBe("ok");
	});

	test("choice options must come from the catalog when the type fixes them", () => {
		expect(
			errorOf("task.tier", [
				{ kind: "choice", id: "tier", options: ["standard", "turbo"] },
			]),
		).toBe("invalid_question");
	});

	test("score questions need a finite min below max", () => {
		expect(
			errorOf("spec.quality", [{ kind: "score", id: "q", min: 1, max: 1 }]),
		).toBe("invalid_question");
		expect(
			errorOf("spec.quality", [
				{ kind: "score", id: "q", min: 0, max: Number.POSITIVE_INFINITY },
			]),
		).toBe("invalid_question");
	});

	test("names the offending question in the error", () => {
		const result = validateQuestions("task.tier", [
			tier,
			{ kind: "choice", id: "second", options: ["standard"] },
		]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatchObject({
			kind: "invalid_question",
			questionId: "second",
		});
	});
});

describe("public decide API", () => {
	test("the core barrel exports the question, type and backend contracts", async () => {
		const core = await import("../../index");
		expect(core.MAX_CHOICE_OPTIONS).toBe(255);
		// Type-only: these fail `bun run typecheck` if the barrel drops them.
		const kinds: readonly PublicQuestionKind[] = ["choice", "score", "bool"];
		const choice: PublicChoiceQuestion = {
			kind: "choice",
			id: "c",
			options: ["bot", "human"],
		};
		const score: PublicScoreQuestion = {
			kind: "score",
			id: "s",
			min: 0,
			max: 1,
		};
		const bool: PublicBoolQuestion = { kind: "bool", id: "b" };
		const type: PublicDecisionType = "review.reviewer_kind";
		const backend: PublicDecisionBackend = "heuristic";
		const error: PublicBackendError = {
			kind: "unsupported",
			questionId: undefined,
			message: "m",
		};
		expect(core.validateQuestions(type, [choice]).ok).toBe(true);
		expect(core.validateQuestions("slop", [bool]).ok).toBe(true);
		expect(core.validateQuestions("spec.quality", [score]).ok).toBe(true);
		expect([kinds.length, backend, error.kind]).toEqual([
			3,
			"heuristic",
			"unsupported",
		]);
	});
});
