import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "../../../policy/defaults";
import type { Policy } from "../../../policy/schema";
import { heuristicBackend } from "../../backends/heuristic";
import { createRegistry, DEFAULT_REGISTRY } from "../../registry";
import { appendDecision } from "../append";
import { queryDecisions } from "../query";
import {
	decidePorts,
	migratedDb,
	recordFor,
	SLOP_REQUEST,
	TIER_REQUEST,
	unwrap,
} from "./fixtures";

describe("queryDecisions", () => {
	function seeded() {
		const db = migratedDb();
		const records = [
			recordFor(SLOP_REQUEST, { id: "a", ts: 10, sessionId: "s1" }),
			recordFor(TIER_REQUEST, { id: "b", ts: 20, host: "cursor" }),
			recordFor(SLOP_REQUEST, { id: "c", ts: 30, sessionId: "s2" }),
		];
		for (const record of records) unwrap(appendDecision({ db }, record));
		return { db, records } as const;
	}

	test("filters by type, session, host and time window", () => {
		const { db, records } = seeded();
		const [a, b, c] = records;
		const ids = (filter: Parameters<typeof queryDecisions>[1]) =>
			unwrap(queryDecisions({ db }, filter)).map((r) => r.id);
		expect(ids({ type: "slop" })).toEqual(["a", "c"]);
		expect(ids({ sessionId: "s2" })).toEqual(["c"]);
		expect(ids({ host: "cursor" })).toEqual(["b"]);
		expect(ids({ since: 20 })).toEqual(["b", "c"]);
		expect(ids({ until: 20 })).toEqual(["a"]);
		expect(ids({ since: 10, until: 30 })).toEqual(["a", "b"]);
		expect(ids({ inputHash: a?.inputHash })).toEqual(["a", "c"]);
		expect(ids({ schemaHash: b?.schemaHash })).toEqual(["b"]);
		expect(ids({ modelHash: c?.modelHash })).toEqual(["a", "b", "c"]);
	});

	test("limit and newestFirst return the most recent entries", () => {
		const { db } = seeded();
		const ids = unwrap(
			queryDecisions({ db }, { limit: 2, newestFirst: true }),
		).map((r) => r.id);
		expect(ids).toEqual(["c", "b"]);
	});

	test("an invalid limit is an error", () => {
		const { db } = seeded();
		for (const limit of [0, -1, 1.5, Number.NaN]) {
			const result = queryDecisions({ db }, { limit });
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.kind).toBe("invalid_filter");
		}
	});

	test("filter values are bound, never spliced into SQL", () => {
		const { db, records } = seeded();
		expect(
			unwrap(queryDecisions({ db }, { sessionId: "s1' OR '1'='1" })),
		).toEqual([]);
		expect(unwrap(queryDecisions({ db }, {}))).toEqual(records);
	});

	test("a corrupt row is reported, not thrown", () => {
		const { db } = seeded();
		// Append-only guards stop edits, so plant a bad row with a raw insert.
		unwrap(
			db.run(
				"INSERT INTO decision_log (id, ts, type, input_hash, schema_hash, option_order, policy_hash, model_hash, distribution, answer, final_action, latency_ms) VALUES ('bad', 40, 'slop', 'x', 'x', '{not json', 'x', 'x', '[]', 'true', 'flag', 0)",
			),
		);
		const result = queryDecisions({ db }, {});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("corrupt_row");
	});
});

describe("reproducibility", () => {
	test("the same input + policy + model hash replayed gives an identical answer", () => {
		const db = migratedDb();
		for (const request of [SLOP_REQUEST, TIER_REQUEST]) {
			const original = recordFor(request, { id: `orig-${request.type}` });
			unwrap(appendDecision({ db }, original));

			// Replay later, with freshly built (structurally equal) inputs.
			const replay = recordFor(structuredClone(request), {
				id: `replay-${request.type}`,
				ts: original.ts + 60_000,
				ports: decidePorts({
					policy: structuredClone(DEFAULT_POLICY) as Policy,
					backends: createRegistry([...DEFAULT_REGISTRY.values()]),
				}),
			});

			const logged = unwrap(
				queryDecisions(
					{ db },
					{
						inputHash: replay.inputHash,
						schemaHash: replay.schemaHash,
						policyHash: replay.policyHash,
						modelHash: replay.modelHash,
					},
				),
			);
			expect(logged.map((r) => r.id)).toEqual([original.id]);
			const [stored] = logged;
			expect(replay.answer).toEqual(stored?.answer as never);
			expect(replay.distribution).toEqual(stored?.distribution as never);
			expect(replay.optionOrder).toEqual(stored?.optionOrder as never);
		}
	});

	test("a different policy or model version changes the replay key", () => {
		const original = recordFor(SLOP_REQUEST);
		const policy: Policy = {
			...DEFAULT_POLICY,
			decisions: {
				...DEFAULT_POLICY.decisions,
				slop: {
					...DEFAULT_POLICY.decisions.slop,
					thresholds: { confidence: 0.99 },
				},
			},
		};
		const otherPolicy = recordFor(SLOP_REQUEST, {
			ports: decidePorts({ policy }),
		});
		expect(otherPolicy.policyHash).not.toBe(original.policyHash);

		const otherModel = recordFor(SLOP_REQUEST, {
			ports: decidePorts({
				backends: createRegistry([
					...DEFAULT_REGISTRY.values(),
					{ ...heuristicBackend, version: "2" },
				]),
			}),
		});
		expect(otherModel.modelHash).not.toBe(original.modelHash);
		expect(otherModel.inputHash).toBe(original.inputHash);
	});
});
