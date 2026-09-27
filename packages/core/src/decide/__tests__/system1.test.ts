/**
 * Registry and promotion wiring for `system1` (#586).
 *
 * - The model covers ten decision types. A policy naming `system1` for any
 *   other type is served by the type's catalog default (the heuristic),
 *   even when a `system1` backend is registered.
 * - The `system1` adapter delegates to the catalog default (rules for
 *   `action.risk`, the heuristic otherwise) when the model answers
 *   `unsupported`; `decide` itself never falls back, and the decision names
 *   the backend that actually answered.
 * - Promotion flips `DEFAULT_POLICY`, never the catalog default: the
 *   catalog default is the built-in fallback and is never `system1`.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "../../policy/defaults";
import { DECISION_TYPES, type DecisionType } from "../../policy/schema";
import { createFixedClock } from "../../ports/testing";
import { system1Backend } from "../backends/system1";
import { decide } from "../decide";
import {
	createRegistry,
	DEFAULT_REGISTRY,
	selectBackend,
	withBackend,
} from "../registry";
import type { Backend, BackendInput, DecideRequest } from "../types";
import { DECISION_CATALOG, SYSTEM1_TYPES } from "../types-catalog";

/** The model's v1 scope (spec FR-S1-1; maina-model `MODEL_TYPES`). */
const COVERED: readonly DecisionType[] = [
	"action.risk",
	"diff.sensitive",
	"diff.needs_review",
	"task.tier",
	"finding.real",
	"spec.coverage",
	"spec.orphan",
	"spec.contradiction",
	"spec.impl_leak",
	"spec.quality",
];

const UNCOVERED: readonly DecisionType[] = [
	"finding.severity",
	"review.category",
	"review.reviewer_kind",
	"slop",
	"wiki.relevance",
	"context.select",
];

/** A model that answers every bool question `false` at 0.7. */
const model: Backend = {
	id: "system1",
	version: "onnx-test",
	answer: (input) => ({
		ok: true,
		value: input.questions.map(() => ({
			answer: false,
			distribution: [
				{ answer: true, p: 0.3 },
				{ answer: false, p: 0.7 },
			],
		})),
	}),
};

/** A model that cannot answer anything (a failed pre-inference). */
const refusing = (calls: BackendInput[] = []): Backend => ({
	id: "system1",
	version: "onnx-test",
	answer: (input) => {
		calls.push(input);
		return {
			ok: false,
			error: {
				kind: "unsupported",
				questionId: undefined,
				message: "system1 did not answer within 250 ms",
			},
		};
	},
});

const withSystem1 = (backend: Backend) =>
	createRegistry([...DEFAULT_REGISTRY.values(), backend]);

describe("system1 coverage", () => {
	test("the catalog marks exactly the model's ten types as system1 types", () => {
		expect([...SYSTEM1_TYPES]).toEqual([...COVERED]);
		for (const type of DECISION_TYPES) {
			expect(DECISION_CATALOG[type].system1).toBe(COVERED.includes(type));
		}
	});

	test("a policy naming system1 for an uncovered type is served by the heuristic", () => {
		const registry = withSystem1(model);
		for (const type of UNCOVERED) {
			const selected = selectBackend(
				registry,
				withBackend(DEFAULT_POLICY, type, "system1"),
				type,
			);
			expect(selected.ok && selected.value.id).toBe("heuristic");
		}
	});

	test("a policy naming system1 for a covered type is served by system1", () => {
		const registry = withSystem1(model);
		for (const type of COVERED) {
			const selected = selectBackend(
				registry,
				withBackend(DEFAULT_POLICY, type, "system1"),
				type,
			);
			expect(selected.ok && selected.value.id).toBe("system1");
		}
	});
});

describe("promotion flips the policy, not the catalog", () => {
	test("every catalog default is a built-in backend, never system1", () => {
		for (const type of DECISION_TYPES) {
			expect(["rules", "heuristic"]).toContain(
				DECISION_CATALOG[type].defaultBackend,
			);
		}
		expect(DECISION_CATALOG["action.risk"].defaultBackend).toBe("rules");
	});

	test("a promoted action.risk without an installed model is served by rules", () => {
		const promoted = withBackend(DEFAULT_POLICY, "action.risk", "system1");
		const selected = selectBackend(DEFAULT_REGISTRY, promoted, "action.risk");
		expect(selected.ok && selected.value.id).toBe("rules");
	});
});

describe("the system1 adapter", () => {
	const needsReview: DecideRequest = {
		type: "diff.needs_review",
		state: {
			trusted: { additions: 900, deletions: 100, files: 3 },
			untrusted: { paths: ["src/a.ts"] },
		},
		questions: [{ kind: "bool", id: "needs_review" }],
	};
	const risk: DecideRequest = {
		type: "action.risk",
		state: { trusted: { actionClass: "git.push.force" }, untrusted: {} },
		questions: [
			{ kind: "choice", id: "verdict", options: ["allow", "ask", "deny"] },
		],
	};
	const portsFor = (backend: Backend, type: DecisionType) => ({
		clock: createFixedClock(1_000),
		policy: withBackend(DEFAULT_POLICY, type, "system1"),
		backends: withSystem1(backend),
	});

	test("keeps the model's id and version", () => {
		const adapted = system1Backend(model);
		expect(adapted.id).toBe("system1");
		expect(adapted.version).toBe("onnx-test");
	});

	test("the model's answer is the decision, recorded as system1", () => {
		const result = decide(
			portsFor(system1Backend(model), "diff.needs_review"),
			needsReview,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value[0]).toMatchObject({
			answer: false,
			confidence: 0.7,
			backend: { id: "system1", version: "onnx-test" },
		});
	});

	test("an unsupported action.risk answer is delegated to rules", () => {
		const result = decide(
			portsFor(system1Backend(refusing()), "action.risk"),
			risk,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// git.push.force asks by default: the rules backend's exact answer.
		expect(result.value[0]).toMatchObject({
			answer: "ask",
			confidence: 1,
			backend: { id: "rules", version: "1" },
		});
	});

	test("an unsupported answer for another covered type is delegated to the heuristic", () => {
		const result = decide(
			portsFor(system1Backend(refusing()), "diff.needs_review"),
			needsReview,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value[0]?.backend.id).toBe("heuristic");
		expect(result.value[0]?.answer).toBe(true);
	});

	test("a delegated decision carries no model calibration", () => {
		const calibrated: Backend = {
			...refusing(),
			calibration: { sha256: "c".repeat(64), thresholds: {} },
		};
		const result = decide(
			portsFor(system1Backend(calibrated), "action.risk"),
			risk,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value[0]?.backend).toEqual({ id: "rules", version: "1" });
	});

	test("with no fallback registered, the model's unsupported error stands", () => {
		const result = decide(
			portsFor(
				system1Backend(refusing(), createRegistry([])),
				"diff.needs_review",
			),
			needsReview,
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatchObject({
			kind: "unsupported",
			backend: "system1",
			message: "system1 did not answer within 250 ms",
		});
	});

	test("decide does not fall back on its own: a bare unsupported model errors", () => {
		const result = decide(portsFor(refusing(), "action.risk"), risk);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toMatchObject({
			kind: "unsupported",
			backend: "system1",
		});
	});
});
