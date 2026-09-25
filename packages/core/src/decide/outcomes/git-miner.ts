/**
 * The git outcome miner (FR-DEC-4). Walks the commits after `sinceRef` and
 * links two kinds of outcome to the `diff.*` decisions made for earlier
 * commits (see `linkDecisionCommit`):
 *
 * - `reverted`: a commit whose message says `This reverts commit <sha>.`
 *   (what `git revert` writes) links to the decisions of `<sha>`.
 * - `hotfixed`: a commit marked fix (`fix:`, `fix(scope):`, `hotfix`) whose
 *   removed or changed lines overlap a hunk added by one of the previous N
 *   commits links to that commit's decisions. Line numbers are compared as
 *   git reports them, so intermediate commits that shift lines can hide a
 *   match; the heuristic prefers missing a hotfix to inventing one.
 *
 * Every outcome's id is derived from the decision, the outcome and the
 * mined commit, so running the miner again over the same range adds
 * nothing. Paths and diff text stay in memory; only shas reach the log.
 */

import type { Result } from "../../db/index";
import type { GitError, GitPort } from "../../ports/git";
import { decisionsForCommit, isCommitSha, linkOutcome } from "./link";
import type {
	CommitDecision,
	Outcome,
	OutcomeError,
	OutcomePorts,
	OutcomeRecord,
} from "./types";

export type MinerPorts = OutcomePorts & Readonly<{ git: GitPort }>;

export type MinerOptions = Readonly<{
	/** The repository root git runs in. */
	root: string;
	/** How many earlier commits a fix may follow to count as a hotfix. */
	hotfixWindow?: number;
}>;

export type MineSummary = Readonly<{
	/** Commits examined (merges excluded). */
	scanned: number;
	/** Outcomes this run created, in commit order. */
	linked: readonly OutcomeRecord[];
	/** Outcomes this run found already linked. */
	existing: number;
}>;

export const DEFAULT_HOTFIX_WINDOW = 5;
const MAX_HOTFIX_WINDOW = 1_000;

/** A ref git will not read as an option or a range. */
const REF_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_./@{}^~-]*$/;

const REVERT_PATTERN = /This reverts commit ([0-9a-f]{40,64})\b/g;
const FIX_SUBJECT = /^(?:fix|hotfix|bugfix)(?:\([^)]*\))?!?:/i;
const HOTFIX_WORD = /\bhot-?fix\b/i;

type Commit = Readonly<{ sha: string; subject: string; body: string }>;

type Hunk = Readonly<{ path: string; start: number; end: number }>;

function gitError(error: GitError): Result<never, OutcomeError> {
	const message =
		error.kind === "not_a_repo"
			? `not a git repository: ${error.root}`
			: `git exited ${error.exitCode}: ${error.stderr.trim()}`;
	return { ok: false, error: { kind: "git", message } };
}

function parseCommits(stdout: string): readonly Commit[] {
	return stdout
		.split("\x1e")
		.map((chunk) => chunk.replace(/^\n+/, ""))
		.filter((chunk) => chunk.length > 0)
		.flatMap((chunk) => {
			const [sha = "", subject = "", body = ""] = chunk.split("\x1f");
			return isCommitSha(sha) ? [{ sha, subject, body }] : [];
		});
}

function revertTargets(commit: Commit): readonly string[] {
	const text = `${commit.subject}\n${commit.body}`;
	return [...text.matchAll(REVERT_PATTERN)]
		.map((m) => m[1] ?? "")
		.filter((sha) => isCommitSha(sha) && sha !== commit.sha);
}

function isFix(commit: Commit): boolean {
	return FIX_SUBJECT.test(commit.subject) || HOTFIX_WORD.test(commit.subject);
}

function unquote(path: string): string {
	return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

/** `--- a/x` / `+++ b/x` path, or undefined for `/dev/null`. */
function headerPath(line: string): string | undefined {
	const raw = unquote(line.slice(4).trim());
	if (raw === "/dev/null") return undefined;
	return raw.replace(/^[ab]\//, "");
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * The line ranges a zero-context diff touches, on the old side (lines the
 * commit removed or changed) or the new side (lines it added or changed).
 * An empty range (a pure insertion or deletion) touches the line it follows.
 */
function parseHunks(diff: string, side: "old" | "new"): readonly Hunk[] {
	const hunks: Hunk[] = [];
	let inHeader = false;
	let path: string | undefined;
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			inHeader = true;
			path = undefined;
			continue;
		}
		if (inHeader && line.startsWith("--- ") && side === "old") {
			path = headerPath(line);
			continue;
		}
		if (inHeader && line.startsWith("+++ ") && side === "new") {
			path = headerPath(line);
			continue;
		}
		const header = HUNK_HEADER.exec(line);
		if (header === null) continue;
		inHeader = false;
		if (path === undefined) continue;
		const start = Number(side === "old" ? header[1] : header[3]);
		const count = Number((side === "old" ? header[2] : header[4]) ?? "1");
		hunks.push({ path, start, end: start + Math.max(count, 1) - 1 });
	}
	return hunks;
}

function overlaps(a: readonly Hunk[], b: readonly Hunk[]): boolean {
	return a.some((x) =>
		b.some((y) => x.path === y.path && x.start <= y.end && y.start <= x.end),
	);
}

function isDiffDecision(d: CommitDecision): boolean {
	return d.type.startsWith("diff.");
}

function validate(
	sinceRef: string,
	hotfixWindow: number,
): Result<void, OutcomeError> {
	if (!REF_PATTERN.test(sinceRef) || sinceRef.includes("..")) {
		return {
			ok: false,
			error: {
				kind: "invalid_outcome",
				message: "sinceRef must be a single git ref (no options or ranges)",
			},
		};
	}
	if (
		!Number.isSafeInteger(hotfixWindow) ||
		hotfixWindow < 1 ||
		hotfixWindow > MAX_HOTFIX_WINDOW
	) {
		return {
			ok: false,
			error: {
				kind: "invalid_outcome",
				message: `hotfixWindow must be an integer in [1, ${MAX_HOTFIX_WINDOW}]`,
			},
		};
	}
	return { ok: true, value: undefined };
}

/**
 * Mines reverts and hotfixes among the commits after `sinceRef` (up to
 * HEAD) and links them to earlier `diff.*` decisions. Idempotent.
 */
export async function mineGitOutcomes(
	ports: MinerPorts,
	sinceRef: string,
	options: MinerOptions,
): Promise<Result<MineSummary, OutcomeError>> {
	const hotfixWindow = options.hotfixWindow ?? DEFAULT_HOTFIX_WINDOW;
	const valid = validate(sinceRef, hotfixWindow);
	if (!valid.ok) return valid;
	const git = (args: readonly string[]) => ports.git.run(options.root, args);

	const range = await git([
		"log",
		"--reverse",
		"--no-merges",
		"--format=%H%x1f%s%x1f%b%x1e",
		`${sinceRef}..HEAD`,
	]);
	if (!range.ok) return gitError(range.error);
	const commits = parseCommits(range.value);

	const diffCache = new Map<string, string>();
	const diffOf = async (sha: string): Promise<Result<string, OutcomeError>> => {
		const cached = diffCache.get(sha);
		if (cached !== undefined) return { ok: true, value: cached };
		const shown = await git([
			"show",
			"--format=",
			"--unified=0",
			"--no-color",
			"--no-ext-diff",
			"--no-textconv",
			"--no-renames",
			sha,
		]);
		if (!shown.ok) return gitError(shown.error);
		diffCache.set(sha, shown.value);
		return { ok: true, value: shown.value };
	};

	const linked: OutcomeRecord[] = [];
	let existing = 0;
	const link = (
		decisions: readonly CommitDecision[],
		kind: Outcome,
		ref: string,
	): Result<void, OutcomeError> => {
		for (const d of decisions) {
			const result = linkOutcome(ports, d.decisionId, {
				kind,
				source: "git",
				ref,
			});
			if (!result.ok) return result;
			if (result.value.created) linked.push(result.value.record);
			else existing += 1;
		}
		return { ok: true, value: undefined };
	};
	const diffDecisionsOf = (
		sha: string,
	): Result<readonly CommitDecision[], OutcomeError> => {
		const found = decisionsForCommit(ports, sha);
		return found.ok
			? { ok: true, value: found.value.filter(isDiffDecision) }
			: found;
	};

	for (const commit of commits) {
		const targets = revertTargets(commit);
		for (const target of targets) {
			const decisions = diffDecisionsOf(target);
			if (!decisions.ok) return decisions;
			const done = link(decisions.value, "reverted", commit.sha);
			if (!done.ok) return done;
		}
		if (targets.length > 0 || !isFix(commit)) continue;

		const prior = await git([
			"log",
			"--no-merges",
			"--format=%H",
			`--max-count=${hotfixWindow}`,
			"--skip=1",
			commit.sha,
		]);
		if (!prior.ok) return gitError(prior.error);
		let fixHunks: readonly Hunk[] | undefined;
		for (const sha of prior.value.split("\n").map((s) => s.trim())) {
			if (!isCommitSha(sha)) continue;
			const decisions = diffDecisionsOf(sha);
			if (!decisions.ok) return decisions;
			if (decisions.value.length === 0) continue;
			if (fixHunks === undefined) {
				const fixDiff = await diffOf(commit.sha);
				if (!fixDiff.ok) return fixDiff;
				fixHunks = parseHunks(fixDiff.value, "old");
			}
			const earlier = await diffOf(sha);
			if (!earlier.ok) return earlier;
			if (!overlaps(fixHunks, parseHunks(earlier.value, "new"))) continue;
			const done = link(decisions.value, "hotfixed", commit.sha);
			if (!done.ok) return done;
		}
	}
	return { ok: true, value: { scanned: commits.length, linked, existing } };
}
