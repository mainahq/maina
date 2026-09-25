/**
 * Policy schema (FR-GATE-4, FR-GATE-9). Zod is the single source of truth:
 * `Policy` / `PolicyLayer` are inferred from it and
 * `schemas/policy.schema.json` is generated from it. See ADR 0043.
 *
 * Policy files use snake_case keys, the names the spec gives them
 * (`explicitly_allow`, `action_classes`, ...).
 */

import { z } from "zod";
import {
	type DeepReadonly,
	type SchemaIssue,
	toSchemaIssues,
} from "../config/schema";
import type { Result } from "../db/index";

// ── Catalogs ────────────────────────────────────────────────────────────────

/** Gate outcomes, loosest first: a higher index is stricter. */
export const VERDICTS = ["allow", "ask", "deny"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Normalised gate event kinds a rule can be scoped to (spec §6.2). */
export const GATE_EVENT_KINDS = [
	"shell",
	"file.write",
	"file.read.outside",
	"mcp",
	"network",
] as const;

/** Every decision type `decide` answers (FR-DEC-1). */
export const DECISION_TYPES = [
	"action.risk",
	"diff.sensitive",
	"diff.needs_review",
	"task.tier",
	"finding.real",
	"finding.severity",
	"spec.coverage",
	"spec.orphan",
	"spec.contradiction",
	"spec.impl_leak",
	"spec.quality",
	"review.category",
	"review.reviewer_kind",
	"slop",
	"wiki.relevance",
	"context.select",
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

/** Backends a decision type can be served by. */
const DECISION_BACKENDS = ["rules", "heuristic", "system1"] as const;
export type DecisionBackend = (typeof DECISION_BACKENDS)[number];

export type PolicySource = "user" | "repo";

// ── Building blocks ─────────────────────────────────────────────────────────

const ActionClassId = z
	.string()
	.regex(
		/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/,
		"Expected a dotted lower-case id such as package.publish",
	);

const ActionClassSpec = z.strictObject({
	irreversible: z
		.boolean()
		.describe(
			"Irreversible classes can be tightened by any layer but loosened only when the layer lists them in explicitly_allow.",
		),
	verdict: z
		.enum(VERDICTS)
		.describe("Gate outcome when an action falls in this class."),
});

const Rule = z.strictObject({
	match: z.string().min(1).describe("Command, path glob or tool name."),
	kind: z
		.enum(GATE_EVENT_KINDS)
		.describe("Event kind the rule applies to; every kind when omitted.")
		.optional(),
	exact: z
		.boolean()
		.describe(
			"Match the whole string literally: no `*` globbing and, for a shell rule, no extra arguments. `maina allow --always` writes exact rules.",
		)
		.optional(),
	reason: z.string().min(1).optional(),
});

const probability = z.number().min(0).max(1);

const Thresholds = z.strictObject({
	confidence: probability.describe(
		"Minimum confidence at which the backend's answer is acted on.",
	),
});

const ErrorCosts = z.strictObject({
	false_positive: z.number().nonnegative(),
	false_negative: z.number().nonnegative(),
});

const DecisionSpec = z.strictObject({
	backend: z.enum(DECISION_BACKENDS),
	thresholds: Thresholds,
	error_costs: ErrorCosts.describe(
		"Relative cost of each error kind, used by routing and promotion.",
	),
});

const Drift = z.strictObject({
	window: z
		.number()
		.int()
		.positive()
		.describe("Number of recent decisions the drift guard looks at."),
	max_error_rate: probability.describe(
		"Error rate above which a decision type is demoted.",
	),
	max_confidence_drop: probability.describe(
		"Drop in mean confidence above which a decision type is demoted.",
	),
});

const Telemetry = z.strictObject({
	crash_reports: z.boolean(),
	usage: z.boolean(),
	outcome_sharing: z.boolean(),
});

/** How the decision log stores free-form options such as file paths. */
const LOG_PATH_MODES = ["hashed", "plain"] as const;

const Log = z.strictObject({
	paths: z
		.enum(LOG_PATH_MODES)
		.describe(
			"hashed (default): the decision log stores paths and other free-form options only as hashes keyed by a per-repo salt. plain: stores them as-is.",
		),
});

// ── Resolved policy ─────────────────────────────────────────────────────────

const PolicyBody = z.strictObject({
	action_classes: z.record(ActionClassId, ActionClassSpec),
	rules: z.strictObject({ allow: z.array(Rule), deny: z.array(Rule) }),
	decisions: z.record(z.enum(DECISION_TYPES), DecisionSpec),
	drift: Drift,
	telemetry: Telemetry,
	log: Log,
});

/**
 * An irreversible class a layer deliberately loosened via `explicitly_allow`.
 * `before` is the class's verdict ahead of that layer, so a consumer that
 * does not trust the layer can restore it (a user-level `deny` stays `deny`).
 */
export type Loosening = Readonly<{
	actionClass: string;
	source: PolicySource;
	before: Verdict;
}>;

/** The effective policy: defaults < user < repo, plus an audit of loosenings. */
export type Policy = DeepReadonly<z.infer<typeof PolicyBody>> &
	Readonly<{ loosened: readonly Loosening[] }>;

export type ActionClassPolicy = Policy["action_classes"][string];
export type RulePolicy = Policy["rules"]["allow"][number];
export type DecisionPolicy = Policy["decisions"][DecisionType];

/**
 * What makes two rules the same rule: kind, match and exactness. An exact
 * rule and a pattern with the same `match` cover different actions, so
 * neither may stand in for the other when rule lists are merged.
 */
export const ruleKey = (rule: RulePolicy): string =>
	`${rule.kind ?? "*"}\u0000${rule.exact === true ? "=" : "~"}\u0000${rule.match}`;

// ── One layer (a policy file) ───────────────────────────────────────────────

const PolicyLayerSchema = z
	.strictObject({
		$schema: z.string().optional(),
		version: z.literal(1).optional(),
		explicitly_allow: z
			.array(ActionClassId)
			.describe(
				"Irreversible action classes this layer is allowed to loosen. Anything else it tries to loosen is an error.",
			)
			.optional(),
		action_classes: z
			.record(ActionClassId, ActionClassSpec.partial())
			.optional(),
		rules: z
			.strictObject({
				allow: z.array(Rule).optional(),
				deny: z.array(Rule).optional(),
			})
			.describe("Rule lists accumulate across layers; none can be removed.")
			.optional(),
		decisions: z
			.partialRecord(
				z.enum(DECISION_TYPES),
				z.strictObject({
					backend: z.enum(DECISION_BACKENDS).optional(),
					thresholds: Thresholds.partial().optional(),
					error_costs: ErrorCosts.partial().optional(),
				}),
			)
			.optional(),
		drift: Drift.partial().optional(),
		telemetry: Telemetry.partial()
			.describe("Opt-ins. Only the user policy can turn one on.")
			.optional(),
		log: Log.partial()
			.describe("What the local decision log keeps in the clear.")
			.optional(),
	})
	.meta({
		title: "Maina policy",
		description:
			"Gate policy read from .maina/policy.json (repo) and the user default. Merge order: defaults < user < repo.",
	});

/** What one policy file may contain: every key optional. */
export type PolicyLayer = DeepReadonly<z.infer<typeof PolicyLayerSchema>>;

type PolicyErrorBase = Readonly<{
	source: PolicySource;
	/** Absolute path of the file, when the layer came from one. */
	file: string | undefined;
	/** Dotted path inside the layer; `""` for the root or a whole-file error. */
	path: string;
	message: string;
}>;

export type PolicyError = PolicyErrorBase &
	(
		| Readonly<{ kind: "invalid" | "parse" | "io" }>
		| Readonly<{ kind: "loosening"; actionClass: string }>
	);

/** Validates one policy layer and reports every violation with its path. */
export function parsePolicyLayer(
	raw: unknown,
	source: PolicySource = "repo",
	file?: string,
): Result<PolicyLayer, readonly PolicyError[]> {
	const parsed = PolicyLayerSchema.safeParse(raw);
	if (parsed.success) return { ok: true, value: parsed.data };
	return {
		ok: false,
		error: toSchemaIssues(parsed.error).map(
			(issue: SchemaIssue): PolicyError => ({
				kind: "invalid",
				source,
				file,
				...issue,
			}),
		),
	};
}

/** JSON Schema for policy files, generated from the zod schema. */
export function policyJsonSchema(): Readonly<Record<string, unknown>> {
	return z.toJSONSchema(PolicyLayerSchema, { io: "input" });
}
