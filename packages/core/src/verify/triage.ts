/**
 * Verify triage (v1 task 6.2, FR-VER-3, FR-VER-4): every judgement the
 * pipeline makes about its findings and about the diff goes through
 * `decide`, and acts on the answer only at the policy's confidence.
 *
 * - `finding.real` gives each finding a `realProbability`. A finding the
 *   backend is confident is noise (answer no at or above the policy's
 *   `finding.real` threshold) is suppressed.
 * - `finding.severity` sets each kept finding's severity from its reported
 *   one and its `realProbability`.
 * - `diff.needs_review` decides whether the diff warrants the deep
 *   (standard-tier) review. An unsure "no" (below the policy's threshold)
 *   counts as a yes: a missed review costs more than an extra one.
 *
 * Pure given its ports: no I/O, and the input findings are never mutated.
 */

import type { Result } from "../db/index";
import type { DecidePorts } from "../decide/decide";
import { decide } from "../decide/decide";
import { hashInput } from "../decide/log/hash";
import type {
	DecideError,
	Decision,
	DecisionState,
	DecisionType,
} from "../decide/types";
import { type Preferences, ruleOutcomes } from "../feedback/preferences";
import { DEFAULT_POLICY } from "../policy/defaults";
import type { Triage } from "../receipt/types";
import type { Finding } from "./diff-filter";

export type { Triage } from "../receipt/types";

const SEVERITIES = ["error", "warning", "info"] as const;

/** The policy's confidence threshold for `type`. */
function thresholdOf(ports: DecidePorts, type: DecisionType): number {
	return (
		ports.policy.decisions[type]?.thresholds.confidence ??
		DEFAULT_POLICY.decisions[type].thresholds.confidence
	);
}

/** P(true) of a bool decision. */
function pTrue(decision: Decision): number {
	return decision.distribution.find((e) => e.answer === true)?.p ?? 0;
}

// ── Findings ────────────────────────────────────────────────────────────────

type TriagedFindings = Readonly<{
	/** The findings kept, triaged, in input order. */
	kept: readonly Finding[];
	/** How many findings the noise filter suppressed. */
	suppressed: number;
	/** Each input finding to its triaged copy, or `null` when suppressed. */
	byOriginal: ReadonlyMap<Finding, Finding | null>;
}>;

type Fields = Readonly<Record<string, unknown>>;

const indexed = (items: readonly Fields[]): Fields =>
	Object.fromEntries(items.map((item, i) => [i, item]));

/** `finding.real` for every finding, or `undefined` when `decide` fails. */
function realProbabilities(
	ports: DecidePorts,
	findings: readonly Finding[],
	prefs: Preferences,
): readonly Decision[] | undefined {
	const result = decide(ports, {
		type: "finding.real",
		state: {
			trusted: {
				candidates: indexed(findings.map((f) => ruleOutcomes(prefs, f.ruleId))),
			},
			untrusted: {
				candidates: indexed(
					findings.map((f) => ({
						ruleId: f.ruleId ?? "",
						tool: f.tool,
						file: f.file,
						message: f.message,
					})),
				),
			},
		},
		questions: findings.map((_, i) => ({ kind: "bool", id: `rule:${i}` })),
	});
	return result.ok ? result.value : undefined;
}

/** `finding.severity` for every finding, or `undefined` when `decide` fails. */
function severities(
	ports: DecidePorts,
	findings: readonly Finding[],
): readonly Finding["severity"][] | undefined {
	const result = decide(ports, {
		type: "finding.severity",
		state: {
			trusted: {
				candidates: indexed(
					findings.map((f) => ({
						reported: f.severity,
						realProbability: f.realProbability ?? 0.5,
					})),
				),
			},
			untrusted: {},
		},
		questions: findings.map((_, i) => ({
			kind: "choice",
			id: `severity:${i}`,
			options: SEVERITIES,
		})),
	});
	if (!result.ok) return undefined;
	return result.value.map(
		(d, i) =>
			SEVERITIES.find((s) => s === d.answer) ??
			findings[i]?.severity ??
			"warning",
	);
}

/**
 * The noise filter and severity triage over `findings`, judged from the
 * recorded outcomes in `prefs`. When `decide` fails for `finding.real`,
 * every finding is kept as reported; when it fails for `finding.severity`,
 * each kept finding keeps its reported severity.
 */
export function triageFindings(
	ports: DecidePorts,
	findings: readonly Finding[],
	prefs: Preferences,
): TriagedFindings {
	const byOriginal = new Map<Finding, Finding | null>();
	if (findings.length === 0) return { kept: [], suppressed: 0, byOriginal };

	const real = realProbabilities(ports, findings, prefs);
	if (real === undefined) {
		for (const f of findings) byOriginal.set(f, f);
		return { kept: findings, suppressed: 0, byOriginal };
	}

	const threshold = thresholdOf(ports, "finding.real");
	const survivors: Finding[] = [];
	const originals: Finding[] = [];
	for (const [i, finding] of findings.entries()) {
		const decision = real[i];
		if (decision?.answer === false && decision.confidence >= threshold) {
			byOriginal.set(finding, null);
			continue;
		}
		// `decide` answers every question; without an answer, keep as reported.
		survivors.push(
			decision === undefined
				? finding
				: { ...finding, realProbability: pTrue(decision) },
		);
		originals.push(finding);
	}

	const severity =
		survivors.length > 0 ? severities(ports, survivors) : undefined;
	const kept = survivors.map((f, i) => ({
		...f,
		severity: severity?.[i] ?? f.severity,
	}));
	for (const [i, original] of originals.entries()) {
		byOriginal.set(original, kept[i] ?? original);
	}
	return { kept, suppressed: findings.length - kept.length, byOriginal };
}

// ── Diff ────────────────────────────────────────────────────────────────────

type DiffStats = Readonly<{
	additions: number;
	deletions: number;
	paths: readonly string[];
}>;

/** The path a `--- a/x` / `+++ b/x` header names, or `undefined` for /dev/null. */
function headerPath(line: string): string | undefined {
	const path = line.slice(4).replace(/^[ab]\//, "");
	return path === "/dev/null" ? undefined : path;
}

/**
 * Changed-line counts and touched paths of a unified diff. `---` / `+++`
 * are file headers only before a file's first hunk, so a removed `-- x` or
 * an added `++x` line inside a hunk still counts as a change.
 */
function diffStats(diff: string): DiffStats {
	let additions = 0;
	let deletions = 0;
	let inHunk = false;
	const paths = new Set<string>();
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			inHunk = false;
		} else if (line.startsWith("@@")) {
			inHunk = true;
		} else if (!inHunk) {
			const header =
				line.startsWith("+++ ") || line.startsWith("--- ")
					? headerPath(line)
					: undefined;
			if (header !== undefined) paths.add(header);
		} else if (line.startsWith("+")) {
			additions++;
		} else if (line.startsWith("-")) {
			deletions++;
		}
	}
	return { additions, deletions, paths: [...paths].sort() };
}

/**
 * Whether `diff` needs the deep review, via `decide` (`diff.needs_review`).
 * The decision id is `needs_review:<16 hex>`, derived from what was decided
 * over, so the same diff always gets the same id.
 */
export function triageDiff(
	ports: DecidePorts,
	diff: string,
): Result<Triage, DecideError> {
	const stats = diffStats(diff);
	const state: DecisionState = {
		trusted: {
			additions: stats.additions,
			deletions: stats.deletions,
			files: stats.paths.length,
		},
		untrusted: { paths: stats.paths },
	};
	const digest = hashInput("diff.needs_review", state, "needs_review");
	const decisionId = `needs_review:${digest.slice("sha256:".length, "sha256:".length + 16)}`;
	const result = decide(ports, {
		type: "diff.needs_review",
		state,
		questions: [{ kind: "bool", id: decisionId }],
	});
	if (!result.ok) return result;
	const [decision] = result.value;
	if (decision === undefined) {
		return {
			ok: false,
			error: {
				kind: "invalid_answer",
				type: "diff.needs_review",
				backend:
					ports.policy.decisions["diff.needs_review"]?.backend ?? "heuristic",
				questionId: decisionId,
				message: "no decision",
			},
		};
	}
	const unsure = decision.confidence < thresholdOf(ports, "diff.needs_review");
	return {
		ok: true,
		value: {
			decisionId,
			needsReview: decision.answer === true || unsure,
			confidence: decision.confidence,
		},
	};
}

/** The deep review runs only when `--deep` is passed or the triage asks for it. */
export function runsDeepReview(
	deep: boolean,
	triage: Triage | undefined,
): boolean {
	return deep || triage?.needsReview === true;
}
