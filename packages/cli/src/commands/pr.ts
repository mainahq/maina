import { log } from "@clack/prompts";
import {
	getCurrentBranch as coreGetCurrentBranch,
	getDiff as coreGetDiff,
	getRecentCommits as coreGetRecentCommits,
	runTwoStageReview as coreRunTwoStageReview,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PrActionOptions {
	title?: string;
	base?: string; // base branch, default "main"
	draft?: boolean;
	cwd?: string;
}

export interface PrActionResult {
	created: boolean;
	reason?: string;
	url?: string;
	reviewPassed?: boolean;
}

export interface PrDeps {
	createPr: (options: {
		title: string;
		body: string;
		base: string;
		draft: boolean;
		cwd: string;
	}) => Promise<
		{ ok: true; value: { url: string } } | { ok: false; error: string }
	>;
	getDiff: (ref1?: string, ref2?: string, cwd?: string) => Promise<string>;
	getRecentCommits: (
		n: number,
		cwd?: string,
	) => Promise<Array<{ hash: string; message: string }>>;
	getCurrentBranch: (cwd?: string) => Promise<string>;
	runTwoStageReview: (
		...args: Parameters<typeof coreRunTwoStageReview>
	) => ReturnType<typeof coreRunTwoStageReview>;
}

// ── Default createPr implementation ─────────────────────────────────────────

async function defaultCreatePr(options: {
	title: string;
	body: string;
	base: string;
	draft: boolean;
	cwd: string;
}): Promise<
	{ ok: true; value: { url: string } } | { ok: false; error: string }
> {
	try {
		const args = [
			"pr",
			"create",
			"--title",
			options.title,
			"--body",
			options.body,
			"--base",
			options.base,
		];

		if (options.draft) {
			args.push("--draft");
		}

		const proc = Bun.spawn(["gh", ...args], {
			cwd: options.cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			const message = stderr.trim() || stdout.trim();
			if (
				message.includes("not found") ||
				message.includes("command not found")
			) {
				return {
					ok: false,
					error: "gh CLI not found. Install from https://cli.github.com",
				};
			}
			return { ok: false, error: message };
		}

		const url = stdout.trim();
		return { ok: true, value: { url } };
	} catch {
		return {
			ok: false,
			error: "gh CLI not found. Install from https://cli.github.com",
		};
	}
}

const defaultDeps: PrDeps = {
	createPr: defaultCreatePr,
	getDiff: coreGetDiff,
	getRecentCommits: coreGetRecentCommits,
	getCurrentBranch: coreGetCurrentBranch,
	runTwoStageReview: coreRunTwoStageReview,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a PR title from the branch name.
 * e.g., "feat/add-user-auth" → "feat: add-user-auth"
 */
function titleFromBranch(branch: string): string {
	// Strip common prefixes and convert to title-like string
	const parts = branch.split("/");
	if (parts.length > 1) {
		return `${parts[0]}: ${parts.slice(1).join("/")}`;
	}
	return branch;
}

/**
 * Format review findings for the PR body.
 */
function formatReviewFindings(
	findings: Array<{
		stage: string;
		severity: string;
		message: string;
		file?: string;
		line?: number;
	}>,
): string {
	if (findings.length === 0) return "No findings.";

	return findings
		.map((f) => {
			const location = f.file
				? ` (${f.file}${f.line ? `:${f.line}` : ""})`
				: "";
			const icon =
				f.severity === "error" ? "x" : f.severity === "warning" ? "!" : "i";
			return `- [${icon}] ${f.message}${location}`;
		})
		.join("\n");
}

// ── Core Action (testable) ──────────────────────────────────────────────────

/**
 * The core PR logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function prAction(
	options: PrActionOptions,
	deps: PrDeps = defaultDeps,
): Promise<PrActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const base = options.base ?? "main";
	const draft = options.draft ?? false;

	// ── Step 1: Get current branch and diff ──────────────────────────────
	const branch = await deps.getCurrentBranch(cwd);
	// Use origin/<base> for PR diff to catch all commits since push,
	// fall back to local <base> if remote ref doesn't exist
	const remoteBase = `origin/${base}`;
	let diff = await deps.getDiff(`${remoteBase}...HEAD`, undefined, cwd);
	if (!diff || diff.trim().length === 0) {
		diff = await deps.getDiff(`${base}...HEAD`, undefined, cwd);
	}

	if (!diff || diff.trim().length === 0) {
		log.error(`No diff found between ${base} and current branch.`);
		return { created: false, reason: `No diff against ${base}` };
	}

	// ── Step 2: Run two-stage review ─────────────────────────────────────
	const reviewResult = await deps.runTwoStageReview({ diff });

	// Display review results
	if (reviewResult.stage1.findings.length > 0) {
		log.warning("Spec compliance findings:");
		log.message(formatReviewFindings(reviewResult.stage1.findings));
	} else {
		log.success("Spec compliance: passed");
	}

	if (reviewResult.stage2) {
		if (reviewResult.stage2.findings.length > 0) {
			log.warning("Code quality findings:");
			log.message(formatReviewFindings(reviewResult.stage2.findings));
		} else {
			log.success("Code quality: passed");
		}
	}

	// ── Step 3: Build PR description ─────────────────────────────────────
	const commits = await deps.getRecentCommits(20, cwd);

	const commitList =
		commits.length > 0
			? commits.map((c) => `- ${c.message} (${c.hash.slice(0, 7)})`).join("\n")
			: "No commits found.";

	const reviewSection = reviewResult.passed
		? "All checks passed."
		: formatReviewFindings([
				...reviewResult.stage1.findings,
				...(reviewResult.stage2?.findings ?? []),
			]);

	const body = `## Changes

${commitList}

## Review

${reviewSection}`;

	// ── Step 4: Resolve title ────────────────────────────────────────────
	const title = options.title ?? titleFromBranch(branch);

	// ── Step 5: Create PR ────────────────────────────────────────────────
	const result = await deps.createPr({
		title,
		body,
		base,
		draft,
		cwd,
	});

	if (!result.ok) {
		log.error(result.error);
		return {
			created: false,
			reason: result.error,
			reviewPassed: reviewResult.passed,
		};
	}

	log.success(`PR created: ${result.value.url}`);

	return {
		created: true,
		url: result.value.url,
		reviewPassed: reviewResult.passed,
	};
}

// ── Commander Command ───────────────────────────────────────────────────────

export function prCommand(): Command {
	return new Command("pr")
		.description("Create a PR with two-stage review")
		.option("-t, --title <title>", "PR title")
		.option("--base <branch>", "Base branch", "main")
		.option("--draft", "Create as draft PR")
		.action(async (options) => {
			const { intro, outro } = await import("@clack/prompts");
			intro("maina pr");

			const result = await prAction({
				title: options.title,
				base: options.base,
				draft: options.draft,
			});

			if (result.created) {
				outro(`Created: ${result.url}`);
			} else {
				outro(`Aborted: ${result.reason}`);
			}
		});
}
