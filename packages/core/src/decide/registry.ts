/**
 * Backend registry and selection. The policy names a backend per decision
 * type; when that backend is not registered (a System 1 model that is not
 * installed yet, say) the catalog's default backend answers instead, and the
 * returned `Decision.backend` records which one did.
 */

import type { Result } from "../db/index";
import type { DecisionType, Policy } from "../policy/schema";
import { heuristicBackend } from "./backends/heuristic";
import { rulesBackend } from "./backends/rules";
import type { Backend, DecideError, DecisionBackend } from "./types";
import { DECISION_CATALOG } from "./types-catalog";

export type BackendRegistry = ReadonlyMap<DecisionBackend, Backend>;

/** Later entries replace earlier ones with the same id. */
export function createRegistry(backends: readonly Backend[]): BackendRegistry {
	return new Map(backends.map((backend) => [backend.id, backend]));
}

/** The backends that ship with core: exact policy rules and 1.x heuristics. */
export const DEFAULT_REGISTRY: BackendRegistry = createRegistry([
	rulesBackend,
	heuristicBackend,
]);

export function selectBackend(
	registry: BackendRegistry,
	policy: Policy,
	type: DecisionType,
): Result<Backend, DecideError> {
	const named = policy.decisions[type]?.backend;
	const fallback = DECISION_CATALOG[type].defaultBackend;
	const backend =
		(named === undefined ? undefined : registry.get(named)) ??
		registry.get(fallback);
	return backend
		? { ok: true, value: backend }
		: {
				ok: false,
				error: { kind: "no_backend", type, backend: named ?? fallback },
			};
}

/** `policy` with `type` served by `backend`; every other field unchanged. */
export function withBackend(
	policy: Policy,
	type: DecisionType,
	backend: DecisionBackend,
): Policy {
	return {
		...policy,
		decisions: {
			...policy.decisions,
			[type]: { ...policy.decisions[type], backend },
		},
	};
}
