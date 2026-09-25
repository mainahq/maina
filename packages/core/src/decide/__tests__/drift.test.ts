import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "../../policy/defaults";
import type { Policy } from "../../policy/schema";
import {
	applyDriftAction,
	checkDrift,
	type DriftThresholds,
	driftThresholds,
} from "../drift";
import type { DecisionRecord } from "../log/schema";
import type { OutcomeRecord } from "../outcomes/types";
import { SHADOW_ACTION } from "../promotion";
import { createRegistry, DEFAULT_REGISTRY, selectBackend } from "../registry";
import type { Backend } from "../types";
import { boolRecord, HEURISTIC, outcome, SYSTEM1 } from "./slice-fixtures";

const THRESHOLDS: DriftThresholds = {
	type: "slop",
	backend: SYSTEM1,
	window: 10,
	maxErrorRate: 0.1,
	maxConfidenceDrop: 0.15,
	minSamples: 5,
};

/** `slop` served by a promoted system1 backend. */
const PROMOTED: Policy = {
	...DEFAULT_POLICY,
	decisions: {
		...DEFAULT_POLICY.decisions,
		slop: { ...DEFAULT_POLICY.decisions.slop, backend: "system1" },
	},
};

const SYSTEM1_BACKEND: Backend = {
	id: "system1",
	version: SYSTEM1.version,
	answer: () => ({ ok: true, value: [] }),
};

type Slice = Readonly<{
	decisions: readonly DecisionRecord[];
	outcomes: readonly OutcomeRecord[];
}>;

/** `count` system1 decisions of `slop`; the ids in `wrong` were reverted, the rest accepted. */
function window(
	count: number,
	options: Readonly<{
		prefix?: string;
		p?: number;
		wrong?: readonly number[];
	}> = {},
): Slice {
	const prefix = options.prefix ?? "w";
	const decisions = Array.from({ length: count }, (_, i) =>
		boolRecord({ id: `${prefix}${i}`, model: SYSTEM1, p: options.p ?? 0.9 }),
	);
	const outcomes = decisions.map((d, i) =>
		outcome(d.id, options.wrong?.includes(i) ? "reverted" : "accepted"),
	);
	return { decisions, outcomes };
}

function concat(...slices: readonly Slice[]): Slice {
	return {
		decisions: slices.flatMap((s) => s.decisions),
		outcomes: slices.flatMap((s) => s.outcomes),
	};
}

describe("checkDrift", () => {
	test("a drift breach demotes the type and emits a user notice", () => {
		const action = checkDrift(window(10, { wrong: [1, 4, 7, 9] }), THRESHOLDS);
		expect(action.kind).toBe("demote");
		if (action.kind !== "demote") return;
		expect(action.type).toBe("slop");
		expect(action.from).toBe("system1");
		expect(action.to).toBe("heuristic");
		expect(action.breaches).toEqual(["error_rate"]);
		expect(action.metrics.errorRate).toBeCloseTo(0.4);
		expect(action.notice.level).toBe("warning");
		expect(action.notice.message).toContain("slop");
		expect(action.notice.message).toContain("system1");
		expect(action.notice.message).toContain("heuristic");
		expect(action.notice.message).toContain("40%");

		const demoted = applyDriftAction(PROMOTED, action);
		expect(demoted.decisions.slop.backend).toBe("heuristic");
		// Every other type keeps its backend.
		expect(demoted.decisions["action.risk"]).toEqual(
			PROMOTED.decisions["action.risk"],
		);
		const registry = createRegistry([
			...DEFAULT_REGISTRY.values(),
			SYSTEM1_BACKEND,
		]);
		const before = selectBackend(registry, PROMOTED, "slop");
		const after = selectBackend(registry, demoted, "slop");
		expect(before.ok && before.value.id).toBe("system1");
		expect(after.ok && after.value.id).toBe("heuristic");
	});

	test("a confidence drop breaches without any outcome", () => {
		const baseline = window(10, { prefix: "b", p: 0.95 });
		const recent = window(10, { prefix: "r", p: 0.7 });
		const action = checkDrift(
			{ decisions: [...baseline.decisions, ...recent.decisions], outcomes: [] },
			THRESHOLDS,
		);
		expect(action.kind).toBe("demote");
		if (action.kind !== "demote") return;
		expect(action.breaches).toEqual(["confidence_drop"]);
		expect(action.metrics.errorRate).toBeNull();
		expect(action.metrics.confidenceDrop).toBeCloseTo(0.25);
		expect(action.notice.message).toContain("confidence");
	});

	test("no breach leaves the policy as it is", () => {
		const action = checkDrift(window(10, { wrong: [3] }), THRESHOLDS);
		expect(action.kind).toBe("none");
		expect(action.metrics.errorRate).toBeCloseTo(0.1);
		expect(applyDriftAction(PROMOTED, action)).toBe(PROMOTED);
	});

	test("too little evidence never demotes", () => {
		const action = checkDrift(window(4, { wrong: [0, 1, 2, 3] }), THRESHOLDS);
		expect(action.kind).toBe("none");
		expect(action.metrics.labelled).toBe(4);
		expect(action.metrics.errorRate).toBeNull();
		expect(action.metrics.confidenceDrop).toBeNull();
	});

	test("only the latest window of the serving backend's own decisions counts", () => {
		const old = window(10, { prefix: "old", wrong: [0, 1, 2, 3, 4, 5] });
		const recent = window(10, { prefix: "new" });
		const noise: Slice = {
			decisions: [
				boolRecord({ id: "h0", model: HEURISTIC }),
				boolRecord({ id: "s0", model: SYSTEM1, finalAction: SHADOW_ACTION }),
				boolRecord({ id: "t0", model: SYSTEM1, type: "finding.real" }),
			],
			outcomes: [
				outcome("h0", "reverted"),
				outcome("s0", "reverted"),
				outcome("t0", "reverted"),
			],
		};
		const action = checkDrift(concat(old, noise, recent), THRESHOLDS);
		expect(action.kind).toBe("none");
		expect(action.metrics.decisions).toBe(10);
		expect(action.metrics.errorRate).toBe(0);
	});

	test("a breach on the default backend notifies without demoting", () => {
		const records = window(10, { wrong: [0, 1, 2] });
		const heuristic: Slice = {
			decisions: records.decisions.map((d) =>
				boolRecord({ id: d.id, model: HEURISTIC }),
			),
			outcomes: records.outcomes,
		};
		const action = checkDrift(heuristic, { ...THRESHOLDS, backend: HEURISTIC });
		expect(action.kind).toBe("notify");
		if (action.kind !== "notify") return;
		expect(action.breaches).toEqual(["error_rate"]);
		expect(action.notice.message).toContain("slop");
		expect(applyDriftAction(DEFAULT_POLICY, action)).toBe(DEFAULT_POLICY);
	});
});

describe("driftThresholds", () => {
	test("reads the window and limits from the policy", () => {
		const policy: Policy = {
			...DEFAULT_POLICY,
			drift: { window: 50, max_error_rate: 0.2, max_confidence_drop: 0.3 },
		};
		expect(driftThresholds(policy, "slop", SYSTEM1)).toEqual({
			type: "slop",
			backend: SYSTEM1,
			window: 50,
			maxErrorRate: 0.2,
			maxConfidenceDrop: 0.3,
			minSamples: 20,
		});
		expect(driftThresholds(policy, "slop", SYSTEM1, 3).minSamples).toBe(3);
	});
});
