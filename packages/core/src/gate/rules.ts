/**
 * The rules engine (FR-GATE-2, FR-GATE-4, spec §6.2): the deterministic first
 * stage of the gate. It turns a normalised event and the resolved policy into
 * one of four results, in strict order of precedence:
 *
 *   1. a matching deny rule            → deny (final)
 *   2. an action class set to deny     → deny (final)
 *   3. an irreversible class at `ask`  → ask (irreversible)   ← beats allow rules
 *   4. a matching allow rule           → allow (listed)
 *   5. a reversible class at `ask`     → ask
 *   6. an explicitly allowed class     → allow (listed)
 *   7. nothing matched                 → no_rule
 *
 * A deny is final. `settleVerdict` lets a later stage (a model, the host)
 * decide a `no_rule` and tighten an `ask` or a listed allow, but it can never loosen a deny or an
 * irreversible ask into an allow: no allow rule, loosened class, permission
 * mode or untrusted input reaches this decision.
 */

import { DEFAULT_POLICY } from "../policy/defaults";
import type { Policy, RulePolicy, Verdict } from "../policy/schema";
import { analyzeAction } from "./classify";
import type { GateContext, GateEvent, GateEventKind } from "./events";

export type RuleResult =
	| Readonly<{
			kind: "deny";
			final: true;
			source: "rule" | "class";
			reason: string;
			classes: readonly string[];
	  }>
	| Readonly<{
			kind: "allow";
			listed: true;
			source: "rule" | "explicitly_allow";
			reason: string;
			classes: readonly string[];
	  }>
	| Readonly<{
			kind: "ask";
			irreversible: boolean;
			reason: string;
			classes: readonly string[];
	  }>
	| Readonly<{ kind: "no_rule"; classes: readonly string[] }>;

export function evaluateRules(
	event: GateEvent,
	policy: Policy,
	ctx: GateContext,
): RuleResult {
	const analysis = analyzeAction(event, ctx);
	const classes = analysis.classes;
	// A class the policy does not list keeps its built-in spec, so a partial
	// policy can never make an irreversible class disappear (fail closed).
	const specs = classes.map((c) => ({
		id: c,
		spec: policy.action_classes[c] ?? DEFAULT_POLICY.action_classes[c],
	}));

	// 1. A deny rule is final and beats everything.
	const denyRule = firstMatch(policy.rules.deny, event, analysis.commands);
	if (denyRule) {
		return {
			kind: "deny",
			final: true,
			source: "rule",
			reason:
				denyRule.reason ?? `denied by rule ${JSON.stringify(denyRule.match)}`,
			classes,
		};
	}

	// 2. A class the policy sets to deny is final too.
	const denyClass = specs.find((s) => s.spec?.verdict === "deny");
	if (denyClass) {
		return {
			kind: "deny",
			final: true,
			source: "class",
			reason: `action class ${denyClass.id} is denied`,
			classes,
		};
	}

	// 3. An irreversible class at `ask` asks — before any allow rule can fire.
	const irreversibleAsk = specs.find(
		(s) => s.spec?.irreversible === true && s.spec.verdict === "ask",
	);
	if (irreversibleAsk) {
		return {
			kind: "ask",
			irreversible: true,
			reason: `${irreversibleAsk.id} is irreversible`,
			classes,
		};
	}

	// 4. A matching allow rule allows.
	const allowRule = matchesAllow(policy.rules.allow, event, analysis.commands);
	if (allowRule) {
		return {
			kind: "allow",
			listed: true,
			source: "rule",
			reason:
				allowRule.reason ??
				`allowed by rule ${JSON.stringify(allowRule.match)}`,
			classes,
		};
	}

	// 5. A reversible class at `ask` asks.
	const reversibleAsk = specs.find((s) => s.spec?.verdict === "ask");
	if (reversibleAsk) {
		return {
			kind: "ask",
			irreversible: false,
			reason: `${reversibleAsk.id} needs confirmation`,
			classes,
		};
	}

	// 6. An irreversible class the policy explicitly allowed is a listed allow.
	const loosened = new Set(policy.loosened.map((l) => l.actionClass));
	const allowedClass = specs.find(
		(s) => s.spec?.verdict === "allow" && loosened.has(s.id),
	);
	if (allowedClass) {
		return {
			kind: "allow",
			listed: true,
			source: "explicitly_allow",
			reason: `${allowedClass.id} is explicitly allowed`,
			classes,
		};
	}

	// 7. No rule and no risky class: defer to the later stages.
	return { kind: "no_rule", classes };
}

/**
 * Folds a rule result and a later stage's verdict into the final verdict.
 * Tightening is always allowed; loosening is not. A `no_rule` with no later
 * verdict fails closed to `ask`.
 */
export function settleVerdict(
	result: RuleResult,
	later: Verdict | undefined,
): Verdict {
	switch (result.kind) {
		case "deny":
			return "deny";
		case "allow":
			// A later stage may still tighten a listed allow, to ask or deny.
			return later ?? "allow";
		case "ask":
			return later === "deny" ? "deny" : "ask";
		case "no_rule":
			return later ?? "ask";
		default:
			return "ask";
	}
}

// ── Matching ────────────────────────────────────────────────────────────────

function appliesTo(rule: RulePolicy, kind: GateEventKind): boolean {
	return rule.kind === undefined || rule.kind === kind;
}

function firstMatch(
	rules: readonly RulePolicy[],
	event: GateEvent,
	commands: readonly string[],
): RulePolicy | undefined {
	return rules.find(
		(rule) =>
			appliesTo(rule, event.kind) && ruleMatchesAny(rule, event, commands),
	);
}

/**
 * An allow rule fires only when it covers the action. For a shell line that
 * means every command in it matches: one unmatched command (an unexpected
 * `&& curl …`) means the line is not allowed.
 */
function matchesAllow(
	rules: readonly RulePolicy[],
	event: GateEvent,
	commands: readonly string[],
): RulePolicy | undefined {
	const applicable = rules.filter((rule) => appliesTo(rule, event.kind));
	if (event.kind !== "shell") {
		return applicable.find((rule) =>
			targetsFor(rule, event).some((t) => targetMatches(rule, t)),
		);
	}
	if (commands.length === 0) return undefined;
	return applicable.find((rule) =>
		commands.every((command) => commandMatches(rule, command)),
	);
}

function ruleMatchesAny(
	rule: RulePolicy,
	event: GateEvent,
	commands: readonly string[],
): boolean {
	if (event.kind === "shell") {
		return commands.some((command) => commandMatches(rule, command));
	}
	return targetsFor(rule, event).some((t) => targetMatches(rule, t));
}

/**
 * The strings `rule` can match for a non-shell event. An `exact` rule names
 * the whole path, URL or qualified tool, so it never matches a basename, a
 * host or a bare tool name the way a pattern can.
 */
function targetsFor(rule: RulePolicy, event: GateEvent): readonly string[] {
	if (rule.exact !== true) return targetsOf(event);
	switch (event.kind) {
		case "file.write":
		case "file.read.outside":
			return [event.action.path];
		case "mcp":
			return [
				`${event.action.server}/${event.action.tool}`,
				`mcp__${event.action.server}__${event.action.tool}`,
			];
		case "network":
			return [event.action.url];
		case "shell":
			return [];
		default: {
			const unreachable: never = event;
			return unreachable;
		}
	}
}

/** The strings a non-shell pattern rule can match against. */
function targetsOf(event: GateEvent): readonly string[] {
	switch (event.kind) {
		case "file.write":
		case "file.read.outside":
			return [event.action.path, basename(event.action.path)];
		case "mcp":
			return [
				event.action.tool,
				`${event.action.server}/${event.action.tool}`,
				`mcp__${event.action.server}__${event.action.tool}`,
			];
		case "network": {
			const host = hostOf(event.action.url);
			return host === null ? [event.action.url] : [event.action.url, host];
		}
		default:
			return [];
	}
}

/**
 * Matches a rule against one command string. An `exact` rule matches only
 * the identical command (a `*` in it is literal). Otherwise a pattern with a
 * `*` is a whole-string glob in which `*` matches anything, paths and URLs
 * included (`curl *` covers `curl https://x/y`), and a plain pattern matches
 * the command name and its argument prefix (`git push` covers `git push
 * origin main`).
 */
function commandMatches(rule: RulePolicy, command: string): boolean {
	const pattern = rule.match;
	if (rule.exact === true) return command === pattern;
	if (pattern.includes("*")) return wildcardMatch(pattern, command);
	return command === pattern || command.startsWith(`${pattern} `);
}

/** Matches a rule against a path, tool or URL: literal when `exact`, else a glob. */
function targetMatches(rule: RulePolicy, target: string): boolean {
	return rule.exact === true
		? target === rule.match
		: globMatch(rule.match, target);
}

/**
 * Whole-string match where each `*` matches any run of characters. A
 * two-pointer scan that backtracks only to the last `*`, so it is
 * O(pattern × value) however many stars the pattern has: a long command can
 * never stall the gate the way a backtracking regex (`^.* .* .*x$`) can.
 */
function wildcardMatch(pattern: string, value: string): boolean {
	let p = 0;
	let v = 0;
	let star = -1;
	let resume = 0;
	while (v < value.length) {
		if (p < pattern.length && pattern[p] === "*") {
			star = p++;
			resume = v;
		} else if (p < pattern.length && pattern[p] === value[v]) {
			p++;
			v++;
		} else if (star >= 0) {
			p = star + 1;
			v = ++resume;
		} else return false;
	}
	while (p < pattern.length && pattern[p] === "*") p++;
	return p === pattern.length;
}

/**
 * A `*` / `**` path glob anchored over the whole string: `*` matches within
 * a segment and `**` across segments. Built by scanning so the two never
 * interfere.
 */
function globMatch(pattern: string, value: string): boolean {
	let regex = "";
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i] as string;
		if (c === "*") {
			if (pattern[i + 1] === "*") {
				regex += ".*";
				i++;
			} else regex += "[^/]*";
		} else {
			regex += c.replace(/[.+?^${}()|[\]\\]/, "\\$&");
		}
	}
	return new RegExp(`^${regex}$`).test(value);
}

function basename(path: string): string {
	return path.split("/").at(-1) ?? path;
}

function hostOf(url: string): string | null {
	const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
	if (match?.[1] === undefined) return null;
	return match[1].replace(/^[^@]*@/, "").replace(/:\d+$/, "");
}
