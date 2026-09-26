/**
 * Acceptance criteria are the contract (FR-FAC-2). They are written before
 * implementation in the feature folder's `spec.md` (its "Acceptance
 * Criteria" section), judged verbatim one by one, and every one of them
 * must map to evidence before a receipt can say the work is done.
 */

import { join } from "node:path";
import type { Result } from "../db/index";
import type { FsPort } from "../ports/fs";
import { extractAcceptanceCriteria } from "../utils";

export type AcceptanceCriterion = Readonly<{
	/** `AC-<n>`: the one the spec gives, else the criterion's position. */
	id: string;
	/** The criterion exactly as the spec words it. */
	text: string;
}>;

export type CriterionVerdictKind = "met" | "not_met" | "unclear";

/** A judge's call on one criterion, with what it rests on. */
export type CriterionVerdict = Readonly<{
	criterionId: string;
	verdict: CriterionVerdictKind;
	evidence: string;
}>;

/** A criterion joined to its verdict, as a receipt records it. */
export type CriterionEvidence = Readonly<{
	criterionId: string;
	text: string;
	verdict: CriterionVerdictKind;
	evidence: string;
}>;

export type AcceptanceError =
	| Readonly<{ kind: "invalid_feature"; feature: string }>
	| Readonly<{ kind: "not_found"; path: string }>
	| Readonly<{ kind: "no_criteria"; path: string }>
	| Readonly<{ kind: "io"; path: string; message: string }>;

export type EvidenceError = Readonly<{
	kind: "missing_evidence" | "unknown_criterion" | "duplicate_criterion";
	criterionIds: readonly string[];
}>;

/** A feature folder name: no separators, no leading dot. */
export function isFeatureName(feature: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(feature);
}

const EXPLICIT_ID = /^(AC-\d+)\s*[:.)]\s*/i;

/**
 * The spec's acceptance criteria with stable ids. A criterion that starts
 * with `AC-<n>:` keeps that id; the rest get `AC-<position>`, or the next
 * free number when that one is taken.
 */
export function parseAcceptanceCriteria(
	spec: string,
): readonly AcceptanceCriterion[] {
	const lines = extractAcceptanceCriteria(spec).map((line) => {
		const match = EXPLICIT_ID.exec(line);
		return match?.[1]
			? { explicit: match[1].toUpperCase(), text: line.slice(match[0].length) }
			: { explicit: undefined, text: line };
	});
	const taken = new Set<string>();
	const explicitIds = new Set(lines.flatMap((l) => l.explicit ?? []));
	return lines.map((line, index) => {
		let id = line.explicit;
		if (id === undefined || taken.has(id)) {
			let n = index + 1;
			while (taken.has(`AC-${n}`) || explicitIds.has(`AC-${n}`)) n++;
			id = `AC-${n}`;
		}
		taken.add(id);
		return { id, text: line.text };
	});
}

/** The criteria in `<root>/.maina/features/<feature>/spec.md`. */
export async function loadAcceptanceCriteria(
	fs: FsPort,
	root: string,
	feature: string,
): Promise<Result<readonly AcceptanceCriterion[], AcceptanceError>> {
	if (!isFeatureName(feature)) {
		return { ok: false, error: { kind: "invalid_feature", feature } };
	}
	const path = join(root, ".maina", "features", feature, "spec.md");
	const read = await fs.readFile(path);
	if (!read.ok) {
		return read.error.kind === "not_found"
			? { ok: false, error: { kind: "not_found", path } }
			: { ok: false, error: { kind: "io", path, message: read.error.message } };
	}
	const criteria = parseAcceptanceCriteria(read.value);
	return criteria.length === 0
		? { ok: false, error: { kind: "no_criteria", path } }
		: { ok: true, value: criteria };
}

/**
 * Joins `verdicts` to `criteria`, in criteria order. Every criterion needs a
 * verdict with non-blank evidence, no verdict may name a criterion the
 * contract does not have, and no criterion may have two verdicts (a later
 * `met` must not quietly override a `not_met`).
 */
export function mapEvidence(
	criteria: readonly AcceptanceCriterion[],
	verdicts: readonly CriterionVerdict[],
): Result<readonly CriterionEvidence[], EvidenceError> {
	const ids = new Set(criteria.map((c) => c.id));
	const unknown = verdicts
		.map((v) => v.criterionId)
		.filter((id) => !ids.has(id));
	if (unknown.length > 0) {
		return {
			ok: false,
			error: { kind: "unknown_criterion", criterionIds: [...new Set(unknown)] },
		};
	}
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const v of verdicts) {
		if (seen.has(v.criterionId)) duplicates.add(v.criterionId);
		seen.add(v.criterionId);
	}
	if (duplicates.size > 0) {
		return {
			ok: false,
			error: { kind: "duplicate_criterion", criterionIds: [...duplicates] },
		};
	}
	const byId = new Map(verdicts.map((v) => [v.criterionId, v]));
	const missing = criteria
		.filter((c) => (byId.get(c.id)?.evidence.trim() ?? "") === "")
		.map((c) => c.id);
	if (missing.length > 0) {
		return {
			ok: false,
			error: { kind: "missing_evidence", criterionIds: missing },
		};
	}
	return {
		ok: true,
		value: criteria.flatMap((c) => {
			const v = byId.get(c.id);
			return v === undefined
				? []
				: [
						{
							criterionId: c.id,
							text: c.text,
							verdict: v.verdict,
							evidence: v.evidence,
						},
					];
		}),
	};
}
