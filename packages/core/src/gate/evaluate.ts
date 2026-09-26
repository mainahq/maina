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
 *                 The policy's `protected_branches` join the context's.
 *   3. decide   — `decide("action.risk")` with the policy's backend. Its
 *                 answer is folded in by `settleVerdict`, so it can tighten a
 *                 rule result or decide a `no_rule`, never loosen a result.
 *                 An ask or deny the rules settle without a backend is
 *                 recorded as the rules backend's answer, so it has an id.
 *
 * Fail closed: a backend error, an answer slower than the budget, one below
 * the policy's confidence threshold, a two-order disagreement, a malformed
 * event or any unexpected failure asks. Only Maina-computed values from
 * closed catalogs (class ids, the event kind, the rule outcome, the
 * permission mode) go into the trusted segment of the decide request;
 * everything the agent or the repository wrote goes into the untrusted one.
 */

import { rulesBackend } from "../decide/backends/rules";
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
import {
	DEFAULT_PROTECTED_BRANCHES,
	type GateContext,
	type GateEvent,
	type PermissionMode,
} from "./events";
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
	/**
	 * Ids of the `action.risk` decisions behind the verdict, for the log. A
	 * verdict a rule reached alone has one too, answered as the rules
	 * backend: every rule-decided ask or deny can be overridden by id, and
	 * every evaluation, allows included, is logged (#480). Empty only when
	 * the gate could not evaluate the event at all.
	 */
	decisionIds: readonly string[];
	/** The gate could not run in full (no model answer, no shell grammar). */
	degraded: boolean;
	/**
	 * The lowest confidence among the `action.risk` answers: the model's, or
	 * 1 for a rule's own ask or deny. Absent when nothing was decided. Feeds
	 * the message's band.
	 */
	confidence?: number;
	/** A rewrite of the tool input for the host to run instead. */
	rewrittenInput?: Readonly<Record<string, unknown>>;
	/**
	 * What the decision log needs for each of `decisionIds`: the policy
	 * `decide` ran with (after the trust stage) and every request with its
	 * decision, in `decisionIds` order. Absent when no decision was made.
	 */
	decided?: Readonly<{ policy: Policy; answers: readonly GateAnswer[] }>;
}>;

/** One `action.risk` question the gate asked and the decision it got. */
type GateAnswer = Readonly<{ request: DecideRequest; decision: Decision }>;

/**
 * Appended to a gate decision's id to name the second half of its two-order
 * check: both halves belong to one gate event.
 */
export const REVERSED_SUFFIX = ":reversed";

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
	const rules = evaluateRules(
		event,
		narrowed.policy,
		withPolicyBranches(ports.ctx, policy),
	);
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
	const highRisk =
		rules.classes.some((c) => isIrreversible(c, policy)) ||
		(Array.isArray(event.untrusted) && event.untrusted.length > 0);
	const model =
		rules.kind === "deny"
			? null
			: consultModel(ports, event, rules, narrowed.policy, highRisk);
	if (model === null) {
		const verdict = settleVerdict(rules, undefined);
		// A verdict the rules reached alone is still a decision: it gets an id
		// and a log record, so `maina allow <id>` can override an ask or a
		// deny (#448) and the session summary counts an allow (#480).
		const answer = ruleAnswer(
			riskRequest(
				event,
				rules,
				narrowed.policy,
				highRisk,
				ports.newId(),
				false,
			),
			verdict,
		);
		return {
			verdict,
			reason,
			degraded: blind,
			decisionIds: [answer.decision.id],
			confidence: answer.decision.confidence,
			decided: { policy: narrowed.policy, answers: [answer] },
		};
	}
	return {
		verdict: settleVerdict(rules, model.verdict),
		reason: model.note === undefined ? reason : `${reason}; ${model.note}`,
		decisionIds: model.ids,
		degraded: blind || model.degraded,
		...(model.confidence === undefined ? {} : { confidence: model.confidence }),
		...(model.answers === undefined || model.answers.length === 0
			? {}
			: { decided: { policy: narrowed.policy, answers: model.answers } }),
	};
}

/**
 * `ctx` protecting the policy's branches as well as its own (or the
 * defaults, when it names none). Protecting a branch only tightens, so every
 * layer's list counts, a repo's included.
 */
export function withPolicyBranches(
	ctx: GateContext,
	policy: Policy,
): GateContext {
	const own = ctx.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;
	return {
		...ctx,
		protectedBranches: [...new Set([...own, ...policy.protected_branches])],
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
		// A class the policy omits keeps its built-in verdict, so a partial
		// policy cannot drop a default deny to `ask`.
		const current =
			policy.action_classes[id] ?? DEFAULT_POLICY.action_classes[id];
		const denied =
			current?.verdict === "deny" ||
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
	/** The lowest confidence among the answers, when there were any. */
	confidence?: number;
	/** Every answer collected, in `ids` order. */
	answers?: readonly GateAnswer[];
}>;

/**
 * The `action.risk` outcome for a rule result, or null when no backend is
 * asked because the rule already decided.
 */
function consultModel(
	ports: GatePorts,
	event: GateEvent,
	rules: RuleResult,
	policy: Policy,
	highRisk: boolean,
): ModelOutcome | null {
	// The rules backend answers by looking up the strictest class's verdict,
	// which `evaluateRules` already did (with allow rules on top): its answer
	// adds something only where no rule decided.
	const selected = selectBackend(ports.backends, policy, "action.risk");
	if (
		selected.ok &&
		selected.value.id === "rules" &&
		rules.kind !== "no_rule"
	) {
		return null;
	}

	const decidePorts: DecidePorts = {
		clock: ports.clock,
		policy,
		backends: ports.backends,
	};
	const id = ports.newId();
	const started = ports.clock.now();
	const orders = highRisk ? [false, true] : [false];
	const answers: GateAnswer[] = [];
	const decisions = () => answers.map((a) => a.decision);
	for (const reversed of orders) {
		const request = riskRequest(event, rules, policy, highRisk, id, reversed);
		const result = decide(decidePorts, request);
		const ids = decisions().map((d) => d.id);
		if (!result.ok) return { ...failed(result.error, ids), answers };
		const [decision] = result.value;
		if (decision === undefined) {
			return { ...modelAsk(ids, true, "no decision"), answers };
		}
		answers.push({ request, decision });
	}
	const elapsed = ports.clock.now() - started;
	const judged = judgeAnswers(decisions(), policy, ports.budgetMs, elapsed);
	return {
		...judged,
		answers,
		confidence: Math.min(...decisions().map((d) => d.confidence)),
	};
}

/** What the collected `action.risk` answers amount to, after the checks. */
function judgeAnswers(
	decisions: readonly Decision[],
	policy: Policy,
	budgetMs: number | undefined,
	elapsed: number,
): ModelOutcome {
	const ids = decisions.map((d) => d.id);
	const budget = budgetMs ?? DEFAULT_GATE_BUDGET_MS;
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
				id: reversed ? `${id}${REVERSED_SUFFIX}` : id,
				options: reversed ? [...VERDICTS].reverse() : [...VERDICTS],
			},
		],
	};
}

/**
 * The rules' own answer to `request`: `verdict`, certain, from the rules
 * backend, as the log records a verdict no backend was asked for.
 */
function ruleAnswer(request: DecideRequest, verdict: Verdict): GateAnswer {
	const [question] = request.questions;
	const options = question?.kind === "choice" ? question.options : VERDICTS;
	return {
		request,
		decision: {
			id: question?.id ?? "",
			type: request.type,
			answer: verdict,
			distribution: options.map((o) => ({
				answer: o,
				p: o === verdict ? 1 : 0,
			})),
			confidence: 1,
			backend: { id: rulesBackend.id, version: rulesBackend.version },
			latencyMs: 0,
		},
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
