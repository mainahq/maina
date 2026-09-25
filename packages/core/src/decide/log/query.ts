/**
 * Reading the decision log (FR-DEC-3, FR-DEC-5). Filters are bound as SQL
 * parameters; every row is parsed and validated back into a
 * `DecisionRecord`, and a row that does not parse is reported, not thrown.
 */

import type { Result } from "../../db/index";
import type { DbRow, DbValue } from "../../ports/db";
import type { DecisionType } from "../types";
import type { DecisionLogPorts } from "./append";
import {
	type DecisionLogError,
	type DecisionRecord,
	validateRecord,
} from "./schema";

export type DecisionFilter = Readonly<{
	type?: DecisionType;
	inputHash?: string;
	schemaHash?: string;
	policyHash?: string;
	modelHash?: string;
	host?: string;
	sessionId?: string;
	/** Inclusive lower bound on `ts`. */
	since?: number;
	/** Exclusive upper bound on `ts`. */
	until?: number;
	/** At most this many records (a positive integer). */
	limit?: number;
	/** Newest entries first; with `limit`, the most recent ones. */
	newestFirst?: boolean;
}>;

const EQUALITY_COLUMNS = [
	["type", "type"],
	["inputHash", "input_hash"],
	["schemaHash", "schema_hash"],
	["policyHash", "policy_hash"],
	["modelHash", "model_hash"],
	["host", "host"],
	["sessionId", "session_id"],
] as const;

/** Rows were validated on the way in; read them back under any privacy. */
const READ_PRIVACY = { rawOptions: true } as const;

function parseJson(text: DbValue | undefined): Result<unknown, string> {
	if (typeof text !== "string") return { ok: false, error: "not text" };
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

function toRecord(row: DbRow): Result<DecisionRecord, DecisionLogError> {
	const id = typeof row.id === "string" ? row.id : String(row.id);
	const corrupt = (message: string): Result<never, DecisionLogError> => ({
		ok: false,
		error: { kind: "corrupt_row", id, message },
	});
	const optionOrder = parseJson(row.option_order);
	if (!optionOrder.ok) return corrupt(`option_order: ${optionOrder.error}`);
	const distribution = parseJson(row.distribution);
	if (!distribution.ok) return corrupt(`distribution: ${distribution.error}`);
	const answer = parseJson(row.answer);
	if (!answer.ok) return corrupt(`answer: ${answer.error}`);
	const valid = validateRecord(
		{
			id: row.id,
			ts: row.ts,
			type: row.type,
			inputHash: row.input_hash,
			schemaHash: row.schema_hash,
			optionOrder: optionOrder.value,
			policyHash: row.policy_hash,
			modelHash: row.model_hash,
			distribution: distribution.value,
			answer: answer.value,
			finalAction: row.final_action,
			latencyMs: row.latency_ms,
			host: row.host ?? undefined,
			sessionId: row.session_id ?? undefined,
		},
		READ_PRIVACY,
	);
	return valid.ok ? valid : corrupt(valid.error.message);
}

function isBound(value: number | undefined): boolean {
	return value === undefined || Number.isFinite(value);
}

/** The records matching every set field of `filter`, in append order. */
export function queryDecisions(
	ports: Pick<DecisionLogPorts, "db">,
	filter: DecisionFilter = {},
): Result<readonly DecisionRecord[], DecisionLogError> {
	const { limit, since, until } = filter;
	if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
		return {
			ok: false,
			error: {
				kind: "invalid_filter",
				message: "limit must be a positive integer",
			},
		};
	}
	if (!isBound(since) || !isBound(until)) {
		return {
			ok: false,
			error: {
				kind: "invalid_filter",
				message: "since and until must be finite",
			},
		};
	}
	const clauses: string[] = [];
	const params: DbValue[] = [];
	for (const [key, column] of EQUALITY_COLUMNS) {
		const value = filter[key];
		if (value !== undefined) {
			clauses.push(`${column} = ?`);
			params.push(value);
		}
	}
	if (since !== undefined) {
		clauses.push("ts >= ?");
		params.push(since);
	}
	if (until !== undefined) {
		clauses.push("ts < ?");
		params.push(until);
	}
	const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
	const order = filter.newestFirst ? "DESC" : "ASC";
	const bounded = limit === undefined ? "" : " LIMIT ?";
	if (limit !== undefined) params.push(limit);

	const rows = ports.db.all(
		`SELECT * FROM decision_log${where} ORDER BY seq ${order}${bounded}`,
		params,
	);
	if (!rows.ok) {
		return { ok: false, error: { kind: "db", message: rows.error.message } };
	}
	const records: DecisionRecord[] = [];
	for (const row of rows.value) {
		const record = toRecord(row);
		if (!record.ok) return record;
		records.push(record.value);
	}
	return { ok: true, value: records };
}
