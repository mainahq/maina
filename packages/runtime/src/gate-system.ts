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
import { join } from "node:path";
import { openDecisionDb } from "@mainahq/cli/src/decision-store";
import { nodeFs } from "@mainahq/cli/src/ports";
import {
	type GateContext,
	loadLogSalt,
	loadPolicy,
	loadShellParser,
	type Result,
	readUserPolicy,
} from "@mainahq/core";
import {
	createGateEvaluator,
	type GateEvaluator,
	type GateEvaluatorDeps,
	type GateLog,
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
		logFor: decisionLogs(),
	};
}

/**
 * Each root's decision log: `.maina/decisions.db`, keyed by the repo's
 * salt. The store is opened and the salt loaded once per root, then reused
 * for every event; a failure is not remembered, so the next event retries.
 * A root without `.maina/` keeps no log, so the gate never creates one.
 */
function decisionLogs(): (
	root: string,
) => Promise<Result<GateLog | null, unknown>> {
	type Opened = Result<Readonly<{ log: GateLog; close: () => void }>, unknown>;
	const logs = new Map<string, Promise<Opened>>();
	const open = async (root: string): Promise<Opened> => {
		// The salt first: a salt that cannot be loaded leaves no store behind.
		const salt = await loadLogSalt({ fs: nodeFs }, root);
		if (!salt.ok) return salt;
		const store = openDecisionDb(join(root, ".maina"));
		if (!store.ok) return store;
		const { db, close } = store.value;
		return {
			ok: true,
			value: { log: { db, salt: salt.value, now: () => Date.now() }, close },
		};
	};
	const evictAll = () => {
		for (const opening of logs.values()) {
			void opening.then((o) => o.ok && o.value.close());
		}
		logs.clear();
	};
	return async (root) => {
		let opening = logs.get(root);
		if (opening === undefined) {
			if (!(await nodeFs.exists(join(root, ".maina")))) {
				return { ok: true, value: null };
			}
			if (logs.size >= MAX_CACHED_ROOTS) evictAll();
			opening = open(root);
			logs.set(root, opening);
		}
		const opened = await opening;
		if (!opened.ok) {
			if (logs.get(root) === opening) logs.delete(root);
			return opened;
		}
		return { ok: true, value: opened.value.log };
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
