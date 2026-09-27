/**
 * The `system1` adapter (#586): wraps a System 1 model backend (the
 * runtime's `precomputedBackend` over an onnxruntime pre-inference) so that
 * whatever the model cannot answer is answered by the type's built-in
 * backend instead: rules for `action.risk`, the heuristic otherwise (the
 * catalog's `defaultBackend`).
 *
 * `decide` never falls back on its own: a bare backend that answers
 * `unsupported` is an error. The adapter does the delegating through
 * `Backend.route`, so the decision names the backend that actually
 * answered and a delegated answer is never judged by the model's
 * calibrated thresholds. A model that disabled itself for the session
 * (a failed verification, say) is simply not registered, and the registry
 * falls back to the same built-in backend.
 */

import type { Result } from "../../db/index";
import { type BackendRegistry, DEFAULT_REGISTRY } from "../registry";
import type {
	Backend,
	BackendAnswer,
	BackendError,
	BackendInput,
	Routed,
} from "../types";
import { DECISION_CATALOG } from "../types-catalog";

/**
 * `model`, delegating each input it answers `unsupported` to that type's
 * catalog default in `fallbacks`. Without that backend in `fallbacks`, the
 * model's own error stands.
 */
export function system1Backend(
	model: Backend,
	fallbacks: BackendRegistry = DEFAULT_REGISTRY,
): Backend {
	const route = (input: BackendInput): Result<Routed, BackendError> => {
		const answered = model.answer(input);
		if (answered.ok) {
			return { ok: true, value: { backend: model, answers: answered.value } };
		}
		const delegate = fallbacks.get(DECISION_CATALOG[input.type].defaultBackend);
		if (delegate === undefined) return answered;
		const delegated = delegate.answer(input);
		return delegated.ok
			? { ok: true, value: { backend: delegate, answers: delegated.value } }
			: delegated;
	};
	return {
		id: model.id,
		version: model.version,
		...(model.calibration === undefined
			? {}
			: { calibration: model.calibration }),
		answer: (input): Result<readonly BackendAnswer[], BackendError> => {
			const routed = route(input);
			return routed.ok ? { ok: true, value: routed.value.answers } : routed;
		},
		route,
	};
}
