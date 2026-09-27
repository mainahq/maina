/**
 * System 1 pre-inference (#572). onnxruntime-node and onnxruntime-web only
 * offer an async `run()`, but core's `decide` and `evaluateGate` are
 * synchronous and pure. So the runtime runs the model first: core's
 * `gateModelInputs` plans the `action.risk` inputs the gate will ask (both
 * orders of the two-order check), `preInfer` encodes and infers all of them
 * in one pass, and the gate reads the outputs through core's synchronous
 * `precomputedBackend`. The time spent here counts against the gate budget
 * (core `GatePorts.preInferenceMs`).
 *
 * Fail closed: an error, a rejection, a malformed output or no answer within
 * the budget leaves a backend that answers every input `unsupported`, which
 * the gate turns into an ask.
 */

import {
	type Backend,
	type BackendAnswer,
	type BackendError,
	type BackendInput,
	type ClockPort,
	type DecisionBackend,
	type Precomputed,
	precomputedBackend,
	type Result,
} from "@mainahq/core";

/**
 * An async model over a batch of backend inputs: one `infer` call encodes
 * them and runs one inference pass (an onnxruntime session's `run()`),
 * returning each input's answers in input order.
 */
export type InferencePort = Readonly<{
	id: DecisionBackend;
	version: string;
	infer: (
		inputs: readonly BackendInput[],
	) => Promise<Result<readonly (readonly BackendAnswer[])[], BackendError>>;
}>;

export type PreInferred = Readonly<{
	/** A synchronous backend over the model's outputs, for `evaluateGate`. */
	backend: Backend;
	/** Time the pre-inference took, by `clock`: count it against the budget. */
	elapsedMs: number;
}>;

const failure = (message: string): Result<never, BackendError> => ({
	ok: false,
	error: { kind: "unsupported", questionId: undefined, message },
});

/** The model's outputs paired with their inputs, or why they cannot be. */
function pair(
	model: InferencePort,
	inputs: readonly BackendInput[],
	outputs: Result<readonly (readonly BackendAnswer[])[], BackendError>,
): Result<readonly Precomputed[], BackendError> {
	if (!outputs.ok) return outputs;
	if (!Array.isArray(outputs.value) || outputs.value.length !== inputs.length) {
		return failure(
			`${model.id} returned ${outputs.value?.length ?? "no"} outputs for ${inputs.length} inputs`,
		);
	}
	return {
		ok: true,
		value: inputs.map((input, i) => ({
			input,
			answers: outputs.value[i] ?? [],
		})),
	};
}

/**
 * Runs `model` once over every input and returns a synchronous backend over
 * its outputs. A model that has not answered within `budgetMs` is abandoned:
 * the gate could not use a later answer anyway. Never rejects.
 */
export async function preInfer(
	model: InferencePort,
	clock: ClockPort,
	inputs: readonly BackendInput[],
	budgetMs: number,
): Promise<PreInferred> {
	const started = clock.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<Result<never, BackendError>>((settle) => {
		timer = setTimeout(
			() => settle(failure(`${model.id} did not answer within ${budgetMs} ms`)),
			budgetMs,
		);
	});
	const inferred = Promise.resolve()
		.then(() => model.infer(inputs))
		.then((outputs) => pair(model, inputs, outputs))
		// A rejection, or a result too malformed to read.
		.catch((e: unknown) =>
			failure(
				`${model.id} inference failed: ${e instanceof Error ? e.message : String(e)}`,
			),
		);
	const entries = await Promise.race([inferred, deadline]);
	clearTimeout(timer);
	return {
		backend: precomputedBackend(model, entries),
		elapsedMs: clock.now() - started,
	};
}
