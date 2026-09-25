import { describe, expect, test } from "bun:test";
import { FEATURE_TEMPLATES } from "../../prompts/templates/index";
import {
	answerQuestion,
	type ClarifySuggestion,
	clarify,
	MAX_CLARIFY_MARKERS,
	MAX_CLARIFY_QUESTIONS,
	nextQuestion,
} from "../clarify";

const SPEC = `# Verification Specification: Login

## Requirements *(mandatory)*

- **FR-001**: System MUST authenticate via [NEEDS CLARIFICATION: SSO, email+password, or device code?]
- **FR-002**: System MUST retain sessions for [NEEDS CLARIFICATION: retention period in days]
- **FR-003**: System MUST lock accounts after [NEEDS CLARIFICATION: 3, 5, or 10 failed attempts?]
- **FR-004**: System MUST log [NEEDS CLARIFICATION: which events?]
- **FR-005**: System MUST email [NEEDS CLARIFICATION: whom?]
`;

function suggestion(n: number): ClarifySuggestion {
	return {
		question: `Suggested question ${n}?`,
		options: ["Alpha", "Beta", "Gamma"],
		recommended: "Gamma",
	};
}

describe("clarify caps", () => {
	test("asks about at most three markers and reports the rest as overflow", () => {
		const session = clarify(SPEC);
		const markerQuestions = session.questions.filter(
			(q) => q.marker !== undefined,
		);
		expect(MAX_CLARIFY_MARKERS).toBe(3);
		expect(markerQuestions).toHaveLength(3);
		expect(session.overflowMarkers).toEqual([
			"[NEEDS CLARIFICATION: which events?]",
			"[NEEDS CLARIFICATION: whom?]",
		]);
	});

	test("never builds more than five questions", () => {
		const many = Array.from({ length: 9 }, (_, i) => suggestion(i + 1));
		expect(MAX_CLARIFY_QUESTIONS).toBe(5);
		expect(clarify(SPEC, many).questions).toHaveLength(5);
		expect(clarify("# Spec\n", many).questions).toHaveLength(5);
	});

	test("fills the slots the markers leave with suggestions", () => {
		const session = clarify(SPEC, [
			suggestion(1),
			suggestion(2),
			suggestion(3),
		]);
		expect(session.questions.map((q) => q.marker === undefined)).toEqual([
			false,
			false,
			false,
			true,
			true,
		]);
	});
});

describe("clarify ordering", () => {
	test("marker questions come first, in document order", () => {
		const session = clarify(SPEC, [suggestion(1)]);
		expect(session.questions.map((q) => q.marker)).toEqual([
			"[NEEDS CLARIFICATION: SSO, email+password, or device code?]",
			"[NEEDS CLARIFICATION: retention period in days]",
			"[NEEDS CLARIFICATION: 3, 5, or 10 failed attempts?]",
			undefined,
		]);
		expect(session.questions.map((q) => q.id)).toEqual([
			"Q1",
			"Q2",
			"Q3",
			"Q4",
		]);
	});

	test("options are multiple choice with the recommendation first", () => {
		const session = clarify("# Spec\n", [suggestion(1)]);
		const [question] = session.questions;
		expect(question?.options).toEqual(["Gamma", "Alpha", "Beta"]);
		expect(question?.recommended).toBe("Gamma");
	});

	test("a recommendation outside the options is prepended", () => {
		const session = clarify("# Spec\n", [
			{ question: "Which?", options: ["A", "B"], recommended: "C" },
		]);
		expect(session.questions[0]?.options).toEqual(["C", "A", "B"]);
	});

	test("marker alternatives become options, the first listed recommended", () => {
		const [first, second, third] = clarify(SPEC).questions;
		expect(first?.options).toEqual(["SSO", "email+password", "device code"]);
		expect(first?.recommended).toBe("SSO");
		expect(first?.question).toContain("System MUST authenticate via");
		// A marker without alternatives takes a short answer.
		expect(second?.options).toEqual([]);
		expect(second?.recommended).toBeUndefined();
		expect(third?.options).toEqual(["3", "5", "10 failed attempts"]);
	});
});

describe("clarify asks one question at a time", () => {
	test("nextQuestion returns only the current question", () => {
		const session = clarify(SPEC);
		expect(nextQuestion(session)?.id).toBe("Q1");
	});

	test("answering any question but the current one is refused", () => {
		const session = clarify(SPEC);
		const result = answerQuestion(session, "Q2", "30");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("not_current");
	});

	test("an empty answer is refused", () => {
		const result = answerQuestion(clarify(SPEC), "Q1", "   ");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("empty_answer");
	});

	test("answering past the last question is refused", () => {
		let session = clarify("# Spec\n", [suggestion(1)]);
		const first = answerQuestion(session, "Q1", "Gamma");
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		session = first.value;
		expect(nextQuestion(session)).toBeUndefined();
		const again = answerQuestion(session, "Q1", "Alpha");
		expect(again.ok).toBe(false);
		if (!again.ok) expect(again.error.kind).toBe("done");
	});
});

describe("clarify writes answers back into the spec", () => {
	test("the marker is replaced and the answer logged under Clarifications", () => {
		const result = answerQuestion(clarify(SPEC), "Q1", "SSO");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { spec } = result.value;
		expect(spec).toContain("- **FR-001**: System MUST authenticate via SSO");
		expect(spec).not.toContain("SSO, email+password, or device code?]");
		expect(spec).toContain("## Clarifications");
		expect(spec).toMatch(/- Q: .*System MUST authenticate via.* → A: SSO/);
		expect(nextQuestion(result.value)?.id).toBe("Q2");
	});

	test("a suggestion answer is logged without touching other text", () => {
		const base = "# Spec\n\nBody text.\n";
		const result = answerQuestion(clarify(base, [suggestion(1)]), "Q1", "Beta");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.spec.startsWith(base)).toBe(true);
		expect(result.value.spec).toContain("- Q: Suggested question 1? → A: Beta");
	});

	test("answers keep one line and one Clarifications section", () => {
		let session = clarify(SPEC);
		for (const [id, answer] of [
			["Q1", "SSO"],
			["Q2", "30\ndays"],
			["Q3", "5"],
		] as const) {
			const result = answerQuestion(session, id, answer);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			session = result.value;
		}
		expect(session.spec.match(/## Clarifications/g)).toHaveLength(1);
		expect(session.spec).toContain("sessions for 30 days");
		expect(session.answered.map((a) => a.id)).toEqual(["Q1", "Q2", "Q3"]);
	});

	test("the shipped spec template stays within the marker cap", () => {
		expect(clarify(FEATURE_TEMPLATES.spec).overflowMarkers).toEqual([]);
	});
});
