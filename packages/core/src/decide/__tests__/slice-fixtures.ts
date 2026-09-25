/**
 * Hand-built decision log slices for the promotion and drift tests: records
 * and outcomes as the log would hand them back, without a database.
 */

import { hashModel, hashValue } from "../log/hash";
import type { DecisionRecord } from "../log/schema";
import type { Outcome, OutcomeRecord } from "../outcomes/types";
import type { DecisionBackend, DecisionType } from "../types";

type ModelRef = Readonly<{ id: DecisionBackend; version: string }>;

export const HEURISTIC: ModelRef = { id: "heuristic", version: "1" };
export const SYSTEM1: ModelRef = { id: "system1", version: "0.1.0" };

type RecordOptions = Readonly<{
	id: string;
	model: ModelRef;
	type?: DecisionType;
	answer?: boolean;
	/** Probability of `answer` (at least 0.5, so it stays the mode). */
	p?: number;
	latencyMs?: number;
	finalAction?: string;
	ts?: number;
}>;

/** A valid bool decision record. */
export function boolRecord(options: RecordOptions): DecisionRecord {
	const answer = options.answer ?? true;
	const p = options.p ?? 0.9;
	const type = options.type ?? "slop";
	return {
		id: options.id,
		ts: options.ts ?? 1_000,
		type,
		inputHash: hashValue(`input:${options.id.replace(/:shadow$/, "")}`),
		schemaHash: hashValue(`schema:${type}`),
		optionOrder: [true, false],
		policyHash: hashValue("policy"),
		modelHash: hashModel(options.model),
		distribution: [
			{ answer: true, p: answer ? p : 1 - p },
			{ answer: false, p: answer ? 1 - p : p },
		],
		answer,
		finalAction: options.finalAction ?? "flag",
		latencyMs: options.latencyMs ?? 1,
	};
}

type RiskOptions = Readonly<{
	id: string;
	model: ModelRef;
	answer: "allow" | "ask" | "deny";
	/** Probability of `answer`; the other two share the rest. */
	p?: number;
	/** Names the input; defaults to the id without `:shadow`. */
	input?: string;
	finalAction?: string;
}>;

/** A valid `action.risk` decision record. */
export function riskRecord(options: RiskOptions): DecisionRecord {
	const p = options.p ?? 0.8;
	const verdicts = ["allow", "ask", "deny"] as const;
	return {
		id: options.id,
		ts: 1_000,
		type: "action.risk",
		inputHash: hashValue(
			`input:${options.input ?? options.id.replace(/:shadow$/, "")}`,
		),
		schemaHash: hashValue("schema:action.risk"),
		optionOrder: [...verdicts],
		policyHash: hashValue("policy"),
		modelHash: hashModel(options.model),
		distribution: verdicts.map((v) => ({
			answer: v,
			p: v === options.answer ? p : (1 - p) / 2,
		})),
		answer: options.answer,
		finalAction: options.finalAction ?? options.answer,
		latencyMs: 1,
	};
}

export function outcome(decisionId: string, kind: Outcome): OutcomeRecord {
	return {
		id: hashValue({ decisionId, kind }),
		decisionId,
		outcome: kind,
		source: "gate",
		ts: 2_000,
	};
}
