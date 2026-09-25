/**
 * Built-in policy: the base layer every user and repo policy merges onto.
 */

import {
	type ActionClassPolicy,
	DECISION_TYPES,
	type DecisionPolicy,
	type DecisionType,
	type Policy,
} from "./schema";

/**
 * The FR-GATE-4 set: actions whose effects cannot be undone from the working
 * tree. They default to `ask`; a layer may tighten them to `deny`, but only a
 * layer that names them in `explicitly_allow` may loosen them.
 */
export const IRREVERSIBLE_ACTION_CLASSES = [
	/** `rm -rf`, `find -delete` and friends. */
	"fs.delete.recursive",
	/** `git push --force` / `--force-with-lease`. */
	"git.push.force",
	/** `git reset --hard`, `git clean -f`, `git checkout -- .`: discards uncommitted work. */
	"git.discard",
	/** `DROP`, `TRUNCATE`, unbounded `DELETE`. */
	"db.destructive",
	/** `npm publish` and other registry releases. */
	"package.publish",
	/** Piping a download into a shell (`curl … | sh`). */
	"remote.exec",
	/** Writes to credential stores such as `~/.ssh` or `~/.aws`. */
	"secrets.write",
] as const;

const irreversible: ActionClassPolicy = { irreversible: true, verdict: "ask" };
const allowed: ActionClassPolicy = { irreversible: false, verdict: "allow" };

const REVERSIBLE_ACTION_CLASSES: Readonly<Record<string, ActionClassPolicy>> = {
	"shell.exec": allowed,
	"fs.write": allowed,
	"fs.read.outside": { irreversible: false, verdict: "ask" },
	"secrets.read": { irreversible: false, verdict: "ask" },
	"git.commit": allowed,
	"git.push": allowed,
	"deps.install": allowed,
	"network.fetch": allowed,
	"mcp.call": allowed,
};

/** Missing a risky action costs more than asking about a safe one. */
const SAFETY_CRITICAL: ReadonlySet<DecisionType> = new Set([
	"action.risk",
	"diff.sensitive",
]);

function defaultDecision(type: DecisionType): DecisionPolicy {
	return SAFETY_CRITICAL.has(type)
		? {
				backend: type === "action.risk" ? "rules" : "heuristic",
				thresholds: { confidence: 0.9 },
				error_costs: { false_positive: 1, false_negative: 10 },
			}
		: {
				backend: "heuristic",
				thresholds: { confidence: 0.8 },
				error_costs: { false_positive: 1, false_negative: 1 },
			};
}

export const DEFAULT_POLICY: Policy = {
	action_classes: {
		...REVERSIBLE_ACTION_CLASSES,
		...Object.fromEntries(
			IRREVERSIBLE_ACTION_CLASSES.map((id) => [id, irreversible]),
		),
	},
	rules: { allow: [], deny: [] },
	decisions: Object.fromEntries(
		DECISION_TYPES.map((type) => [type, defaultDecision(type)]),
	) as Record<DecisionType, DecisionPolicy>,
	drift: { window: 200, max_error_rate: 0.1, max_confidence_drop: 0.15 },
	telemetry: { crash_reports: false, usage: false, outcome_sharing: false },
	loosened: [],
};
