/**
 * The real gate evaluators (FR-GATE-1, FR-GATE-3): `createGateEvaluator`
 * over the machine's git, filesystem, clock and the bash grammar.
 *
 * `runtime` is what the resident daemon answers `hook.evaluate` with;
 * `fallback` is the rules-only evaluation the hook client runs in process
 * when no runtime answers. Both share one set of caches: the grammar loads
 * once, and each working directory's repository root is looked up once.
 */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { nodeFs } from "@mainahq/cli/src/ports";
import { type GateContext, loadPolicy, loadShellParser } from "@mainahq/core";
import {
	createGateEvaluator,
	type GateEvaluator,
	type GateEvaluatorDeps,
} from "./gate";
import { gitProbe, resolveRoot } from "./root";

/** Working directories whose root is remembered; the cache resets past this. */
const MAX_CACHED_ROOTS = 256;

function systemDeps(): GateEvaluatorDeps {
	const roots = new Map<string, string>();
	let context: Promise<GateContext> | null = null;
	return {
		rootOf: (cwd) => {
			const cached = roots.get(cwd);
			if (cached !== undefined) return cached;
			const resolved = resolveRoot({ cwd }, gitProbe);
			if (!resolved.ok) return null;
			if (roots.size >= MAX_CACHED_ROOTS) roots.clear();
			roots.set(cwd, resolved.value.path);
			return resolved.value.path;
		},
		// No user-level policy file exists yet, so only the repo layer loads.
		policyFor: (root) => loadPolicy({ fs: nodeFs }, root, undefined),
		// A grammar that fails to load leaves `shell: null`: every shell event
		// is then opaque and asks.
		context: () => {
			context ??= loadShellParser().then((shell) => ({
				shell: shell.ok ? shell.value : null,
				home: homedir(),
			}));
			return context;
		},
		clock: { now: () => performance.now() },
		newId: () => randomUUID(),
	};
}

export function systemGates(): Readonly<{
	runtime: GateEvaluator;
	fallback: GateEvaluator;
}> {
	const deps = systemDeps();
	return {
		runtime: createGateEvaluator(deps, "full"),
		fallback: createGateEvaluator(deps, "rules_only"),
	};
}
