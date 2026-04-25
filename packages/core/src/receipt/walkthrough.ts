/**
 * Receipt walkthrough — the 3-sentence header that makes every receipt
 * scannable in 3 seconds.
 *
 * Strategy:
 *  - Build a deterministic baseline summary (always C2-compliant + always 3
 *    sentences). This is the floor.
 *  - Try the mechanical-tier AI for a richer prose version.
 *  - Validate AI output: 3 sentences, no banned C2 phrases, no `[NEEDS
 *    CLARIFICATION]` markers leaked. If any check fails, fall back to baseline.
 *
 * Caching: keyed by the structural inputs (no PII, no diff content) via the
 * existing CacheManager so re-running maina receipt on the same pipeline is a
 * no-op.
 */

import { tryAIGenerate } from "../ai/try-generate";
import type { Diff } from "./types";

export interface WalkthroughInput {
	prTitle: string;
	diff: Diff;
	status: "passed" | "failed" | "partial";
	retries: number;
	checks: ReadonlyArray<{
		name: string;
		tool: string;
		status: "passed" | "failed" | "skipped";
		findingsCount: number;
	}>;
	mainaDir?: string;
}

export interface WalkthroughDeps {
	/** Override the AI call — primarily for tests. Defaults to `tryAIGenerate`. */
	tryAI?: typeof tryAIGenerate;
}

export interface WalkthroughResult {
	text: string;
	source: "ai" | "baseline";
}

/** Banned C2 framings — vague absence ("0 findings", "no errors", "no
 * security concerns"). Specific-check absence like "no secrets, no high-CVE
 * deps, no risky AST patterns on diff" is *allowed* per C2 — but the regex
 * only flags generic forms, so specific lists pass.
 *
 * Covers: "0 findings", "0 finding(s)", "no issues found", "no errors",
 * "no security findings", "no security concerns", "no problems detected",
 * "no findings", and all plural/punctuated variants. */
const BANNED_C2_PATTERN =
	/\b(?:0\s+(?:findings?|issues?|problems?|errors?)(?:\(s\))?|no\s+(?:issues?|errors?|problems?|findings?|security\s+(?:findings?|concerns?|issues?))(?:\s+(?:found|detected))?)\b/i;

export async function generateWalkthrough(
	input: WalkthroughInput,
	deps: WalkthroughDeps = {},
): Promise<WalkthroughResult> {
	const baseline = baselineWalkthrough(input);
	const ai = deps.tryAI ?? tryAIGenerate;

	let result: Awaited<ReturnType<typeof tryAIGenerate>>;
	try {
		result = await ai(
			"walkthrough",
			input.mainaDir ?? ".maina",
			walkthroughVariables(input),
			walkthroughUserPrompt(input),
		);
	} catch {
		// AI call rejected — degrade gracefully to baseline rather than failing
		// the receipt path. Walkthrough is presentational, not load-bearing.
		return { text: baseline, source: "baseline" };
	}

	if (!result.text || !result.fromAI) {
		// Host delegation or no API key — return baseline. The host can fill the
		// walkthrough next round if it generates one.
		return { text: baseline, source: "baseline" };
	}

	const validated = validateAiOutput(result.text);
	if (!validated.ok) {
		return { text: baseline, source: "baseline" };
	}

	return { text: validated.text, source: "ai" };
}

export function baselineWalkthrough(input: WalkthroughInput): string {
	const passed = input.checks.filter((c) => c.status === "passed").length;
	const total = input.checks.length;
	const toolList = describeTools(input.checks);
	const summary = describeOutcome(input.status, input.retries, passed, total);

	const change = `${input.prTitle.trim()}: +${input.diff.additions} / −${input.diff.deletions} across ${input.diff.files} file(s).`;
	const verified =
		total === 0
			? "Maina recorded an empty check set for this verification."
			: `Maina ran ${total} check(s) — ${toolList}.`;
	return `${change} ${verified} ${summary}`;
}

function describeTools(checks: WalkthroughInput["checks"]): string {
	if (checks.length === 0) return "no tools";
	const groups: Record<string, number> = {};
	for (const c of checks) {
		groups[c.status] = (groups[c.status] ?? 0) + 1;
	}
	const parts: string[] = [];
	if (groups.passed) parts.push(`${groups.passed} passed`);
	if (groups.failed) parts.push(`${groups.failed} failed`);
	if (groups.skipped) parts.push(`${groups.skipped} skipped`);
	return parts.join(", ");
}

function describeOutcome(
	status: "passed" | "failed" | "partial",
	retries: number,
	passed: number,
	total: number,
): string {
	if (status === "passed") {
		return total === 0
			? "Verified — pipeline ran without checks to record."
			: `Verified — passed ${passed} of ${total} policy checks.`;
	}
	if (status === "partial") {
		if (retries >= 3) {
			return `Partial — agent retried ${retries} times before this receipt was emitted, capping the run.`;
		}
		return `Partial — passed ${passed} of ${total} policy checks; review the flagged checks before merging.`;
	}
	return `Failed — passed ${passed} of ${total} policy checks; the failed entries explain why this change is not yet safe to merge.`;
}

function walkthroughVariables(input: WalkthroughInput): Record<string, string> {
	return {
		prTitle: input.prTitle,
		diffStats: `+${input.diff.additions} / −${input.diff.deletions} across ${input.diff.files} file(s)`,
		status: input.status,
		retries: String(input.retries),
		checkSummary: summariseChecks(input.checks),
	};
}

function walkthroughUserPrompt(input: WalkthroughInput): string {
	return `Write a 3-sentence walkthrough for this verification receipt.

PR: ${input.prTitle}
Diff: +${input.diff.additions} / −${input.diff.deletions} across ${input.diff.files} file(s)
Status: ${input.status} (retries: ${input.retries})
Checks: ${summariseChecks(input.checks)}`;
}

/** Aggregate check states into a C2-safe summary string for the model.
 * Avoids per-check "0 finding(s)" noise that nudged the model toward
 * banned framings — the model only sees the names + statuses. */
function summariseChecks(checks: WalkthroughInput["checks"]): string {
	if (checks.length === 0) return "(no checks recorded)";
	const passed = checks.filter((c) => c.status === "passed").map((c) => c.tool);
	const failed = checks.filter((c) => c.status === "failed");
	const skipped = checks
		.filter((c) => c.status === "skipped")
		.map((c) => c.tool);
	const parts: string[] = [];
	if (passed.length) parts.push(`passed: ${passed.join(", ")}`);
	if (failed.length) {
		parts.push(
			`failed: ${failed.map((c) => `${c.tool}(${c.findingsCount})`).join(", ")}`,
		);
	}
	if (skipped.length) parts.push(`skipped: ${skipped.join(", ")}`);
	return parts.join("; ");
}

function validateAiOutput(
	raw: string,
): { ok: true; text: string } | { ok: false; reason: string } {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return { ok: false, reason: "empty" };

	if (/\[\s*needs\s+clarification\b/i.test(trimmed)) {
		return { ok: false, reason: "needs-clarification" };
	}

	if (BANNED_C2_PATTERN.test(trimmed)) {
		return { ok: false, reason: "c2-violation" };
	}

	const sentenceCount = countSentences(trimmed);
	if (sentenceCount !== 3) {
		return { ok: false, reason: "wrong-sentence-count" };
	}

	return { ok: true, text: trimmed };
}

function countSentences(text: string): number {
	// Split on terminal punctuation; trim and drop empties. Tolerant of "Mr.",
	// "e.g." etc — we just want a rough count to enforce ~3.
	const matches = text.match(/[^.!?]+[.!?]+/g);
	return matches ? matches.length : 0;
}
