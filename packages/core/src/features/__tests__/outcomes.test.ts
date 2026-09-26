import { describe, expect, test } from "bun:test";
import { hashArtifact } from "../../artifacts/ref";
import type { AcceptanceCriterion, CriterionEvidence } from "../acceptance";
import {
	buildOutcomeReceipt,
	type OutcomeReceiptInput,
	STOP_OUTCOMES,
	verifyOutcomeReceipt,
} from "../outcomes";

const criteria: readonly AcceptanceCriterion[] = [
	{ id: "AC-1", text: "Export writes a header row" },
	{ id: "AC-2", text: "Dates are ISO 8601" },
];

const met: readonly CriterionEvidence[] = [
	{
		criterionId: "AC-1",
		text: "Export writes a header row",
		verdict: "met",
		evidence: "csv.test.ts: header row",
	},
	{
		criterionId: "AC-2",
		text: "Dates are ISO 8601",
		verdict: "met",
		evidence: "dates.test.ts: iso",
	},
];

function input(outcome: OutcomeReceiptInput["outcome"]): OutcomeReceiptInput {
	return {
		workItem: { id: "#321", title: "Export CSV" },
		feature: "012-export",
		criteria,
		outcome,
		timestamp: "2026-09-26T00:00:00.000Z",
	};
}

describe("stop outcomes are first-class results (FR-FAC-3)", () => {
	test("the three stop outcomes", () => {
		expect(STOP_OUTCOMES).toEqual([
			"clarify",
			"already_satisfied",
			"unsupported",
		]);
	});

	test("clarify gets a receipt carrying its questions", () => {
		const receipt = buildOutcomeReceipt(
			input({ kind: "clarify", questions: ["CSV or TSV?"] }),
		);
		expect(receipt.ok).toBe(true);
		if (!receipt.ok) return;
		expect(receipt.value).toMatchObject({
			outcome: "clarify",
			stopped: true,
			questions: ["CSV or TSV?"],
		});
		expect(receipt.value.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	test("already_satisfied gets a receipt proving each criterion already holds", () => {
		const receipt = buildOutcomeReceipt(
			input({ kind: "already_satisfied", evidence: met }),
		);
		expect(receipt.ok && receipt.value).toMatchObject({
			outcome: "already_satisfied",
			stopped: true,
			evidence: met,
		});
	});

	test("unsupported gets a receipt carrying its reason", () => {
		const receipt = buildOutcomeReceipt(
			input({ kind: "unsupported", reason: "needs a payments provider" }),
		);
		expect(receipt.ok && receipt.value).toMatchObject({
			outcome: "unsupported",
			stopped: true,
			reason: "needs a payments provider",
		});
	});

	test("a stop without its substance is refused", () => {
		const noQuestions = buildOutcomeReceipt(
			input({ kind: "clarify", questions: [" "] }),
		);
		expect(noQuestions.ok ? undefined : noQuestions.error.kind).toBe(
			"invalid_outcome",
		);
		const noReason = buildOutcomeReceipt(
			input({ kind: "unsupported", reason: "" }),
		);
		expect(noReason.ok ? undefined : noReason.error.kind).toBe(
			"invalid_outcome",
		);
	});
});

describe("every acceptance criterion maps to evidence in the receipt (FR-FAC-2)", () => {
	test("a completed receipt lists evidence for each criterion", () => {
		const receipt = buildOutcomeReceipt(
			input({ kind: "completed", evidence: met }),
		);
		expect(receipt.ok).toBe(true);
		if (!receipt.ok) return;
		expect(receipt.value.stopped).toBe(false);
		expect(receipt.value.criteria).toEqual(criteria);
		for (const criterion of receipt.value.criteria) {
			const entry = receipt.value.evidence.find(
				(e) => e.criterionId === criterion.id,
			);
			expect(entry?.evidence.trim().length).toBeGreaterThan(0);
		}
	});

	test("a criterion without evidence blocks the receipt", () => {
		const firstOnly = met.slice(0, 1);
		for (const kind of ["completed", "already_satisfied"] as const) {
			const receipt = buildOutcomeReceipt(input({ kind, evidence: firstOnly }));
			expect(receipt).toEqual({
				ok: false,
				error: { kind: "missing_evidence", criterionIds: ["AC-2"] },
			});
		}
	});

	test("a criterion judged not met cannot be reported as completed", () => {
		const second = met[1] as CriterionEvidence;
		const receipt = buildOutcomeReceipt(
			input({
				kind: "completed",
				evidence: [
					met[0] as CriterionEvidence,
					{ ...second, verdict: "not_met" },
				],
			}),
		);
		expect(receipt).toEqual({
			ok: false,
			error: { kind: "unmet_criteria", criterionIds: ["AC-2"] },
		});
	});

	test("large evidence travels by artifact ref and holdout scores ride along", () => {
		const ref = { id: "verify-log", hash: hashArtifact("log") };
		const receipt = buildOutcomeReceipt({
			...input({ kind: "completed", evidence: met }),
			artifacts: [ref],
			holdout: { passed: true, satisfaction: 1 },
		});
		expect(receipt.ok && receipt.value).toMatchObject({
			artifacts: [ref],
			holdout: { passed: true, satisfaction: 1 },
		});
	});
});

describe("verifyOutcomeReceipt", () => {
	test("accepts an untouched receipt and rejects an edited one", () => {
		const built = buildOutcomeReceipt(
			input({ kind: "completed", evidence: met }),
		);
		if (!built.ok) throw new Error("build failed");
		expect(verifyOutcomeReceipt(built.value).ok).toBe(true);
		const edited = { ...built.value, outcome: "unsupported" as const };
		const checked = verifyOutcomeReceipt(edited);
		expect(checked.ok ? undefined : checked.error.kind).toBe("hash_mismatch");
	});
});
