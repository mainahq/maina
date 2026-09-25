/**
 * `evaluateGate` (FR-GATE-2, FR-GATE-3, FR-GATE-5, FR-GATE-6, spec §6.2): the
 * whole gate for one normalised event. Three stages, in order:
 *
 *   1. trust    — the policy is narrowed to what this machine's user stands
 *                 behind: an irreversible class counts as loosened only when
 *                 the user layer's `explicitly_allow` lists it, or a repo
 *                 layer's does and the user confirmed that class. Any other
 *                 irreversible class goes back to `ask` (or stays `deny`),
 *                 whatever the policy says.
 *   2. rules    — `evaluateRules` over the narrowed policy. A deny is final.
 *   3. decide   — `decide("action.risk")` with the policy's backend. Its
 *                 answer is folded in by `settleVerdict`, so it can tighten a
 *                 rule result or decide a `no_rule`, never loosen a result.
 *
 * Fail closed: a backend error, an answer slower than the budget, one below
 * the policy's confidence threshold, a two-order disagreement, a malformed
 * event or any unexpected failure asks. Only Maina-computed values from
 * closed catalogs (class ids, the event kind, the rule outcome, the
 * permission mode) go into the trusted segment of the decide request;
 * everything the agent or the repository wrote goes into the untrusted one.
 */

import { type DecidePorts, decide } from "../decide/decide";
import { type BackendRegistry, selectBackend } from "../decide/registry";
import type { DecideError, DecideRequest, Decision } from "../decide/types";
import { DEFAULT_POLICY } from "../policy/defaults";
import {
	type ActionClassPolicy,
	GATE_EVENT_KINDS,
	type Policy,
	VERDICTS,
	type Verdict,
} from "../policy/schema";
import type { ClockPort } from "../ports/clock";
import type { GateContext, GateEvent, PermissionMode } from "./events";
import { evaluateRules, type RuleResult, settleVerdict } from "./rules";

export type GatePorts = Readonly<{
	/** Times the decide stage against `budgetMs`. */
	clock: ClockPort;
	backends: BackendRegistry;
	ctx: GateContext;
	/** A fresh id per evaluation; decision ids derive from it. */
	newId: () => string;
	/** Longest the decide stage may take; a slower answer asks. */
	budgetMs?: number;
	/**
	 * Irreversible classes a repo policy loosened that the user confirmed at
	 * user level. A repo loosening not listed here is ignored: a cloned
	 * repository cannot unlock an irreversible class on its own.
	 */
	confirmedLoosenings?: readonly string[];
}>;

export type GateResult = Readonly<{
	verdict: Verdict;
	reason: string;
	/** Ids of the `action.risk` decisions behind the verdict, for the log. */
	decisionIds: readonly string[];
	/** The gate could not run in full (no model answer, no shell grammar). */
	degraded: boolean;
	/** A rewrite of the tool input for the host to run instead. */
	rewrittenInput?: Readonly<Record<string, unknown>>;
}>;

/** Default decide-stage budget. */
export const DEFAULT_GATE_BUDGET_MS = 250;

const PERMISSION_MODES: readonly PermissionMode[] = [
	"default",
	"plan",
	"accept_edits",
	"bypass",
	"unknown",
];

export function evaluateGate(
	ports: GatePorts,
	event: GateEvent,
	policy: Policy,
): GateResult {
	try {
		return evaluate(ports, event, policy);
	} catch (e) {
		return ask(`maina gate failed (${message(e)})`, [], true);
	}
}

function evaluate(
	ports: GatePorts,
	event: GateEvent,
	policy: Policy,
): GateResult {
	if (!(GATE_EVENT_KINDS as readonly string[]).includes(event.kind)) {
		return ask(
			`unknown gate event kind ${JSON.stringify(event.kind)}`,
			[],
			true,
		);
	}
	const narrowed = trustPolicy(policy, ports.confirmedLoosenings ?? []);
	const rules = evaluateRules(event, narrowed.policy, ports.ctx);
	// Without the grammar every shell event is opaque: the rules ask.
	const blind = event.kind === "shell" && ports.ctx.shell === null;
	const reason = [
		ruleReason(rules),
		...rules.classes
			.filter((c) => narrowed.ignored.has(c))
			.map(
				(c) =>
					`the repo policy's explicitly_allow for ${c} needs user confirmation`,
			),
	].join("; ");
	if (rules.kind === "deny") {
		return { verdict: "deny", reason, decisionIds: [], degraded: blind };
	}

	const highRisk =
		rules.classes.some((c) => isIrreversible(c, policy)) ||
		(Array.isArray(event.untrusted) && event.untrusted.length > 0);
	const model = consultModel(ports, event, rules, narrowed.policy, highRisk);
	return {
		verdict: settleVerdict(rules, model.verdict),
		reason: model.note === undefined ? reason : `${reason}; ${model.note}`,
		decisionIds: model.ids,
		degraded: blind || model.degraded,
	};
}

// ── Stage 1: trust ──────────────────────────────────────────────────────────

type Narrowed = Readonly<{
	policy: Policy;
	/** Loosened classes the user does not stand behind. */
	ignored: ReadonlySet<string>;
}>;

function isIrreversible(id: string, policy: Policy): boolean {
	return (
		DEFAULT_POLICY.action_classes[id]?.irreversible === true ||
		policy.action_classes[id]?.irreversible === true
	);
}

/**
 * `policy` with every irreversible class the user does not stand behind put
 * back to `ask`, or to `deny` when the policy or any verdict an untrusted
 * layer loosened says `deny` (so a user-level `deny` stays `deny`), and
 * `loosened` cut to the trusted entries. A class counts as irreversible when
 * the built-in defaults or the policy say so, so a layer cannot dodge this
 * by flipping `irreversible` off.
 */
function trustPolicy(policy: Policy, confirmed: readonly string[]): Narrowed {
	const confirmedSet = new Set(confirmed);
	const trusted = new Set(
		policy.loosened
			.filter((l) => l.source === "user" || confirmedSet.has(l.actionClass))
			.map((l) => l.actionClass),
	);
	const ignored = new Set(
		policy.loosened.map((l) => l.actionClass).filter((id) => !trusted.has(id)),
	);
	const classes: Record<string, ActionClassPolicy> = {
		...policy.action_classes,
	};
	const ids = new Set([
		...Object.keys(DEFAULT_POLICY.action_classes),
		...Object.keys(policy.action_classes),
	]);
	for (const id of ids) {
		if (trusted.has(id) || !isIrreversible(id, policy)) continue;
		const denied =
			policy.action_classes[id]?.verdict === "deny" ||
			policy.loosened.some((l) => l.actionClass === id && l.before === "deny");
		classes[id] = { irreversible: true, verdict: denied ? "deny" : "ask" };
	}
	return {
		policy: {
			...policy,
			action_classes: classes,
			loosened: policy.loosened.filter((l) => trusted.has(l.actionClass)),
		},
		ignored,
	};
}

// ── Stage 2: rules ──────────────────────────────────────────────────────────

function ruleReason(rules: RuleResult): string {
	return rules.kind === "no_rule" ? "no rule matched" : rules.reason;
}

// ── Stage 3: decide ─────────────────────────────────────────────────────────

type ModelOutcome = Readonly<{
	/** `undefined` leaves the rule result as it is. */
	verdict: Verdict | undefined;
	ids: readonly string[];
	degraded: boolean;
	note: string | undefined;
}>;

const NO_MODEL: ModelOutcome = {
	verdict: undefined,
	ids: [],
	degraded: false,
	note: undefined,
};

function consultModel(
	ports: GatePorts,
	event: GateEvent,
	rules: RuleResult,
	policy: Policy,
	highRisk: boolean,
): ModelOutcome {
	// The rules backend answers by looking up the strictest class's verdict,
	// which `evaluateRules` already did (with allow rules on top): its answer
	// adds something only where no rule decided.
	const selected = selectBackend(ports.backends, policy, "action.risk");
	if (
		selected.ok &&
		selected.value.id === "rules" &&
		rules.kind !== "no_rule"
	) {
		return NO_MODEL;
	}

	const decidePorts: DecidePorts = {
		clock: ports.clock,
		policy,
		backends: ports.backends,
	};
	const id = ports.newId();
	const started = ports.clock.now();
	const orders = highRisk ? [false, true] : [false];
	const decisions: Decision[] = [];
	for (const reversed of orders) {
		const request = riskRequest(event, rules, policy, highRisk, id, reversed);
		const result = decide(decidePorts, request);
		const ids = decisions.map((d) => d.id);
		if (!result.ok) return failed(result.error, ids);
		const [decision] = result.value;
		if (decision === undefined) return modelAsk(ids, true, "no decision");
		decisions.push(decision);
	}
	const ids = decisions.map((d) => d.id);

	const budget = ports.budgetMs ?? DEFAULT_GATE_BUDGET_MS;
	const elapsed = ports.clock.now() - started;
	if (!(elapsed <= budget)) {
		return modelAsk(
			ids,
			true,
			`the action.risk answer took ${elapsed} ms, over the ${budget} ms budget`,
		);
	}

	const threshold =
		policy.decisions["action.risk"]?.thresholds.confidence ??
		DEFAULT_POLICY.decisions["action.risk"].thresholds.confidence;
	const unsure = decisions.find((d) => !(d.confidence >= threshold));
	if (unsure !== undefined) {
		return modelAsk(
			ids,
			false,
			`action.risk confidence ${unsure.confidence} is below the ${threshold} threshold`,
		);
	}

	const answers = decisions.map((d) => asVerdict(d.answer));
	const [first] = answers;
	if (first === undefined || answers.some((a) => a === undefined)) {
		return modelAsk(ids, true, "action.risk gave no verdict");
	}
	if (answers.some((a) => a !== first)) {
		return modelAsk(
			ids,
			false,
			`the two-order check disagrees (${answers.join(" vs ")})`,
		);
	}
	return {
		verdict: first,
		ids,
		degraded: false,
		note: `action.risk: ${first}`,
	};
}

/**
 * The `action.risk` request. `reversed` presents the options and the
 * classes in reverse order, for the second half of the two-order check.
 */
function riskRequest(
	event: GateEvent,
	rules: RuleResult,
	policy: Policy,
	highRisk: boolean,
	id: string,
	reversed: boolean,
): DecideRequest {
	const classes = rules.classes.filter(
		(c) =>
			Object.hasOwn(DEFAULT_POLICY.action_classes, c) ||
			Object.hasOwn(policy.action_classes, c),
	);
	const actionClass = strictestClass(classes, policy);
	const mode = PERMISSION_MODES.find((m) => m === event.permissionMode);
	return {
		type: "action.risk",
		state: {
			trusted: {
				...(actionClass === undefined ? {} : { actionClass }),
				classes: reversed ? [...classes].reverse() : classes,
				eventKind: event.kind,
				rule: rules.kind,
				highRisk,
				permissionMode: mode ?? "unknown",
			},
			untrusted: {
				action: event.action,
				host: event.host,
				sessionId: event.sessionId,
				root: event.root,
				provenance: event.untrusted,
				...(rules.kind === "no_rule" ? {} : { ruleReason: rules.reason }),
			},
		},
		questions: [
			{
				kind: "choice",
				id: reversed ? `${id}:reversed` : id,
				options: reversed ? [...VERDICTS].reverse() : [...VERDICTS],
			},
		],
	};
}

/** The class with the strictest verdict; irreversible first on a tie. */
function strictestClass(
	classes: readonly string[],
	policy: Policy,
): string | undefined {
	const rank = (id: string): number => {
		const spec = policy.action_classes[id] ?? DEFAULT_POLICY.action_classes[id];
		const verdict = VERDICTS.indexOf(spec?.verdict ?? "ask");
		return verdict * 2 + (spec?.irreversible === true ? 1 : 0);
	};
	return classes.reduce<string | undefined>(
		(best, c) => (best === undefined || rank(c) > rank(best) ? c : best),
		undefined,
	);
}

function asVerdict(answer: unknown): Verdict | undefined {
	return VERDICTS.find((v) => v === answer);
}

function modelAsk(
	ids: readonly string[],
	degraded: boolean,
	why: string,
): ModelOutcome {
	return { verdict: "ask", ids, degraded, note: `${why}; asking` };
}

function failed(error: DecideError, ids: readonly string[]): ModelOutcome {
	const detail = "message" in error ? `: ${error.message}` : "";
	return modelAsk(ids, true, `action.risk failed (${error.kind}${detail})`);
}

function ask(
	why: string,
	decisionIds: readonly string[],
	degraded: boolean,
): GateResult {
	return { verdict: "ask", reason: `${why}; asking`, decisionIds, degraded };
}

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
