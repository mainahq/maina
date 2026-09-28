/**
 * Policy loading: validate every layer, then merge
 * defaults < managed < user < repo.
 *
 * Merge rules (FR-GATE-9):
 * - Scalars and nested objects merge key by key; the later layer wins.
 * - Rule lists accumulate (deduplicated), so no layer can drop a rule.
 * - Protected branches accumulate the same way: a layer can protect more
 *   branches, never unprotect one (including the default main and master).
 * - An irreversible action class can always be tightened, but loosening it
 *   (a looser verdict, or `irreversible: false`) is an error unless that
 *   layer lists the class in `explicitly_allow`. Allowed loosenings are
 *   recorded in `Policy.loosened`. A locked class (`gate.self_override`)
 *   cannot be loosened at all (#513).
 * - A class a layer introduces fails closed: no verdict means `ask`.
 * - Telemetry opt-ins can only be turned on by the user layer.
 * - Run contexts: deny lists accumulate like rules; budgets merge key by
 *   key, but a repo layer can only lower one.
 * - The managed layer (the org's bundle on an enrolled machine, #592) is a
 *   floor: for every action class and run budget it sets, a user or repo
 *   layer may tighten but never loosen. A loosening there is not an error
 *   (the gate must keep answering): the managed value wins and the attempt
 *   is recorded in `Policy.managed.overridden` for `maina doctor`. An
 *   unsigned managed layer (the cloud's signer is dark) only tightens: its
 *   `explicitly_allow` is dropped and it cannot raise a run budget. Without
 *   a managed layer the policy is exactly the v1 one.
 */

import { join } from "node:path";
import { defined, readJsonFile } from "../config/schema";
import type { Result } from "../db/index";
import type { CorePorts } from "../ports/index";
import { DEFAULT_POLICY } from "./defaults";
import type { ManagedLayer } from "./managed";
import {
	type ActionClassPolicy,
	type DecisionPolicy,
	type DecisionType,
	type FloorOverride,
	isLockedClass,
	type Loosening,
	type Policy,
	type PolicyError,
	type PolicyLayer,
	type PolicySource,
	parsePolicyLayer,
	RUN_CONTEXTS,
	type RulePolicy,
	type RunBudgetsPolicy,
	type RunContext,
	ruleKey,
	VERDICTS,
	type Verdict,
} from "./schema";

type Layer = Readonly<{
	source: PolicySource;
	file: string | undefined;
	value: PolicyLayer;
	/**
	 * An unsigned managed layer: like a repo layer, it cannot raise a run
	 * budget (and it carries no `explicitly_allow`).
	 */
	unsigned?: boolean;
}>;

type Merged = Readonly<{ policy: Policy; errors: readonly PolicyError[] }>;

/**
 * Baseline for a class a layer introduces. It fails closed (FR-GATE-3): a
 * class without a verdict resolves to `ask`, and a new irreversible class
 * starts at `ask`, so declaring it `allow` is a loosening like any other.
 */
function newClass(spec: Partial<ActionClassPolicy>): ActionClassPolicy {
	return { irreversible: spec.irreversible ?? false, verdict: "ask" };
}

function strictness(verdict: Verdict): number {
	return VERDICTS.indexOf(verdict);
}

function mergeActionClasses(base: Policy, layer: Layer): Merged {
	const errors: PolicyError[] = [];
	const loosened: Loosening[] = [];
	const classes: Record<string, ActionClassPolicy> = {
		...base.action_classes,
	};
	// A locked class stays locked even if a layer slipped past the schema.
	const unlocked = new Set(
		(layer.value.explicitly_allow ?? []).filter((id) => !isLockedClass(id)),
	);

	for (const [id, spec] of Object.entries(layer.value.action_classes ?? {})) {
		const prev = classes[id] ?? newClass(spec);
		const next: ActionClassPolicy = { ...prev, ...defined(spec) };
		const attempts = prev.irreversible
			? [
					...(next.irreversible ? [] : ["irreversible"]),
					...(strictness(next.verdict) < strictness(prev.verdict)
						? ["verdict"]
						: []),
				]
			: [];

		if (attempts.length > 0 && !unlocked.has(id)) {
			for (const field of attempts) {
				errors.push({
					kind: "loosening",
					source: layer.source,
					file: layer.file,
					path: `action_classes.${id}.${field}`,
					actionClass: id,
					message: isLockedClass(id)
						? `"${id}" cannot be loosened by any policy: only the user can pass it, by running maina allow in a terminal`
						: `"${id}" is irreversible: this layer may tighten it but not loosen it unless it lists "${id}" in explicitly_allow`,
				});
			}
			continue;
		}
		if (attempts.length > 0) {
			loosened.push({
				actionClass: id,
				source: layer.source,
				before: prev.verdict,
			});
		}
		classes[id] = next;
	}

	return {
		policy: {
			...base,
			action_classes: classes,
			loosened: [...base.loosened, ...loosened],
		},
		errors,
	};
}

function unionRules(
	base: readonly RulePolicy[],
	added: readonly RulePolicy[] | undefined,
): readonly RulePolicy[] {
	const seen = new Set(base.map(ruleKey));
	return [
		...base,
		...(added ?? []).filter((rule) => {
			if (seen.has(ruleKey(rule))) return false;
			seen.add(ruleKey(rule));
			return true;
		}),
	];
}

/** `base` then every id of `added` not already in it: nothing is dropped. */
function unionIds(
	base: readonly string[],
	added: readonly string[] | undefined,
): readonly string[] {
	return [...new Set([...base, ...(added ?? [])])];
}

type RunBudgetKey = keyof RunBudgetsPolicy;
const RUN_BUDGET_KEYS: readonly RunBudgetKey[] = [
	"wall_clock_minutes",
	"max_tool_calls",
];

/**
 * One context's budgets after `layer`: a later layer wins key by key, except
 * that a repo policy may only lower a budget (a cloned repository must not
 * raise what a run may spend). Raising one is an error at its path.
 */
function mergeBudgets(
	context: RunContext,
	base: RunBudgetsPolicy,
	added: RunBudgetsPolicy | undefined,
	layer: Layer,
): Readonly<{ budgets: RunBudgetsPolicy; errors: readonly PolicyError[] }> {
	const budgets: Partial<Record<RunBudgetKey, number>> = { ...base };
	const errors: PolicyError[] = [];
	for (const key of RUN_BUDGET_KEYS) {
		const value = added?.[key];
		if (value === undefined) continue;
		const limit = base[key];
		const lowerOnly = layer.source === "repo" || layer.unsigned === true;
		if (lowerOnly && limit !== undefined && value > limit) {
			const who = layer.unsigned === true ? "An unsigned managed" : "A repo";
			errors.push({
				kind: "invalid",
				source: layer.source,
				file: layer.file,
				path: `run.${context}.budgets.${key}`,
				message: `${who} policy can only lower a run budget: ${value} is above ${limit}`,
			});
			continue;
		}
		budgets[key] = value;
	}
	return { budgets, errors };
}

/** Deny lists accumulate; budgets merge per `mergeBudgets`. */
function mergeRun(
	base: Policy["run"],
	layer: Layer,
): Readonly<{ run: Policy["run"]; errors: readonly PolicyError[] }> {
	const merged = RUN_CONTEXTS.map((context) => {
		const spec = layer.value.run?.[context];
		const { budgets, errors } = mergeBudgets(
			context,
			base[context].budgets,
			spec?.budgets,
			layer,
		);
		const deny = unionIds(base[context].deny, spec?.deny);
		return { context, spec: { deny, budgets }, errors };
	});
	return {
		run: Object.fromEntries(
			merged.map(({ context, spec }) => [context, spec]),
		) as Policy["run"],
		errors: merged.flatMap(({ errors }) => errors),
	};
}

function mergeDecisions(
	base: Policy["decisions"],
	layer: PolicyLayer["decisions"],
): Policy["decisions"] {
	const merged: Record<DecisionType, DecisionPolicy> = { ...base };
	for (const [type, spec] of Object.entries(layer ?? {})) {
		const id = type as DecisionType;
		const prev = base[id];
		if (spec === undefined) continue;
		merged[id] = {
			backend: spec.backend ?? prev.backend,
			thresholds: { ...prev.thresholds, ...defined(spec.thresholds) },
			error_costs: { ...prev.error_costs, ...defined(spec.error_costs) },
		};
	}
	return merged;
}

function telemetryOptInErrors(base: Policy, layer: Layer): PolicyError[] {
	if (layer.source === "user") return [];
	return Object.entries(layer.value.telemetry ?? {})
		.filter(
			([key, on]) =>
				on === true &&
				base.telemetry[key as keyof Policy["telemetry"]] !== true,
		)
		.map(([key]) => ({
			kind: "invalid",
			source: layer.source,
			file: layer.file,
			path: `telemetry.${key}`,
			message: `Telemetry opt-ins can only be turned on in the user policy, not by a ${layer.source} policy`,
		}));
}

function mergeLayer(acc: Merged, layer: Layer): Merged {
	const classes = mergeActionClasses(acc.policy, layer);
	const run = mergeRun(acc.policy.run, layer);
	const { value } = layer;
	const policy: Policy = {
		...classes.policy,
		rules: {
			allow: unionRules(acc.policy.rules.allow, value.rules?.allow),
			deny: unionRules(acc.policy.rules.deny, value.rules?.deny),
		},
		protected_branches: unionIds(
			acc.policy.protected_branches,
			value.protected_branches,
		),
		decisions: mergeDecisions(acc.policy.decisions, value.decisions),
		drift: { ...acc.policy.drift, ...defined(value.drift) },
		telemetry: { ...acc.policy.telemetry, ...defined(value.telemetry) },
		log: { ...acc.policy.log, ...defined(value.log) },
		run: run.run,
		discovery: { ...acc.policy.discovery, ...defined(value.discovery) },
	};
	return {
		policy,
		errors: [
			...acc.errors,
			...classes.errors,
			...telemetryOptInErrors(acc.policy, layer),
			...run.errors,
		],
	};
}

// ── The managed floor (#592) ───────────────────────────────────────────────

/**
 * The managed layer as merged (an unsigned one without `explicitly_allow`)
 * and the policy right after it. Every later layer is held to `policy`'s
 * value for each action class and run budget `layer` names.
 */
type Floor = Readonly<{
	layer: PolicyLayer;
	policy: Policy;
	errors: readonly PolicyError[];
}>;

type Clamped = Readonly<{
	policy: Policy;
	overridden: readonly FloorOverride[];
}>;

function managedFloor(
	value: PolicyLayer,
	unsigned: boolean,
	info: Policy["managed"],
): Floor {
	const { explicitly_allow: _dropped, ...tightenOnly } = value;
	const layer: Layer = {
		source: "managed",
		file: undefined,
		value: unsigned ? tightenOnly : value,
		unsigned,
	};
	const merged = mergeLayer({ policy: DEFAULT_POLICY, errors: [] }, layer);
	return {
		layer: layer.value,
		errors: merged.errors,
		policy:
			info === undefined ? merged.policy : { ...merged.policy, managed: info },
	};
}

/**
 * The errors a managed layer has on its own: a signed one is held to the
 * rules of any layer; an unsigned one also loosens no irreversible class
 * (its `explicitly_allow` is dropped) and raises no run budget.
 */
export function managedLayerErrors(
	value: PolicyLayer,
	unsigned: boolean,
): readonly PolicyError[] {
	return managedFloor(value, unsigned, undefined).errors;
}

function clampClasses(policy: Policy, floor: Floor, layer: Layer): Clamped {
	const overridden: FloorOverride[] = [];
	const classes: Record<string, ActionClassPolicy> = {
		...policy.action_classes,
	};
	const clamped = new Set<string>();
	const note = (
		id: string,
		field: string,
		managed: FloorOverride["managed"],
		attempted: FloorOverride["attempted"],
	) =>
		overridden.push({
			source: layer.source,
			file: layer.file,
			path: `action_classes.${id}.${field}`,
			managed,
			attempted,
		});
	for (const id of Object.keys(floor.layer.action_classes ?? {})) {
		const min = floor.policy.action_classes[id];
		const now = classes[id];
		if (min === undefined || now === undefined) continue;
		let next = now;
		if (strictness(now.verdict) < strictness(min.verdict)) {
			note(id, "verdict", min.verdict, now.verdict);
			next = { ...next, verdict: min.verdict };
		}
		if (min.irreversible && !now.irreversible) {
			note(id, "irreversible", true, false);
			next = { ...next, irreversible: true };
		}
		if (next !== now) {
			classes[id] = next;
			clamped.add(id);
		}
	}
	return {
		policy: {
			...policy,
			action_classes: classes,
			// A loosening the floor undid did not happen.
			loosened: policy.loosened.filter(
				(l) => !(l.source === layer.source && clamped.has(l.actionClass)),
			),
		},
		overridden,
	};
}

function clampBudgets(policy: Policy, floor: Floor, layer: Layer): Clamped {
	const overridden: FloorOverride[] = [];
	const run = Object.fromEntries(
		RUN_CONTEXTS.map((context) => {
			const set = floor.layer.run?.[context]?.budgets ?? {};
			const budgets: Partial<Record<RunBudgetKey, number>> = {
				...policy.run[context].budgets,
			};
			for (const key of RUN_BUDGET_KEYS) {
				const max = floor.policy.run[context].budgets[key];
				const now = budgets[key];
				if (set[key] === undefined || max === undefined) continue;
				if (now !== undefined && now > max) {
					overridden.push({
						source: layer.source,
						file: layer.file,
						path: `run.${context}.budgets.${key}`,
						managed: max,
						attempted: now,
					});
				}
				if (now === undefined || now > max) budgets[key] = max;
			}
			return [context, { ...policy.run[context], budgets }];
		}),
	) as Policy["run"];
	return { policy: { ...policy, run }, overridden };
}

/** Merges a layer, then holds it to the managed floor when there is one. */
function mergeAboveFloor(floor: Floor | undefined) {
	return (acc: Merged, layer: Layer): Merged => {
		const merged = mergeLayer(acc, layer);
		if (floor === undefined) return merged;
		const classes = clampClasses(merged.policy, floor, layer);
		const budgets = clampBudgets(classes.policy, floor, layer);
		const info = budgets.policy.managed;
		if (info === undefined) return { ...merged, policy: budgets.policy };
		return {
			errors: merged.errors,
			policy: {
				...budgets.policy,
				managed: {
					...info,
					overridden: [
						...info.overridden,
						...classes.overridden,
						...budgets.overridden,
					],
				},
			},
		};
	};
}

async function readRepoLayer(
	ports: Pick<CorePorts, "fs">,
	file: string,
): Promise<Result<Layer | undefined, readonly PolicyError[]>> {
	const raw = await readJsonFile(ports.fs, file);
	if (!raw.ok) {
		return {
			ok: false,
			error: [
				{
					kind: raw.error.kind,
					source: "repo",
					file,
					path: "",
					message: raw.error.message,
				},
			],
		};
	}
	if (raw.value === undefined) return { ok: true, value: undefined };
	const parsed = parsePolicyLayer(raw.value, "repo", file);
	return parsed.ok
		? { ok: true, value: { source: "repo", file, value: parsed.value } }
		: parsed;
}

/** The user policy file under `home`: `~/.maina/policy.json`. */
export function userPolicyFile(home: string): string {
	return join(home, ".maina", "policy.json");
}

/**
 * The raw JSON of the user policy under `home`, for `loadPolicy`'s
 * `userDefault`; `undefined` when there is no file. An unreadable or
 * unparsable file is an error, never a silent default.
 */
export async function readUserPolicy(
	ports: Pick<CorePorts, "fs">,
	home: string,
): Promise<Result<unknown, readonly PolicyError[]>> {
	const file = userPolicyFile(home);
	const raw = await readJsonFile(ports.fs, file);
	if (raw.ok) return raw;
	return {
		ok: false,
		error: [
			{
				kind: raw.error.kind,
				source: "user",
				file,
				path: "",
				message: raw.error.message,
			},
		],
	};
}

/**
 * Loads the effective policy for `root`: the built-in defaults, then the
 * managed layer (the org's verified bundle on an enrolled machine, read by
 * the runtime; `undefined` otherwise), then the caller-supplied user default
 * (already read by the runtime; `undefined` when there is none), then
 * `<root>/.maina/policy.json`. Returns every validation and loosening error
 * from every layer at once.
 */
export async function loadPolicy(
	ports: Pick<CorePorts, "fs">,
	root: string,
	userDefault: unknown,
	managed?: ManagedLayer,
): Promise<Result<Policy, readonly PolicyError[]>> {
	const user =
		userDefault === undefined
			? undefined
			: parsePolicyLayer(userDefault, "user");
	const repo = await readRepoLayer(ports, join(root, ".maina", "policy.json"));

	const invalid = [
		...(user && !user.ok ? user.error : []),
		...(repo.ok ? [] : repo.error),
	];
	const layers: Layer[] = [
		...(user?.ok
			? [{ source: "user" as const, file: undefined, value: user.value }]
			: []),
		...(repo.ok && repo.value ? [repo.value] : []),
	];

	const floor =
		managed === undefined
			? undefined
			: managedFloor(managed.value, managed.signature === "unsigned", {
					version: managed.version,
					etag: managed.etag,
					signature: managed.signature,
					keyId: managed.keyId,
					issuedAt: managed.issuedAt,
					budgetDirectives: managed.budgetDirectives,
					overridden: [],
				});
	const merged = layers.reduce(mergeAboveFloor(floor), {
		policy: floor?.policy ?? DEFAULT_POLICY,
		errors: [...invalid, ...(floor?.errors ?? [])],
	});
	return merged.errors.length > 0
		? { ok: false, error: merged.errors }
		: { ok: true, value: merged.policy };
}
