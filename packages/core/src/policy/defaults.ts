/**
 * Built-in policy: the base layer every user and repo policy merges onto.
 */

import { DECISION_CATALOG } from "../decide/types-catalog";
import { DEFAULT_PROTECTED_BRANCHES } from "../gate/events";
import {
	type ActionClassPolicy,
	DECISION_TYPES,
	type DecisionPolicy,
	type DecisionType,
	type Policy,
} from "./schema";

/**
 * The FR-GATE-4 set (deleting outside the workspace, force-pushing,
 * production data, deploys, credential access, package publishing) plus the
 * other actions whose effects cannot be undone from the working tree. They
 * default to `ask`; a layer may tighten them to `deny`, but only a layer that
 * names them in `explicitly_allow` may loosen them.
 */
export const IRREVERSIBLE_ACTION_CLASSES = [
	/** Any delete that targets a path outside the workspace. */
	"fs.delete.outside",
	/** `rm -rf`, `find -delete` and friends. */
	"fs.delete.recursive",
	/** `git push --force` / `--force-with-lease`. */
	"git.push.force",
	/** `git reset --hard`, `git clean -f`, `git checkout -- .`: discards uncommitted work. */
	"git.discard",
	/** `DROP`, `TRUNCATE`, unbounded `DELETE`. */
	"db.destructive",
	/** Any write to a production database or data store. */
	"db.production",
	/** Deploys and releases to a live environment (`vercel --prod`, `kubectl apply`, `wrangler deploy`). */
	"deploy",
	/** `npm publish` and other registry releases. */
	"package.publish",
	/** Piping a download into a shell (`curl … | sh`). */
	"remote.exec",
	/** Reading credentials: `.env`, `~/.ssh`, `~/.aws`, keychains. */
	"secrets.read",
	/** Writes to credential stores such as `~/.ssh` or `~/.aws`. */
	"secrets.write",
	/** Writes outside the workspace and temp dirs (`~/.zshrc`, `/etc/hosts`). */
	"fs.write.outside",
	/** Wiping disks and machines: `mkfs`, `dd` to a device, fork bombs, `shutdown`. */
	"system.destructive",
	/** Running as another user: `sudo`, `doas`, `su`, `pkexec`. */
	"privilege.escalate",
] as const;

/**
 * Irreversible classes denied by default, not merely asked about (#447).
 * Loosening one follows the same `explicitly_allow` rule as any other
 * irreversible class, and a repo layer's loosening still needs the user's
 * confirmation.
 */
export const DENIED_ACTION_CLASSES = [
	/**
	 * An agent changing its own gate: `maina allow`, a `maina policy`
	 * mutation, or a write, move or delete of a maina policy file or a host
	 * hook config (`.claude/settings*.json`, `.cursor/hooks.json`,
	 * `.codex/hooks.json`, `.codex/config.toml`). A human overrides from a
	 * terminal instead.
	 */
	"gate.self_override",
] as const;

/**
 * What an unattended run never does, whatever the policy says (FR-HAR-4):
 * merge (`pr.merge`, a plain push to a protected branch), release
 * (`deploy`) or publish (`package.publish`). These seed the unattended deny
 * list, and since deny lists accumulate across layers no policy can drop
 * them; the harness also denies them when a policy it is handed omits them.
 */
export const UNATTENDED_DENIED_ACTION_CLASSES = [
	"pr.merge",
	"git.push.protected",
	"deploy",
	"package.publish",
] as const;

const irreversible: ActionClassPolicy = { irreversible: true, verdict: "ask" };
const denied: ActionClassPolicy = { irreversible: true, verdict: "deny" };
const allowed: ActionClassPolicy = { irreversible: false, verdict: "allow" };
const asked: ActionClassPolicy = { irreversible: false, verdict: "ask" };

const REVERSIBLE_ACTION_CLASSES = {
	"shell.exec": allowed,
	/** A command the gate cannot see through (`eval "$X"`, `$CMD`, a syntax error). */
	"shell.opaque": asked,
	"fs.write": allowed,
	/** A read inside the workspace or temp dirs that is not a credential. */
	"fs.read": allowed,
	"fs.read.outside": asked,
	"git.commit": allowed,
	"git.push": allowed,
	/** A plain push to a protected branch (`main`, `master`, `protected_branches`). */
	"git.push.protected": asked,
	/**
	 * Merging a pull request (`gh pr merge`). Allowed at a terminal; an
	 * unattended run never merges.
	 */
	"pr.merge": allowed,
	"deps.install": allowed,
	"network.fetch": allowed,
	"mcp.call": allowed,
} as const satisfies Readonly<Record<string, ActionClassPolicy>>;

/** Every built-in action class; the gate classifier only produces these. */
export type ActionClass =
	| (typeof IRREVERSIBLE_ACTION_CLASSES)[number]
	| (typeof DENIED_ACTION_CLASSES)[number]
	| keyof typeof REVERSIBLE_ACTION_CLASSES;

/** Missing a risky action costs more than asking about a safe one. */
const SAFETY_CRITICAL: ReadonlySet<DecisionType> = new Set([
	"action.risk",
	"diff.sensitive",
]);

function defaultDecision(type: DecisionType): DecisionPolicy {
	const backend = DECISION_CATALOG[type].defaultBackend;
	return SAFETY_CRITICAL.has(type)
		? {
				backend,
				thresholds: { confidence: 0.9 },
				error_costs: { false_positive: 1, false_negative: 10 },
			}
		: {
				backend,
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
		...Object.fromEntries(DENIED_ACTION_CLASSES.map((id) => [id, denied])),
	},
	rules: { allow: [], deny: [] },
	protected_branches: DEFAULT_PROTECTED_BRANCHES,
	decisions: Object.fromEntries(
		DECISION_TYPES.map((type) => [type, defaultDecision(type)]),
	) as Record<DecisionType, DecisionPolicy>,
	drift: { window: 200, max_error_rate: 0.1, max_confidence_drop: 0.15 },
	telemetry: { crash_reports: false, usage: false, outcome_sharing: false },
	log: { paths: "hashed" },
	run: {
		interactive: { deny: [], budgets: {} },
		unattended: {
			deny: UNATTENDED_DENIED_ACTION_CLASSES,
			budgets: { wall_clock_minutes: 60, max_tool_calls: 500 },
		},
	},
	loosened: [],
};
