/**
 * Receipt → sticky PR comment markdown (FR-RET-3). Pure and deterministic:
 * the same receipt renders byte-identical markdown, so a republish of an
 * unchanged receipt leaves the comment untouched.
 *
 * The comment shows, in this order: the verify result and scope, the review
 * triage and its confidence, the gate counts and overrides, each acceptance
 * criterion with its evidence, the checks, and a link to the full receipt.
 *
 * Copy discipline (C2): "passed N of M checks", never "0 findings". Every
 * string that came from a user, a model or a tool is escaped so it cannot
 * break the table, inject HTML or @-mention anyone.
 */

import type { Check, Receipt } from "../receipt/types";
import type { VerifyScopeKind } from "../verify/pipeline";

/** First line of every receipt comment; the sticky upsert finds it by this. */
export const RECEIPT_COMMENT_MARKER = "<!-- maina:receipt v2 -->";

/** How an acceptance criterion stands against the evidence. */
export type CriterionStatus = "met" | "unmet" | "unverified";

export type ReceiptCriterion = Readonly<{
	id: string;
	text: string;
	status: CriterionStatus;
	/** What proves it: a check, a test, a file and line. */
	evidence: readonly string[];
}>;

/** What the verify run covered: the pipeline's scope, counted. */
export type VerifyScope = Readonly<{
	kind: VerifyScopeKind;
	/** The ref a `range` scope diffs against. */
	base?: string;
	files: number;
}>;

/** A gate decision the user overrode during the session. */
export type GateOverride = Readonly<{ decisionId: string; summary: string }>;

/** What the gate did during the session that produced the change. */
export type GateTally = Readonly<{
	blocked: number;
	asked: number;
	allowed: number;
	overrides: readonly GateOverride[];
}>;

/**
 * A v1 receipt plus what the comment shows beside it. The extras are
 * optional: a plain receipt renders without those sections.
 */
export type CommentReceipt = Receipt &
	Readonly<{
		criteria?: readonly ReceiptCriterion[];
		verifyScope?: VerifyScope;
		gate?: GateTally;
		/** Where the full receipt lives (http or https only). */
		url?: string;
	}>;

type RenderCommentOptions = Readonly<{
	/** Append the one-line "what is this" footer for people new to Maina. */
	discoveryLine: boolean;
}>;

const DISCOVERY_LINE =
	"<sub>Verified by [Maina](https://mainahq.com): every PR gets a receipt of what was checked and what held.</sub>";

const CRITERION_LABEL: Readonly<Record<CriterionStatus, string>> = {
	met: "✅ met",
	unmet: "❌ unmet",
	unverified: "⏳ unverified",
};

const CHECK_LABEL: Readonly<Record<Check["status"], string>> = {
	passed: "✅ held",
	failed: "❌ flagged",
	skipped: "⏭️ skipped",
};

export function renderReceiptComment(
	receipt: CommentReceipt,
	options: RenderCommentOptions,
): string {
	const lines = [
		RECEIPT_COMMENT_MARKER,
		`### Maina receipt: ${receiptHeadline(receipt)}`,
		"",
		`- **Verify:** ${verifyLine(receipt)}`,
		`- **Triage:** ${triageLine(receipt)}`,
		...(receipt.gate ? [`- **Gate:** ${gateLine(receipt.gate)}`] : []),
		...criteriaSection(receipt.criteria),
		...checksSection(receipt.checks),
		...overridesSection(receipt.gate),
		"",
		footerLine(receipt),
		...(options.discoveryLine ? ["", DISCOVERY_LINE] : []),
	];
	return `${lines.join("\n")}\n`;
}

/** The one-line result, also the check-run title (no markdown). */
export function receiptHeadline(receipt: Receipt): string {
	const total = receipt.checks.length;
	const passed = receipt.checks.filter((c) => c.status === "passed").length;
	if (receipt.status === "passed") {
		return total === 0
			? "verified, no checks ran"
			: `passed ${count(passed)} of ${count(total)} checks`;
	}
	const label = receipt.status === "partial" ? "partial" : "failed";
	return total === 0
		? `${label}, no checks rendered (see the logs)`
		: `${label}, ${count(passed)} of ${count(total)} checks held`;
}

function verifyLine(receipt: CommentReceipt): string {
	const { diff } = receipt;
	const scope = receipt.verifyScope;
	const files = scope?.files ?? diff.files;
	const size = `${plural(files, "file")} (+${count(diff.additions)} −${count(diff.deletions)})`;
	const retries =
		receipt.retries > 0
			? ` · ${plural(receipt.retries, "retry", "retries")}`
			: "";
	return `${receiptHeadline(receipt)} across ${size}${scopeLabel(scope)}${retries}`;
}

function scopeLabel(scope: VerifyScope | undefined): string {
	if (scope === undefined) return "";
	switch (scope.kind) {
		case "range":
			return scope.base === undefined
				? ", changed lines only"
				: `, changed lines against ${code(scope.base)}`;
		case "staged":
			return ", staged changes";
		case "working-tree":
			return ", working-tree changes";
		case "files":
			return ", a pinned file list";
		default: {
			const unreachable: never = scope.kind;
			return unreachable;
		}
	}
}

function triageLine(receipt: Receipt): string {
	const { triage } = receipt;
	if (triage === undefined) return "triage did not run";
	const decision = triage.needsReview
		? "deep review warranted"
		: "fast path, deep review not needed";
	return `${decision} (confidence ${percent(triage.confidence)}) · ${code(triage.decisionId)}`;
}

function gateLine(gate: GateTally): string {
	const overrides = gate.overrides.length;
	return [
		`${count(gate.blocked)} blocked`,
		`${count(gate.asked)} asked`,
		`${count(gate.allowed)} allowed`,
		plural(overrides, "override"),
	].join(" · ");
}

function criteriaSection(
	criteria: readonly ReceiptCriterion[] | undefined,
): readonly string[] {
	if (criteria === undefined || criteria.length === 0) return [];
	const met = criteria.filter((c) => c.status === "met").length;
	return [
		"",
		`#### Acceptance criteria (${count(met)} of ${count(criteria.length)} met)`,
		"",
		"| Criterion | Status | Evidence |",
		"| --- | --- | --- |",
		...criteria.map((c) => {
			const evidence =
				c.evidence.length === 0
					? "_awaiting evidence_"
					: c.evidence.map(cell).join("<br>");
			return `| **${cell(c.id)}** ${cell(c.text)} | ${CRITERION_LABEL[c.status] ?? CRITERION_LABEL.unverified} | ${evidence} |`;
		}),
	];
}

function checksSection(checks: readonly Check[]): readonly string[] {
	if (checks.length === 0) return [];
	return [
		"",
		"<details><summary>Checks</summary>",
		"",
		"| Check | Tool | Result | Findings |",
		"| --- | --- | --- | --- |",
		...checks.map(
			(c) =>
				`| ${cell(c.name)} | ${cell(c.tool)} | ${CHECK_LABEL[c.status] ?? CHECK_LABEL.failed} | ${count(c.findings.length)} |`,
		),
		"",
		"</details>",
	];
}

function overridesSection(gate: GateTally | undefined): readonly string[] {
	if (gate === undefined || gate.overrides.length === 0) return [];
	return [
		"",
		`<details><summary>Gate overrides (${count(gate.overrides.length)})</summary>`,
		"",
		...gate.overrides.map(
			(o) => `- ${cell(o.summary)} · ${code(o.decisionId)}`,
		),
		"",
		"</details>",
	];
}

function footerLine(receipt: CommentReceipt): string {
	const hash = `receipt ${code(receipt.hash.slice(0, 12))}`;
	const url = safeUrl(receipt.url);
	return url === undefined ? hash : `[Full receipt](${url}) · ${hash}`;
}

function safeUrl(url: string | undefined): string | undefined {
	if (url === undefined || !/^https?:\/\/[^\s()<>]+$/i.test(url)) {
		return undefined;
	}
	return url;
}

/** Text safe inside a table cell: one line, no HTML, no pipes, no mentions. */
function cell(text: string): string {
	return String(text)
		.replace(/\r?\n|\r/g, " ")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\|/g, "\\|")
		.replace(/@(?=\w)/g, "@​");
}

/**
 * Inline code that a backtick cannot break out of. Code spans show entities
 * literally and never mention anyone, so only newlines, backticks and pipes
 * (a table cell boundary even inside code) need handling.
 */
function code(text: string): string {
	const clean = String(text)
		.replace(/\r?\n|\r/g, " ")
		.replace(/`/g, "'")
		.replace(/\|/g, "\\|");
	return `\`${clean}\``;
}

/** Numbers are coerced so a tampered receipt cannot smuggle text in. */
function count(n: number): string {
	return typeof n === "number" && Number.isFinite(n)
		? String(Math.max(0, Math.trunc(n)))
		: "0";
}

function plural(n: number, one: string, many = `${one}s`): string {
	return `${count(n)} ${Number(count(n)) === 1 ? one : many}`;
}

function percent(p: number): string {
	if (typeof p !== "number" || !Number.isFinite(p)) return "unknown";
	return `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
}
