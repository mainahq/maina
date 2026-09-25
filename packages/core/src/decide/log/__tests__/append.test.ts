import { describe, expect, test } from "bun:test";
import { migrateDecisionLog } from "../../../db/decision-log";
import { DEFAULT_POLICY } from "../../../policy/defaults";
import { createMemoryDb } from "../../../ports/testing";
import * as appendModule from "../append";
import { appendDecision, buildDecisionRecord } from "../append";
import * as queryModule from "../query";
import { queryDecisions } from "../query";
import type { DecisionRecord, DecisionRecordField } from "../schema";
import {
	decideOne,
	migratedDb,
	recordFor,
	SLOP_REQUEST,
	TIER_REQUEST,
	unwrap,
} from "./fixtures";

describe("the decision log is append-only", () => {
	test("appended records come back in append order", () => {
		const db = migratedDb();
		const a = recordFor(SLOP_REQUEST, { id: "a", ts: 2 });
		const b = recordFor(TIER_REQUEST, { id: "b", ts: 1 });
		unwrap(appendDecision({ db }, a));
		unwrap(appendDecision({ db }, b));
		expect(unwrap(queryDecisions({ db }, {}))).toEqual([a, b]);
	});

	test("UPDATE and DELETE are refused by the database", () => {
		const db = migratedDb();
		const record = recordFor(SLOP_REQUEST);
		unwrap(appendDecision({ db }, record));

		const update = db.run("UPDATE decision_log SET final_action = 'allow'");
		expect(update.ok).toBe(false);
		const remove = db.run("DELETE FROM decision_log");
		expect(remove.ok).toBe(false);
		const upsert = db.run(
			"INSERT INTO decision_log (id, ts, type, input_hash, schema_hash, option_order, policy_hash, model_hash, distribution, answer, final_action, latency_ms) SELECT id, ts, type, input_hash, schema_hash, option_order, policy_hash, model_hash, distribution, answer, 'allow', latency_ms FROM decision_log ON CONFLICT(id) DO UPDATE SET final_action = 'allow'",
		);
		expect(upsert.ok).toBe(false);

		expect(unwrap(queryDecisions({ db }, {}))).toEqual([record]);
	});

	test("INSERT OR REPLACE cannot overwrite an existing entry", () => {
		const db = migratedDb();
		const record = recordFor(SLOP_REQUEST);
		unwrap(appendDecision({ db }, record));
		const replaceById = db.run(
			"INSERT OR REPLACE INTO decision_log (id, ts, type, input_hash, schema_hash, option_order, policy_hash, model_hash, distribution, answer, final_action, latency_ms) SELECT id, ts, type, input_hash, schema_hash, option_order, policy_hash, model_hash, distribution, answer, 'allow', latency_ms FROM decision_log",
		);
		expect(replaceById.ok).toBe(false);
		const replaceBySeq = db.run(
			"INSERT OR REPLACE INTO decision_log (seq, id, ts, type, input_hash, schema_hash, option_order, policy_hash, model_hash, distribution, answer, final_action, latency_ms) SELECT seq, 'other', ts, type, input_hash, schema_hash, option_order, policy_hash, model_hash, distribution, answer, 'allow', latency_ms FROM decision_log",
		);
		expect(replaceBySeq.ok).toBe(false);
		expect(unwrap(queryDecisions({ db }, {}))).toEqual([record]);
	});

	test("appending an id twice is an error and keeps the first entry", () => {
		const db = migratedDb();
		const first = recordFor(SLOP_REQUEST, { id: "same" });
		const second = recordFor(TIER_REQUEST, { id: "same" });
		unwrap(appendDecision({ db }, first));
		const again = appendDecision({ db }, second);
		expect(again.ok).toBe(false);
		if (!again.ok) expect(again.error.kind).toBe("db");
		expect(unwrap(queryDecisions({ db }, {}))).toEqual([first]);
	});

	test("the log API exposes no way to change or remove entries", () => {
		const names = [
			...Object.keys(appendModule),
			...Object.keys(queryModule),
		].map((n) => n.toLowerCase());
		for (const verb of ["update", "delete", "remove", "replace", "clear"]) {
			expect(names.some((n) => n.includes(verb))).toBe(false);
		}
	});

	test("migrating twice is harmless and keeps entries", () => {
		const db = migratedDb();
		const record = recordFor(SLOP_REQUEST);
		unwrap(appendDecision({ db }, record));
		unwrap(migrateDecisionLog(db));
		expect(unwrap(queryDecisions({ db }, {}))).toEqual([record]);
	});

	test("appending before migrating is an error, not a throw", () => {
		const result = appendDecision(
			{ db: createMemoryDb() },
			recordFor(SLOP_REQUEST),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("db");
	});
});

describe("buildDecisionRecord", () => {
	test("carries the decision's answer, distribution and option order", () => {
		const decision = decideOne(TIER_REQUEST);
		const record = unwrap(
			buildDecisionRecord({
				id: "r1",
				ts: 5,
				request: TIER_REQUEST,
				decision,
				policy: DEFAULT_POLICY,
				finalAction: "route",
				host: "claude-code",
				sessionId: "s-1",
			}),
		);
		expect(record.type).toBe("task.tier");
		expect(record.answer).toBe(decision.answer);
		expect(record.distribution).toEqual(decision.distribution);
		expect(record.optionOrder).toEqual([
			"mechanical",
			"standard",
			"architectural",
		]);
		expect(record.latencyMs).toBe(decision.latencyMs);
		expect(record.host).toBe("claude-code");
		expect(record.sessionId).toBe("s-1");
	});

	test("a bool question's option order is [true, false]", () => {
		expect(recordFor(SLOP_REQUEST).optionOrder).toEqual([true, false]);
	});

	test("a decision for a question not in the request is an error", () => {
		const decision = { ...decideOne(SLOP_REQUEST), id: "missing" };
		const result = buildDecisionRecord({
			id: "r1",
			ts: 5,
			request: SLOP_REQUEST,
			decision,
			policy: DEFAULT_POLICY,
			finalAction: "flag",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("invalid_record");
	});
});

describe("buildDecisionRecord checks the decision belongs to the request", () => {
	test("a decision of another type is an error", () => {
		const decision = decideOne(SLOP_REQUEST);
		const result = buildDecisionRecord({
			id: "r1",
			ts: 5,
			request: {
				...SLOP_REQUEST,
				type: "diff.sensitive",
			},
			decision,
			policy: DEFAULT_POLICY,
			finalAction: "flag",
		});
		expect(result.ok).toBe(false);
		if (!result.ok && result.error.kind === "invalid_record") {
			expect(result.error.field).toBe("type");
		}
	});

	test("a decision that does not answer the located question is an error", () => {
		const decision = decideOne(TIER_REQUEST);
		const reordered = {
			...TIER_REQUEST,
			questions: [
				{
					kind: "choice",
					id: "tier",
					options: ["architectural", "standard", "mechanical"],
				},
			],
		} as const;
		const result = buildDecisionRecord({
			id: "r1",
			ts: 5,
			request: reordered,
			decision,
			policy: DEFAULT_POLICY,
			finalAction: "route",
		});
		expect(result.ok).toBe(false);
		if (!result.ok && result.error.kind === "invalid_record") {
			expect(result.error.field).toBe("decision");
		}
	});
});

describe("appendDecision validates records", () => {
	const base = (): DecisionRecord => recordFor(SLOP_REQUEST);
	const bad: ReadonlyArray<
		readonly [DecisionRecordField, Partial<Record<string, unknown>>]
	> = [
		["id", { id: "has spaces" }],
		["ts", { ts: -1 }],
		["ts", { ts: 1.5 }],
		["type", { type: "not.a.type" }],
		["inputHash", { inputHash: "src/secret.ts" }],
		["schemaHash", { schemaHash: "" }],
		["policyHash", { policyHash: "sha256:xyz" }],
		["modelHash", { modelHash: 1 }],
		["finalAction", { finalAction: "rm -rf /" }],
		["latencyMs", { latencyMs: Number.NaN }],
		["host", { host: "/Users/me/project" }],
		["sessionId", { sessionId: "a b" }],
		["distribution", { distribution: [{ answer: true, p: 2 }] }],
		["distribution", { distribution: "nope" }],
		["optionOrder", { optionOrder: [{}] }],
		["distribution", { distribution: [] }],
		[
			"distribution",
			{
				distribution: [
					{ answer: true, p: 0.5 },
					{ answer: false, p: 0.4 },
				],
			},
		],
		[
			"distribution",
			{
				distribution: [
					{ answer: false, p: 0.5 },
					{ answer: true, p: 0.5 },
				],
			},
		],
		[
			"distribution",
			{ optionOrder: [], distribution: [{ answer: true, p: 1 }] },
		],
		[
			"answer",
			{
				answer: false,
				distribution: [
					{ answer: true, p: 0.9 },
					{ answer: false, p: 0.1 },
				],
			},
		],
		[
			"answer",
			{
				answer: 3,
				distribution: [
					{ answer: true, p: 0.5 },
					{ answer: false, p: 0.5 },
				],
			},
		],
	];
	for (const [field, patch] of bad) {
		test(`rejects a malformed ${field}: ${JSON.stringify(patch)}`, () => {
			const db = migratedDb();
			const result = appendDecision({ db }, {
				...base(),
				...patch,
			} as DecisionRecord);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("invalid_record");
				if (result.error.kind === "invalid_record") {
					expect(result.error.field).toBe(field);
				}
			}
			expect(unwrap(queryDecisions({ db }, {}))).toEqual([]);
		});
	}
});
