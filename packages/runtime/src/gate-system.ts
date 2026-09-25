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
import {
	type GateContext,
	loadPolicy,
	loadShellParser,
	readUserPolicy,
} from "@mainahq/core";
import {
	createGateEvaluator,
	type GateEvaluator,
	type GateEvaluatorDeps,
} from "./gate";
import { gitProbe, resolveRoot } from "./root";

/** Working directories whose root is remembered; the cache resets past this. */
const MAX_CACHED_ROOTS = 256;

type SystemOptions = Readonly<{
	/** Home directory for the user policy and `~` paths; the OS home by default. */
	home?: string;
}>;

function systemDeps(options: SystemOptions): GateEvaluatorDeps {
	const home = options.home ?? homedir();
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
		// defaults < user (`~/.maina/policy.json`, where `maina allow --always`
		// writes) < repo. Re-read per event, so a remembered override applies
		// at once; an unreadable user policy makes the event ask.
		policyFor: async (root) => {
			const user = await readUserPolicy({ fs: nodeFs }, home);
			if (!user.ok) return user;
			return loadPolicy({ fs: nodeFs }, root, user.value);
		},
		// A grammar that fails to load leaves `shell: null`: every shell event
		// is then opaque and asks.
		context: () => {
			context ??= loadShellParser().then((shell) => ({
				shell: shell.ok ? shell.value : null,
				home,
			}));
			return context;
		},
		clock: { now: () => performance.now() },
		newId: () => randomUUID(),
	};
}

export function systemGates(options: SystemOptions = {}): Readonly<{
	runtime: GateEvaluator;
	fallback: GateEvaluator;
}> {
	const deps = systemDeps(options);
	return {
		runtime: createGateEvaluator(deps, "full"),
		fallback: createGateEvaluator(deps, "rules_only"),
	};
}
