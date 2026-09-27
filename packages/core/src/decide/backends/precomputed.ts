/**
 * The precomputed backend (#572). onnxruntime-node and onnxruntime-web only
 * offer an async `run()`, while `decide` and `evaluateGate` stay synchronous
 * and pure. So the runtime encodes the inputs the gate will ask and runs the
 * model on all of them first (both orders of the two-order check in one
 * pass), then registers this backend over the outputs.
 *
 * An input is matched by everything but its question ids: the runtime plans
 * the inputs before the gate mints its ids, and the answers are positional.
 * An input it holds no answers for is `unsupported`, and a failed
 * pre-inference answers every input with that failure, so the caller fails
 * closed.
 */

import type { Result } from "../../db/index";
import type {
	Backend,
	BackendAnswer,
	BackendCalibration,
	BackendError,
	BackendInput,
	DecisionBackend,
} from "../types";
import { unsupported } from "./distribution";

/** One input the model answered ahead, with its answers in question order. */
export type Precomputed = Readonly<{
	input: BackendInput;
	answers: readonly BackendAnswer[];
}>;

/**
 * What identifies an input across the plan and the gate: the request and
 * the policy, question ids left out. `undefined` for a value JSON cannot
 * hold (a cycle, a bigint), which then matches nothing.
 */
function inputKey(input: BackendInput): string | undefined {
	try {
		return JSON.stringify([
			input.type,
			input.state,
			input.questions.map(({ id: _id, ...shape }) => shape),
			input.policy,
		]);
	} catch {
		return undefined;
	}
}

function keyed(
	entries: readonly Precomputed[],
): ReadonlyMap<string, readonly BackendAnswer[]> {
	const answers = new Map<string, readonly BackendAnswer[]>();
	for (const entry of entries) {
		const key = inputKey(entry.input);
		if (key !== undefined) answers.set(key, entry.answers);
	}
	return answers;
}

/**
 * A synchronous backend that answers from `entries`, a pre-inference's
 * outputs. A calibrated model's `calibration` is carried onto every
 * decision it answers (#338).
 */
export function precomputedBackend(
	meta: Readonly<{
		id: DecisionBackend;
		version: string;
		calibration?: BackendCalibration;
	}>,
	entries: Result<readonly Precomputed[], BackendError>,
): Backend {
	const answers = entries.ok ? keyed(entries.value) : new Map();
	return {
		id: meta.id,
		version: meta.version,
		...(meta.calibration === undefined
			? {}
			: { calibration: meta.calibration }),
		answer: (input) => {
			if (!entries.ok) return entries;
			const key = inputKey(input);
			const found = key === undefined ? undefined : answers.get(key);
			return found === undefined
				? unsupported(
						undefined,
						`no precomputed ${meta.id} answer for this input`,
					)
				: { ok: true, value: found };
		},
	};
}
