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
 * - `diff.sensitive` decides whether the diff touches security-sensitive
 *   code (#585); a yes, or an unsure no, also asks for the deep review.
 *
 * Pure given its ports: no I/O, and the input findings are never mutated.
 */

import type { Result } from "../db/index";
import type { DecidePorts } from "../decide/decide";
import { decide } from "../decide/decide";
import { hashInput } from "../decide/log/hash";
import type { DecideError, Decision, DecisionState } from "../decide/types";
import { type Preferences, ruleOutcomes } from "../feedback/preferences";
import { confidenceThreshold } from "../policy/defaults";
import type { Triage } from "../receipt/types";
import type { Finding } from "./diff-filter";

export type { Triage } from "../receipt/types";

const SEVERITIES = ["error", "warning", "info"] as const;

/**
 * The policy's confidence threshold for `decision`, by the backend that
 * answered; infinite when it escalated, so it is never acted on.
 */
function thresholdOf(ports: DecidePorts, decision: Decision): number {
	return confidenceThreshold(
		ports.policy,
		decision.type,
		decision.backend,
		decision.escalated,
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
	// An escalated answer (#577) is not acted on: the finding keeps its
	// reported severity.
	return result.value.map(
		(d, i) =>
			(d.escalated ? undefined : SEVERITIES.find((s) => s === d.answer)) ??
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

	const survivors: Finding[] = [];
	const originals: Finding[] = [];
	for (const [i, finding] of findings.entries()) {
		const decision = real[i];
		if (
			decision?.answer === false &&
			decision.confidence >= thresholdOf(ports, decision)
		) {
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

/** A header path without its `a/` / `b/` prefix, or `undefined` for /dev/null. */
function cleanPath(raw: string): string | undefined {
	const path = raw.replace(/^[ab]\//, "");
	return path === "/dev/null" || path === "" ? undefined : path;
}

/**
 * The paths a file header line names: `--- a/x` / `+++ b/x`, and the ones a
 * change without a hunk has (`rename from x`, `copy to x`,
 * `Binary files a/x and b/y differ`).
 */
function headerPaths(line: string): readonly (string | undefined)[] {
	if (line.startsWith("+++ ") || line.startsWith("--- ")) {
		return [cleanPath(line.slice(4))];
	}
	const moved = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
	if (moved) return [cleanPath(moved[1] ?? "")];
	const binary = /^Binary files (.+) and (.+) differ$/.exec(line);
	if (binary) return [cleanPath(binary[1] ?? ""), cleanPath(binary[2] ?? "")];
	return [];
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
			for (const path of headerPaths(line)) {
				if (path !== undefined) paths.add(path);
			}
		} else if (line.startsWith("+")) {
			additions++;
		} else if (line.startsWith("-")) {
			deletions++;
		}
	}
	return { additions, deletions, paths: [...paths].sort() };
}

// ── diff.sensitive's patch ──────────────────────────────────────────────────

/** The most code points of patch `diff.sensitive` sends before cutting it. */
const MAX_PATCH_CODE_POINTS = 6000;
/** Appended to a patch cut at `MAX_PATCH_CODE_POINTS`. */
const PATCH_CUT_MARK = "\n…";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A zero-context hunk header's range, as `git diff -U0` writes it. */
function hunkRange(start: number, count: number): string {
	if (count === 0) return `${start - 1},0`;
	return count === 1 ? `${start}` : `${start},${count}`;
}

type ChangeRun = {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	lines: string[];
};

/**
 * `diff` as zero-context text, whatever context it was taken with: each
 * file's `diff --git` line, then one `@@ -a,b +c,d @@` header per run of
 * changed lines (recomputed, without git's section heading) followed by
 * the run's `+` / `-` lines. File headers, mode, index, rename and binary
 * lines, context lines and `\ No newline at end of file` are left out.
 */
function zeroContextPatch(diff: string): string {
	const out: string[] = [];
	let inHunk = false;
	let oldLine = 0;
	let newLine = 0;
	let run: ChangeRun | undefined;
	const flush = (): void => {
		if (run === undefined) return;
		out.push(
			`@@ -${hunkRange(run.oldStart, run.oldCount)} +${hunkRange(run.newStart, run.newCount)} @@`,
			...run.lines,
		);
		run = undefined;
	};
	for (const line of diff.split("\n")) {
		const header = HUNK_HEADER.exec(line);
		if (line.startsWith("diff --git ")) {
			flush();
			inHunk = false;
			out.push(line);
		} else if (header) {
			flush();
			inHunk = true;
			// A zero count names the line before the hunk; the next line is one on.
			oldLine = Number(header[1]) + (header[2] === "0" ? 1 : 0);
			newLine = Number(header[3]) + (header[4] === "0" ? 1 : 0);
		} else if (inHunk && (line.startsWith("+") || line.startsWith("-"))) {
			run ??= {
				oldStart: oldLine,
				oldCount: 0,
				newStart: newLine,
				newCount: 0,
				lines: [],
			};
			run.lines.push(line);
			if (line.startsWith("+")) {
				run.newCount++;
				newLine++;
			} else {
				run.oldCount++;
				oldLine++;
			}
		} else if (inHunk && !line.startsWith("\\")) {
			// A context line (git writes " x"; an empty line is a stripped " ").
			flush();
			oldLine++;
			newLine++;
		}
		// Anything else (file headers, "\ No newline at end of file") is left out.
	}
	flush();
	return out.join("\n");
}

/**
 * `patch` cut to `MAX_PATCH_CODE_POINTS` code points (not UTF-16 units,
 * so the model's Python `len` agrees) plus `PATCH_CUT_MARK` when longer.
 */
function capPatch(patch: string): string {
	if (patch.length <= MAX_PATCH_CODE_POINTS) return patch;
	const points = Array.from(patch);
	return points.length <= MAX_PATCH_CODE_POINTS
		? patch
		: `${points.slice(0, MAX_PATCH_CODE_POINTS).join("")}${PATCH_CUT_MARK}`;
}

// ── Diff triage ─────────────────────────────────────────────────────────────

type DiffCheck = Readonly<{
	type: "diff.needs_review" | "diff.sensitive";
	/** The question's check: its id is `<check>:<16 hex>`. */
	check: string;
	state: DecisionState;
}>;

type DiffVerdict = Readonly<{
	decisionId: string;
	/** A yes, or a no below the policy's confidence threshold. */
	yesOrUnsure: boolean;
	confidence: number;
}>;

/**
 * One bool question about the whole diff, via `decide`. The id is
 * `<check>:<16 hex>`, derived from what was decided over, so the same diff
 * always gets the same id.
 */
function decideDiff(
	ports: DecidePorts,
	{ type, check, state }: DiffCheck,
): Result<DiffVerdict, DecideError> {
	const digest = hashInput(type, state, check);
	const decisionId = `${check}:${digest.slice("sha256:".length, "sha256:".length + 16)}`;
	const result = decide(ports, {
		type,
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
				type,
				backend: ports.policy.decisions[type]?.backend ?? "heuristic",
				questionId: decisionId,
				message: "no decision",
			},
		};
	}
	const unsure = decision.confidence < thresholdOf(ports, decision);
	return {
		ok: true,
		value: {
			decisionId,
			yesOrUnsure: decision.answer === true || unsure,
			confidence: decision.confidence,
		},
	};
}

/**
 * Whether `diff` needs the deep review, via two `decide` calls:
 *
 * - `diff.needs_review` over `trusted { additions, deletions, files }` and
 *   `untrusted { paths }`, question `needs_review:<16 hex>`;
 * - `diff.sensitive` (#585) over the same state plus `untrusted.patch`,
 *   question `sensitive:<16 hex>`.
 *
 * `diff.sensitive` is one bool for the whole diff, not one per category or
 * per file: the only labels there are to learn from (a later security fix,
 * a security-sensitive path) are about a whole commit, and its threshold
 * and error costs are per type. `paths` are the sorted, distinct paths the
 * diff touches (both sides of a rename); `patch` is `zeroContextPatch`
 * capped by `capPatch`. This is the contract the maina-model trains
 * `diff.sensitive` on: changing it needs a coordinated change there.
 *
 * Either one's yes, or unsure no, asks for the deep review. The result
 * carries the decision that asked for it: `diff.needs_review`'s when it did
 * (or when neither did), else `diff.sensitive`'s. A failure of either is an
 * error, which `runsDeepReview` fails closed on.
 */
export function triageDiff(
	ports: DecidePorts,
	diff: string,
): Result<Triage, DecideError> {
	const stats = diffStats(diff);
	const trusted = {
		additions: stats.additions,
		deletions: stats.deletions,
		files: stats.paths.length,
	};
	const review = decideDiff(ports, {
		type: "diff.needs_review",
		check: "needs_review",
		state: { trusted, untrusted: { paths: stats.paths } },
	});
	if (!review.ok) return review;
	const sensitive = decideDiff(ports, {
		type: "diff.sensitive",
		check: "sensitive",
		state: {
			trusted,
			untrusted: {
				paths: stats.paths,
				patch: capPatch(zeroContextPatch(diff)),
			},
		},
	});
	if (!sensitive.ok) return sensitive;
	// Cite the decision that asked for the deep review, so a receipt never
	// shows "deep review warranted" next to a confident `diff.needs_review` no.
	const cited =
		review.value.yesOrUnsure || !sensitive.value.yesOrUnsure
			? review.value
			: sensitive.value;
	return {
		ok: true,
		value: {
			decisionId: cited.decisionId,
			needsReview: review.value.yesOrUnsure || sensitive.value.yesOrUnsure,
			confidence: cited.confidence,
		},
	};
}

/**
 * The deep review runs when `--deep` is passed or the triage asks for it.
 * A failed triage (`undefined`) fails closed and runs it too: no decision is
 * less sure than an unsure "no", which already counts as a yes.
 */
export function runsDeepReview(
	deep: boolean,
	triage: Triage | undefined,
): boolean {
	return deep || triage?.needsReview !== false;
}
