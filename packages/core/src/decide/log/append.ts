/**
 * Writing the decision log (FR-DEC-3). `buildDecisionRecord` turns a
 * `decide` result into a record of hashes and labels; `appendDecision`
 * validates it and inserts it. There is deliberately no way to change or
 * remove an entry.
 */

import type { Result } from "../../db/index";
import type { Policy } from "../../policy/schema";
import type { DbPort } from "../../ports/db";
import { answerProblem } from "../decide";
import type { Answer, DecideRequest, Decision, Question } from "../types";
import { DECISION_CATALOG } from "../types-catalog";
import {
	hashInput,
	hashModel,
	hashPolicy,
	hashSchema,
	redactLabel,
} from "./hash";
import {
	DEFAULT_LOG_PRIVACY,
	type DecisionLogError,
	type DecisionLogPrivacy,
	type DecisionRecord,
	validateRecord,
} from "./schema";

export type DecisionLogPorts = Readonly<{
	db: DbPort;
	/** Defaults to `DEFAULT_LOG_PRIVACY` (free-form options hashed). */
	privacy?: DecisionLogPrivacy;
}>;

export type DecisionRecordInput = Readonly<{
	id: string;
	ts: number;
	/** The request `decision` answered one question of. */
	request: DecideRequest;
	decision: Decision;
	/** The policy `decide` ran with. */
	policy: Policy;
	finalAction: string;
	host?: string;
	sessionId?: string;
}>;

function optionsOf(question: Question): readonly Answer[] {
	switch (question.kind) {
		case "choice":
			return question.options;
		case "bool":
			return [true, false];
		case "score":
			return [];
		default: {
			const unreachable: never = question;
			return unreachable;
		}
	}
}

/**
 * The log record for one `Decision` of `request`. Free-form option strings
 * are hashed unless `privacy.rawOptions`; the state itself is only ever
 * hashed.
 */
export function buildDecisionRecord(
	input: DecisionRecordInput,
	privacy: DecisionLogPrivacy = DEFAULT_LOG_PRIVACY,
): Result<DecisionRecord, DecisionLogError> {
	const { request, decision } = input;
	const question = request.questions.find((q) => q.id === decision.id);
	if (question === undefined) {
		return {
			ok: false,
			error: {
				kind: "invalid_record",
				field: "decision",
				message: `the request has no question "${decision.id}"`,
			},
		};
	}
	if (decision.type !== request.type) {
		return {
			ok: false,
			error: {
				kind: "invalid_record",
				field: "type",
				message: `the decision is a ${decision.type} decision, the request a ${request.type} one`,
			},
		};
	}
	// The same checks `decide` ran: the replay key must describe the inputs
	// the stored answer was actually given for.
	const problem = answerProblem(question, decision);
	if (problem !== undefined) {
		return {
			ok: false,
			error: {
				kind: "invalid_record",
				field: "decision",
				message: `the decision does not answer question "${question.id}": ${problem}`,
			},
		};
	}
	const fixed = DECISION_CATALOG[request.type].options;
	const redact = (value: Answer): Answer =>
		typeof value === "string"
			? redactLabel(value, fixed, privacy.rawOptions)
			: value;
	return validateRecord(
		{
			id: input.id,
			ts: input.ts,
			type: request.type,
			inputHash: hashInput(request.type, request.state, question.id),
			schemaHash: hashSchema(request.type, question),
			optionOrder: optionsOf(question).map(redact),
			policyHash: hashPolicy(input.policy),
			modelHash: hashModel(decision.backend),
			distribution: decision.distribution.map((e) => ({
				answer: redact(e.answer),
				p: e.p,
			})),
			answer: redact(decision.answer),
			finalAction: input.finalAction,
			latencyMs: decision.latencyMs,
			host: input.host,
			sessionId: input.sessionId,
		},
		privacy,
	);
}

const INSERT = `INSERT INTO decision_log (
	id, ts, type, input_hash, schema_hash, option_order, policy_hash,
	model_hash, distribution, answer, final_action, latency_ms, host, session_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Validates `record` and appends it. Returns the stored record. An id that
 * is already logged is a `db` error and leaves the existing entry as it was.
 */
export function appendDecision(
	ports: DecisionLogPorts,
	record: DecisionRecord,
): Result<DecisionRecord, DecisionLogError> {
	const valid = validateRecord(record, ports.privacy ?? DEFAULT_LOG_PRIVACY);
	if (!valid.ok) return valid;
	const r = valid.value;
	const inserted = ports.db.run(INSERT, [
		r.id,
		r.ts,
		r.type,
		r.inputHash,
		r.schemaHash,
		JSON.stringify(r.optionOrder),
		r.policyHash,
		r.modelHash,
		JSON.stringify(r.distribution),
		JSON.stringify(r.answer),
		r.finalAction,
		r.latencyMs,
		r.host ?? null,
		r.sessionId ?? null,
	]);
	return inserted.ok
		? { ok: true, value: r }
		: { ok: false, error: { kind: "db", message: inserted.error.message } };
}
