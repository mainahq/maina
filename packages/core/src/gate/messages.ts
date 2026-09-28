/**
 * Gate messages (FR-GATE-8): the one line a host shows the user for a gate
 * result. It carries the verdict, the reason, a confidence band and, for
 * `ask` and `deny`, the way to override:
 *
 *   maina deny: action.risk: deny (confidence medium) | override: maina allow d-7 [--always]
 *
 * A remote approval (#593) adds where it left the ask, such as `waiting for
 * approval: <link to the ask> (retry once approved)` or `denied by member
 * mem_7c1d`. An approver's denial offers no local override.
 *
 * Pure: the host adapter decides where the line goes.
 */

import type { GateResult } from "./evaluate";

export type ConfidenceBand = "high" | "medium" | "low";

/** Confidence at or above which the band is `high`, then `medium`. */
const HIGH = 0.9;
const MEDIUM = 0.7;

/** Longest reason kept, so the line stays readable in a host prompt. */
const MAX_REASON = 240;

/**
 * Where a remote approval (#593) left an ask: `waiting` for the org's
 * approvers (the ask is still open), `approved` or `denied` by one,
 * `timeout` (the route's timeout passed), `unavailable` (the approvals
 * channel could not be reached) or `untrusted` (a resolution that did not
 * verify, or an unsigned one that may not loosen the class).
 */
export const APPROVAL_STATUSES = [
	"waiting",
	"approved",
	"denied",
	"timeout",
	"unavailable",
	"untrusted",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** What a remote approval adds to a gate result's message. */
export type GateApprovalNote = Readonly<{
	status: ApprovalStatus;
	/** The ask in the org's approvals inbox. */
	link?: string;
	/** Who resolved it, e.g. `member mem_7c1d`. */
	by?: string;
}>;

type MessageInput = Pick<
	GateResult,
	"verdict" | "reason" | "decisionIds" | "degraded" | "confidence"
> &
	Readonly<{ approval?: GateApprovalNote }>;

/**
 * How sure the gate is. A degraded evaluation is `low`; a verdict a rule
 * reached without the model is `high` (the rules are deterministic); a model
 * verdict is banded by its lowest confidence, `low` when it reported none.
 */
export function confidenceBand(result: MessageInput): ConfidenceBand {
	if (result.degraded) return "low";
	if (result.confidence === undefined) {
		return result.decisionIds.length === 0 ? "high" : "low";
	}
	if (result.confidence >= HIGH) return "high";
	if (result.confidence >= MEDIUM) return "medium";
	return "low";
}

/**
 * C0 and C1 controls (NEL, CSI), line and paragraph separators, and the
 * zero-width and bidi format characters that could hide or reorder text in
 * the line a user reads before overriding.
 */
const HIDDEN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
	/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g;

/** The reason on one line: hidden characters folded, runs of space collapsed, cut. */
function oneLine(reason: string): string {
	const text = reason
		.replace(HIDDEN, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/; asking$/, "");
	// Cut by code point, so a surrogate pair is never split.
	const chars = [...text];
	return chars.length > MAX_REASON
		? `${chars.slice(0, MAX_REASON - 1).join("")}…`
		: text;
}

/** Longest approver name kept. */
const MAX_BY = 80;

/** A value from the approvals channel with hidden characters and spaces folded. */
function clean(text: string, max: number): string {
	const chars = [...text.replace(HIDDEN, " ").replace(/\s+/g, " ").trim()];
	return chars.length > max
		? `${chars.slice(0, max - 1).join("")}…`
		: chars.join("");
}

/** What a remote approval made of the ask, as one segment. */
function approvalSegment(note: GateApprovalNote): string {
	const by = note.by === undefined ? undefined : clean(note.by, MAX_BY);
	// A link never needs a space; one with a space is cut there.
	const link = note.link?.replace(HIDDEN, " ").trim().split(/\s/)[0];
	switch (note.status) {
		case "waiting":
			return link === undefined || link === ""
				? "waiting for approval (retry once approved)"
				: `waiting for approval: ${link} (retry once approved)`;
		case "approved":
			return by === undefined ? "approved remotely" : `approved by ${by}`;
		case "denied":
			return by === undefined ? "denied by an approver" : `denied by ${by}`;
		case "timeout":
			return "the approval timed out";
		case "unavailable":
			return "the approvals channel could not be reached";
		case "untrusted":
			return "the approval could not be verified";
		default: {
			const unreachable: never = note.status;
			return unreachable;
		}
	}
}

/** How to get past an `ask` or `deny`; `undefined` for an `allow`. */
function overrideHint(result: MessageInput): string | undefined {
	// An approver decided: a local override would overrule them.
	if (result.approval?.status === "denied") return undefined;
	const [id] = result.decisionIds;
	switch (result.verdict) {
		case "allow":
			return undefined;
		case "ask":
			return id === undefined
				? "approve it at the prompt"
				: `maina allow ${id} [--always]`;
		case "deny":
			return id === undefined
				? "change the deny rule or class in your maina policy"
				: `maina allow ${id} [--always]`;
		default: {
			const unreachable: never = result.verdict;
			return unreachable;
		}
	}
}

/** The one-line message for `result`. */
export function formatGateMessage(result: MessageInput): string {
	const hint = overrideHint(result);
	return [
		`maina ${result.verdict}: ${oneLine(result.reason)} (confidence ${confidenceBand(result)})`,
		...(result.approval === undefined
			? []
			: [approvalSegment(result.approval)]),
		...(hint === undefined ? [] : [`override: ${hint}`]),
	].join(" | ");
}
