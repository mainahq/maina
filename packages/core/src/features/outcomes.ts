/**
 * Work outcomes and their receipts (FR-FAC-2, FR-FAC-3).
 *
 * Stopping is a valid outcome: "needs clarification" (`clarify`), "already
 * works as requested" (`already_satisfied`) and `unsupported` each end a run
 * with a receipt of their own, not a failure. A `completed` or
 * `already_satisfied` receipt is only issued when every acceptance
 * criterion is shown met with evidence. Large evidence rides along by
 * artifact ref; the receipt is hashed over its canonical JSON so an edit
 * shows. Pure.
 */

import { type ArtifactRef, hashArtifact } from "../artifacts/ref";
import type { Result } from "../db/index";
import { canonicalize } from "../receipt/canonical";
import {
	type AcceptanceCriterion,
	type CriterionEvidence,
	mapEvidence,
} from "./acceptance";

export const STOP_OUTCOMES = [
	"clarify",
	"already_satisfied",
	"unsupported",
] as const;
export type StopOutcome = (typeof STOP_OUTCOMES)[number];
export type OutcomeKind = "completed" | StopOutcome;

export type WorkOutcome =
	| Readonly<{ kind: "completed"; evidence: readonly CriterionEvidence[] }>
	| Readonly<{
			kind: "already_satisfied";
			evidence: readonly CriterionEvidence[];
	  }>
	| Readonly<{ kind: "clarify"; questions: readonly string[] }>
	| Readonly<{ kind: "unsupported"; reason: string }>;

export type WorkItemRef = Readonly<{ id: string; title: string }>;

export type HoldoutSummary = Readonly<{
	passed: boolean;
	satisfaction: number;
}>;

export type OutcomeReceiptInput = Readonly<{
	workItem: WorkItemRef;
	feature: string;
	criteria: readonly AcceptanceCriterion[];
	outcome: WorkOutcome;
	holdout?: HoldoutSummary;
	artifacts?: readonly ArtifactRef[];
	/** ISO 8601, from the caller's clock. */
	timestamp: string;
}>;

export type OutcomeReceipt = Readonly<{
	version: 1;
	workItem: WorkItemRef;
	feature: string;
	outcome: OutcomeKind;
	/** True for the stop outcomes. */
	stopped: boolean;
	criteria: readonly AcceptanceCriterion[];
	evidence: readonly CriterionEvidence[];
	questions: readonly string[];
	reason: string | null;
	holdout: HoldoutSummary | null;
	artifacts: readonly ArtifactRef[];
	timestamp: string;
	/** `sha256:` over the canonical JSON of every other field. */
	hash: string;
}>;

export type OutcomeReceiptError =
	| Readonly<{
			kind: "missing_evidence" | "unknown_criterion" | "unmet_criteria";
			criterionIds: readonly string[];
	  }>
	| Readonly<{ kind: "invalid_outcome"; message: string }>
	| Readonly<{ kind: "unhashable"; message: string }>
	| Readonly<{ kind: "hash_mismatch"; expected: string; actual: string }>;

type Unhashed = Omit<OutcomeReceipt, "hash">;

function hashOf(receipt: Unhashed): Result<string, OutcomeReceiptError> {
	const canonical = canonicalize(receipt);
	return canonical.ok
		? { ok: true, value: hashArtifact(canonical.data) }
		: { ok: false, error: { kind: "unhashable", message: canonical.message } };
}

/** Every criterion shown met with evidence. */
function provenMet(
	criteria: readonly AcceptanceCriterion[],
	evidence: readonly CriterionEvidence[],
): Result<readonly CriterionEvidence[], OutcomeReceiptError> {
	const mapped = mapEvidence(criteria, evidence);
	if (!mapped.ok) return mapped;
	const unmet = mapped.value
		.filter((e) => e.verdict !== "met")
		.map((e) => e.criterionId);
	return unmet.length > 0
		? { ok: false, error: { kind: "unmet_criteria", criterionIds: unmet } }
		: mapped;
}

type Body = Pick<Unhashed, "evidence" | "questions" | "reason">;

function bodyOf(
	criteria: readonly AcceptanceCriterion[],
	outcome: WorkOutcome,
): Result<Body, OutcomeReceiptError> {
	switch (outcome.kind) {
		case "completed":
		case "already_satisfied": {
			const evidence = provenMet(criteria, outcome.evidence);
			return evidence.ok
				? {
						ok: true,
						value: { evidence: evidence.value, questions: [], reason: null },
					}
				: evidence;
		}
		case "clarify": {
			const questions = outcome.questions.map((q) => q.trim()).filter(Boolean);
			return questions.length === 0
				? {
						ok: false,
						error: {
							kind: "invalid_outcome",
							message: "clarify needs at least one question",
						},
					}
				: { ok: true, value: { evidence: [], questions, reason: null } };
		}
		case "unsupported": {
			const reason = outcome.reason.trim();
			return reason === ""
				? {
						ok: false,
						error: {
							kind: "invalid_outcome",
							message: "unsupported needs a reason",
						},
					}
				: { ok: true, value: { evidence: [], questions: [], reason } };
		}
		default: {
			const never: never = outcome;
			return {
				ok: false,
				error: {
					kind: "invalid_outcome",
					message: `unknown outcome ${String(never)}`,
				},
			};
		}
	}
}

export function buildOutcomeReceipt(
	input: OutcomeReceiptInput,
): Result<OutcomeReceipt, OutcomeReceiptError> {
	const body = bodyOf(input.criteria, input.outcome);
	if (!body.ok) return body;
	const unhashed: Unhashed = {
		version: 1,
		workItem: { id: input.workItem.id, title: input.workItem.title },
		feature: input.feature,
		outcome: input.outcome.kind,
		stopped: input.outcome.kind !== "completed",
		criteria: input.criteria,
		...body.value,
		holdout: input.holdout ?? null,
		artifacts: input.artifacts ?? [],
		timestamp: input.timestamp,
	};
	const hash = hashOf(unhashed);
	return hash.ok
		? { ok: true, value: { ...unhashed, hash: hash.value } }
		: hash;
}

/** `receipt` when its hash still matches its content. */
export function verifyOutcomeReceipt(
	receipt: OutcomeReceipt,
): Result<OutcomeReceipt, OutcomeReceiptError> {
	const { hash, ...unhashed } = receipt;
	const actual = hashOf(unhashed);
	if (!actual.ok) return actual;
	return actual.value === hash
		? { ok: true, value: receipt }
		: {
				ok: false,
				error: { kind: "hash_mismatch", expected: hash, actual: actual.value },
			};
}
