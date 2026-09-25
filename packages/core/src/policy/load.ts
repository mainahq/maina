/**
 * Policy loading: validate every layer, then merge defaults < user < repo.
 *
 * Merge rules (FR-GATE-9):
 * - Scalars and nested objects merge key by key; the later layer wins.
 * - Rule lists accumulate (deduplicated), so no layer can drop a rule.
 * - An irreversible action class can always be tightened, but loosening it
 *   (a looser verdict, or `irreversible: false`) is an error unless that
 *   layer lists the class in `explicitly_allow`. Allowed loosenings are
 *   recorded in `Policy.loosened`.
 * - Telemetry opt-ins can only be turned on by the user layer.
 */

import { join } from "node:path";
import { defined, readJsonFile } from "../config/schema";
import type { Result } from "../db/index";
import type { CorePorts } from "../ports/index";
import { DEFAULT_POLICY } from "./defaults";
import {
	type ActionClassPolicy,
	type DecisionPolicy,
	type DecisionType,
	type Loosening,
	type Policy,
	type PolicyError,
	type PolicyLayer,
	type PolicySource,
	parsePolicyLayer,
	type RulePolicy,
	VERDICTS,
	type Verdict,
} from "./schema";

type Layer = Readonly<{
	source: PolicySource;
	file: string | undefined;
	value: PolicyLayer;
}>;

type Merged = Readonly<{ policy: Policy; errors: readonly PolicyError[] }>;

const NEW_CLASS: ActionClassPolicy = { irreversible: false, verdict: "allow" };

function strictness(verdict: Verdict): number {
	return VERDICTS.indexOf(verdict);
}

function mergeActionClasses(base: Policy, layer: Layer): Merged {
	const errors: PolicyError[] = [];
	const loosened: Loosening[] = [];
	const classes: Record<string, ActionClassPolicy> = {
		...base.action_classes,
	};
	const unlocked = new Set(layer.value.explicitly_allow ?? []);

	for (const [id, spec] of Object.entries(layer.value.action_classes ?? {})) {
		const prev = classes[id] ?? NEW_CLASS;
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
					message: `"${id}" is irreversible: this layer may tighten it but not loosen it unless it lists "${id}" in explicitly_allow`,
				});
			}
			continue;
		}
		if (attempts.length > 0) {
			loosened.push({ actionClass: id, source: layer.source });
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
	const key = (rule: RulePolicy) => `${rule.kind ?? "*"}\u0000${rule.match}`;
	const seen = new Set(base.map(key));
	return [
		...base,
		...(added ?? []).filter((rule) => {
			if (seen.has(key(rule))) return false;
			seen.add(key(rule));
			return true;
		}),
	];
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
	const { value } = layer;
	const policy: Policy = {
		...classes.policy,
		rules: {
			allow: unionRules(acc.policy.rules.allow, value.rules?.allow),
			deny: unionRules(acc.policy.rules.deny, value.rules?.deny),
		},
		decisions: mergeDecisions(acc.policy.decisions, value.decisions),
		drift: { ...acc.policy.drift, ...defined(value.drift) },
		telemetry: { ...acc.policy.telemetry, ...defined(value.telemetry) },
	};
	return {
		policy,
		errors: [
			...acc.errors,
			...classes.errors,
			...telemetryOptInErrors(acc.policy, layer),
		],
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

/**
 * Loads the effective policy for `root`: the built-in defaults, then the
 * caller-supplied user default (already read by the runtime; `undefined`
 * when there is none), then `<root>/.maina/policy.json`. Returns every
 * validation and loosening error from every layer at once.
 */
export async function loadPolicy(
	ports: Pick<CorePorts, "fs">,
	root: string,
	userDefault: unknown,
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

	const merged = layers.reduce(mergeLayer, {
		policy: DEFAULT_POLICY,
		errors: invalid,
	});
	return merged.errors.length > 0
		? { ok: false, error: merged.errors }
		: { ok: true, value: merged.policy };
}
