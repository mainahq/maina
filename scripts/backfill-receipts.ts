#!/usr/bin/env bun
/**
 * Wave 3.1 backfill — produce a v1 receipt for each of the last N merged
 * PRs and write each one to `.maina/receipts/<hash>/`.
 *
 * Usage:
 *   bun run scripts/backfill-receipts.ts                  # last 10 merged PRs
 *   bun run scripts/backfill-receipts.ts --limit 25       # last 25
 *   bun run scripts/backfill-receipts.ts --dry-run        # don't check anything out
 *   bun run scripts/backfill-receipts.ts --repo own/repo  # explicit repo slug
 *
 * Safety rails (matches `maina apply-fix`):
 *   - aborts if the working tree is dirty
 *   - records the original branch and restores it on exit, even on error
 *   - skips a PR if `maina receipt` fails for it; doesn't abort the whole batch
 *
 * Output:
 *   - `.maina/receipts/<hash>/{receipt.json, index.html}` per PR
 *   - `.maina/receipts/index.html` listing all receipts (newest first)
 *   - Summary printed at the end with success/skip counts
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	type ReceiptActionResult,
	receiptAction,
} from "../packages/cli/src/commands/receipt";
import { writeIndexPage as writeReceiptIndexPage } from "../packages/core/src/receipt/index-page";

interface BackfillOptions {
	limit: number;
	dryRun: boolean;
	repo?: string;
	cwd: string;
}

interface MergedPr {
	number: number;
	title: string;
	baseRefName: string;
	mergeCommit: { oid: string } | null;
	author: { login: string };
}

interface BackfillSummary {
	processed: number;
	succeeded: number;
	skipped: Array<{ pr: number; reason: string }>;
	receiptsDir: string;
}

function parseArgs(): BackfillOptions {
	const argv = process.argv.slice(2);
	const opts: BackfillOptions = {
		limit: 10,
		dryRun: false,
		cwd: process.cwd(),
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--limit") {
			const next = argv[++i];
			if (!next || !/^\d+$/.test(next)) {
				throw new Error(`--limit requires a positive integer, got: ${next}`);
			}
			opts.limit = Number.parseInt(next, 10);
		} else if (arg?.startsWith("--limit=")) {
			const value = arg.slice("--limit=".length);
			if (!/^\d+$/.test(value)) {
				throw new Error(`--limit requires a positive integer, got: ${value}`);
			}
			opts.limit = Number.parseInt(value, 10);
		} else if (arg === "--dry-run") {
			opts.dryRun = true;
		} else if (arg === "--repo") {
			opts.repo = argv[++i];
		} else if (arg?.startsWith("--repo=")) {
			opts.repo = arg.slice("--repo=".length);
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`Unknown arg: ${arg}`);
		}
	}
	if (opts.limit < 1 || opts.limit > 200) {
		throw new Error(`--limit must be between 1 and 200, got: ${opts.limit}`);
	}
	return opts;
}

function printHelp(): void {
	process.stdout.write(`backfill-receipts — generate receipts for the last N merged PRs

Usage:
  bun run scripts/backfill-receipts.ts [options]

Options:
  --limit <n>      number of recent PRs to process (default: 10, max: 200)
  --dry-run        list PRs without checking anything out
  --repo <slug>    explicit owner/repo (default: current repo)
  --help, -h       show this help
`);
}

async function runGit(
	args: string[],
	cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { exitCode, stdout, stderr };
}

async function listMergedPrs(
	limit: number,
	repo?: string,
): Promise<MergedPr[]> {
	const args = [
		"pr",
		"list",
		"--state",
		"merged",
		"--limit",
		String(limit),
		"--json",
		"number,title,baseRefName,mergeCommit,author",
	];
	if (repo) args.push("--repo", repo);
	const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`gh pr list failed: ${stderr.trim() || stdout.trim()}`);
	}
	return JSON.parse(stdout) as MergedPr[];
}

async function ensureCleanWorkingTree(cwd: string): Promise<void> {
	const result = await runGit(["status", "--porcelain"], cwd);
	if (result.exitCode !== 0) {
		throw new Error(`git status failed: ${result.stderr.trim()}`);
	}
	if (result.stdout.trim().length > 0) {
		throw new Error(
			"Working tree is dirty — commit or stash before running backfill.\n" +
				"git status --porcelain output:\n" +
				result.stdout,
		);
	}
}

async function getCurrentBranch(cwd: string): Promise<string> {
	const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	if (result.exitCode !== 0) {
		throw new Error(`git rev-parse failed: ${result.stderr.trim()}`);
	}
	return result.stdout.trim();
}

async function backfillOne(
	pr: MergedPr,
	options: BackfillOptions,
): Promise<
	{ ok: true; receipt: ReceiptActionResult } | { ok: false; reason: string }
> {
	if (!pr.mergeCommit?.oid) {
		return { ok: false, reason: "no merge commit on record" };
	}

	const checkout = await runGit(
		["checkout", "--detach", pr.mergeCommit.oid],
		options.cwd,
	);
	if (checkout.exitCode !== 0) {
		return {
			ok: false,
			reason: `checkout ${pr.mergeCommit.oid.slice(0, 12)} failed: ${checkout.stderr.trim()}`,
		};
	}

	try {
		const receipt = await receiptAction({
			cwd: options.cwd,
			base: pr.baseRefName,
			title: pr.title,
			noIndex: true, // we'll refresh once at the end
		});
		return { ok: true, receipt };
	} catch (e) {
		return {
			ok: false,
			reason: `maina receipt threw: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

async function restoreBranch(branch: string, cwd: string): Promise<void> {
	const result = await runGit(["checkout", branch], cwd);
	if (result.exitCode !== 0) {
		// Don't throw — already in the cleanup path. Surface to stderr so the
		// user knows to recover by hand.
		process.stderr.write(
			`failed to restore branch ${branch}: ${result.stderr.trim()}\n`,
		);
	}
}

async function main(): Promise<void> {
	const options = parseArgs();
	const summary: BackfillSummary = {
		processed: 0,
		succeeded: 0,
		skipped: [],
		receiptsDir: join(options.cwd, ".maina", "receipts"),
	};

	const prs = await listMergedPrs(options.limit, options.repo);
	process.stdout.write(`found ${prs.length} merged PR(s)\n`);

	if (options.dryRun) {
		for (const pr of prs) {
			process.stdout.write(
				`  #${pr.number} ${pr.title} (base: ${pr.baseRefName}, by @${pr.author.login})\n`,
			);
		}
		return;
	}

	await ensureCleanWorkingTree(options.cwd);
	const originalBranch = await getCurrentBranch(options.cwd);
	mkdirSync(summary.receiptsDir, { recursive: true });

	let restored = false;
	const restore = async (): Promise<void> => {
		if (restored) return;
		restored = true;
		await restoreBranch(originalBranch, options.cwd);
	};

	process.on("SIGINT", () => {
		void restore().then(() => process.exit(130));
	});

	try {
		for (const pr of prs) {
			summary.processed += 1;
			process.stdout.write(`processing #${pr.number} ${pr.title} … `);
			const result = await backfillOne(pr, options);
			if (!result.ok) {
				summary.skipped.push({ pr: pr.number, reason: result.reason });
				process.stdout.write(`SKIP (${result.reason})\n`);
				continue;
			}
			if (!result.receipt.ok) {
				summary.skipped.push({
					pr: pr.number,
					reason: `${result.receipt.error?.code}: ${result.receipt.error?.message}`,
				});
				process.stdout.write(
					`SKIP (${result.receipt.error?.code ?? "unknown"})\n`,
				);
				continue;
			}
			summary.succeeded += 1;
			process.stdout.write(
				`ok (${result.receipt.hash?.slice(0, 12)}, ${result.receipt.passedCount}/${result.receipt.totalCount} passed)\n`,
			);
		}
	} finally {
		await restore();
	}

	if (existsSync(summary.receiptsDir)) {
		const indexResult = writeReceiptIndexPage(summary.receiptsDir);
		if (indexResult.ok) {
			process.stdout.write(
				`\nindex page refreshed: ${indexResult.entries} entries → ${indexResult.htmlPath}\n`,
			);
		} else {
			process.stderr.write(
				`\nindex page refresh failed: ${indexResult.message}\n`,
			);
		}
	}

	process.stdout.write(
		`\n=== backfill summary ===
processed: ${summary.processed}
succeeded: ${summary.succeeded}
skipped:   ${summary.skipped.length}
`,
	);
	if (summary.skipped.length > 0) {
		process.stdout.write("\nskipped PRs:\n");
		for (const s of summary.skipped) {
			process.stdout.write(`  #${s.pr}: ${s.reason}\n`);
		}
	}
	if (summary.succeeded === 0) {
		process.exitCode = 1;
	}
}

void main().catch((e) => {
	process.stderr.write(
		`backfill failed: ${e instanceof Error ? e.message : String(e)}\n`,
	);
	process.exitCode = 1;
});
