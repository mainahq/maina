/**
 * Linking outcomes to logged decisions (FR-DEC-4). `linkOutcome` records
 * what happened after a decision; `linkDecisionCommit` records which commit
 * a decision was made for, so the git miner can find it later. Both are
 * idempotent: linking the same fact twice returns the existing entry.
 */

import type { Result } from "../../db/index";
import type { DbRow, DbValue } from "../../ports/db";
import { hashValue } from "../log/hash";
import { ID_PATTERN, isDecisionType, LABEL_PATTERN } from "../log/schema";
import {
	type CommitDecision,
	OUTCOMES,
	type Outcome,
	type OutcomeError,
	type OutcomeInput,
	type OutcomePorts,
	type OutcomeRecord,
} from "./types";

/** A full commit id: SHA-1 or SHA-256, lower-case hex. */
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isCommitSha(value: string): boolean {
	return COMMIT_PATTERN.test(value);
}

function isOutcome(value: unknown): value is Outcome {
	return (
		typeof value === "string" && (OUTCOMES as readonly string[]).includes(value)
	);
}

function invalid(message: string): Result<never, OutcomeError> {
	return { ok: false, error: { kind: "invalid_outcome", message } };
}

function dbError(message: string): Result<never, OutcomeError> {
	return { ok: false, error: { kind: "db", message } };
}

function validateInput(
	decisionId: string,
	outcome: OutcomeInput,
): Result<OutcomeInput, OutcomeError> {
	if (!ID_PATTERN.test(decisionId)) {
		return invalid("decisionId must be 1-128 characters of [A-Za-z0-9_.:-]");
	}
	if (!isOutcome(outcome.kind)) {
		return invalid(`kind must be one of ${OUTCOMES.join(", ")}`);
	}
	if (
		typeof outcome.source !== "string" ||
		!LABEL_PATTERN.test(outcome.source)
	) {
		return invalid("source must be a lower-case label");
	}
	if (
		outcome.ref !== undefined &&
		(typeof outcome.ref !== "string" || !ID_PATTERN.test(outcome.ref))
	) {
		return invalid("ref must be an id such as a commit sha or a run id");
	}
	return { ok: true, value: outcome };
}

function decisionExists(
	ports: Pick<OutcomePorts, "db">,
	decisionId: string,
): Result<boolean, OutcomeError> {
	const rows = ports.db.all("SELECT 1 FROM decision_log WHERE id = ?", [
		decisionId,
	]);
	return rows.ok
		? { ok: true, value: rows.value.length > 0 }
		: dbError(rows.error.message);
}

/** The outcome's identity: decision, outcome and evidence (not the source). */
function outcomeId(decisionId: string, kind: Outcome, ref?: string): string {
	return hashValue({
		v: 1,
		kind: "outcome",
		decisionId,
		outcome: kind,
		ref: ref ?? null,
	});
}

function toOutcome(row: DbRow): Result<OutcomeRecord, OutcomeError> {
	const id = String(row.id);
	const { decision_id, outcome, source, ref, ts } = row;
	if (
		typeof decision_id !== "string" ||
		!isOutcome(outcome) ||
		typeof source !== "string" ||
		(ref !== null && typeof ref !== "string") ||
		typeof ts !== "number"
	) {
		return {
			ok: false,
			error: { kind: "corrupt_row", id, message: "malformed outcome row" },
		};
	}
	return {
		ok: true,
		value: {
			id,
			decisionId: decision_id,
			outcome,
			source,
			...(ref === null ? {} : { ref }),
			ts,
		},
	};
}

function selectOutcomes(
	ports: Pick<OutcomePorts, "db">,
	where: string,
	params: readonly DbValue[],
): Result<readonly OutcomeRecord[], OutcomeError> {
	const rows = ports.db.all(
		`SELECT * FROM decision_outcome${where} ORDER BY seq ASC`,
		params,
	);
	if (!rows.ok) return dbError(rows.error.message);
	const records: OutcomeRecord[] = [];
	for (const row of rows.value) {
		const record = toOutcome(row);
		if (!record.ok) return record;
		records.push(record.value);
	}
	return { ok: true, value: records };
}

/**
 * Links `outcome` to the logged decision `decisionId`. Returns the stored
 * outcome and whether this call created it; linking the same decision,
 * outcome and ref again returns the first entry unchanged.
 */
export function linkOutcome(
	ports: OutcomePorts,
	decisionId: string,
	outcome: OutcomeInput,
): Result<Readonly<{ record: OutcomeRecord; created: boolean }>, OutcomeError> {
	const valid = validateInput(decisionId, outcome);
	if (!valid.ok) return valid;
	const { kind, source, ref } = valid.value;
	const exists = decisionExists(ports, decisionId);
	if (!exists.ok) return exists;
	if (!exists.value) {
		return { ok: false, error: { kind: "unknown_decision", decisionId } };
	}
	const id = outcomeId(decisionId, kind, ref);
	const found = selectOutcomes(ports, " WHERE id = ?", [id]);
	if (!found.ok) return found;
	const [existing] = found.value;
	if (existing !== undefined) {
		return { ok: true, value: { record: existing, created: false } };
	}
	const record: OutcomeRecord = {
		id,
		decisionId,
		outcome: kind,
		source,
		...(ref === undefined ? {} : { ref }),
		ts: ports.clock.now(),
	};
	const inserted = ports.db.run(
		"INSERT INTO decision_outcome (id, decision_id, outcome, source, ref, ts) VALUES (?, ?, ?, ?, ?, ?)",
		[id, decisionId, kind, source, ref ?? null, record.ts],
	);
	return inserted.ok
		? { ok: true, value: { record, created: true } }
		: dbError(inserted.error.message);
}

export type OutcomeFilter = Readonly<{
	decisionId?: string;
	outcome?: Outcome;
}>;

/** The outcomes matching every set field of `filter`, in link order. */
export function queryOutcomes(
	ports: Pick<OutcomePorts, "db">,
	filter: OutcomeFilter = {},
): Result<readonly OutcomeRecord[], OutcomeError> {
	const clauses: string[] = [];
	const params: DbValue[] = [];
	if (filter.decisionId !== undefined) {
		clauses.push("decision_id = ?");
		params.push(filter.decisionId);
	}
	if (filter.outcome !== undefined) {
		clauses.push("outcome = ?");
		params.push(filter.outcome);
	}
	const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
	return selectOutcomes(ports, where, params);
}

/**
 * Records that `decisionId` was made for commit `commit` (a full sha).
 * Linking the same pair again is a no-op.
 */
export function linkDecisionCommit(
	ports: Pick<OutcomePorts, "db">,
	decisionId: string,
	commit: string,
): Result<void, OutcomeError> {
	if (!isCommitSha(commit)) {
		return invalid("commit must be a full lower-case commit sha");
	}
	if (!ID_PATTERN.test(decisionId)) {
		return invalid("decisionId must be 1-128 characters of [A-Za-z0-9_.:-]");
	}
	const exists = decisionExists(ports, decisionId);
	if (!exists.ok) return exists;
	if (!exists.value) {
		return { ok: false, error: { kind: "unknown_decision", decisionId } };
	}
	const linked = ports.db.all(
		"SELECT 1 FROM decision_commit WHERE decision_id = ? AND commit_sha = ?",
		[decisionId, commit],
	);
	if (!linked.ok) return dbError(linked.error.message);
	if (linked.value.length > 0) return { ok: true, value: undefined };
	const inserted = ports.db.run(
		"INSERT INTO decision_commit (decision_id, commit_sha) VALUES (?, ?)",
		[decisionId, commit],
	);
	return inserted.ok
		? { ok: true, value: undefined }
		: dbError(inserted.error.message);
}

/** The decisions linked to `commit`, in link order. */
export function decisionsForCommit(
	ports: Pick<OutcomePorts, "db">,
	commit: string,
): Result<readonly CommitDecision[], OutcomeError> {
	if (!isCommitSha(commit)) {
		return invalid("commit must be a full lower-case commit sha");
	}
	const rows = ports.db.all(
		`SELECT d.id AS id, d.type AS type, d.final_action AS final_action
		 FROM decision_commit c JOIN decision_log d ON d.id = c.decision_id
		 WHERE c.commit_sha = ? ORDER BY c.seq ASC`,
		[commit],
	);
	if (!rows.ok) return dbError(rows.error.message);
	const decisions: CommitDecision[] = [];
	for (const row of rows.value) {
		const { id, type, final_action } = row;
		if (
			typeof id !== "string" ||
			!isDecisionType(type) ||
			typeof final_action !== "string"
		) {
			return {
				ok: false,
				error: {
					kind: "corrupt_row",
					id: String(id),
					message: "malformed decision row",
				},
			};
		}
		decisions.push({ decisionId: id, type, finalAction: final_action });
	}
	return { ok: true, value: decisions };
}
