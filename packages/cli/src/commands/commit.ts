import { join } from "node:path";
import { intro, log, outro, text } from "@clack/prompts";
import {
	getCurrentBranch,
	getStagedFiles,
	recordOutcome,
	runHooks,
	runPipeline,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CommitActionOptions {
	message?: string;
	skip?: boolean;
	noVerify?: boolean;
	cwd?: string;
}

export interface CommitActionResult {
	committed: boolean;
	reason?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFindings(
	findings: Array<{
		file: string;
		line: number;
		message: string;
		severity: string;
		tool: string;
	}>,
): string {
	if (findings.length === 0) return "  No findings.";
	const header = `  ${"File".padEnd(30)} ${"Line".padStart(5)}  ${"Severity".padEnd(8)}  ${"Tool".padEnd(12)}  Message`;
	const separator = `  ${"─".repeat(30)} ${"─".repeat(5)}  ${"─".repeat(8)}  ${"─".repeat(12)}  ${"─".repeat(30)}`;
	const rows = findings.map((f) => {
		const file =
			f.file.length > 28 ? `…${f.file.slice(f.file.length - 27)}` : f.file;
		return `  ${file.padEnd(30)} ${String(f.line).padStart(5)}  ${f.severity.padEnd(8)}  ${f.tool.padEnd(12)}  ${f.message}`;
	});
	return [header, separator, ...rows].join("\n");
}

function formatSyntaxErrors(
	errors: Array<{
		file: string;
		line: number;
		column: number;
		message: string;
	}>,
): string {
	return errors
		.map((e) => `  ${e.file}:${e.line}:${e.column} — ${e.message}`)
		.join("\n");
}

// ── Git Commit Execution ─────────────────────────────────────────────────────

/**
 * Execute `git commit -m <message>` via Bun.spawn.
 * Extracted for testability.
 */
export async function gitCommit(
	message: string,
	cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["git", "commit", "-m", message], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { exitCode, stdout, stderr };
}

// ── Core Action (testable) ───────────────────────────────────────────────────

/** Dependency injection for testing */
export interface CommitDeps {
	gitCommit: (
		message: string,
		cwd: string,
	) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

const defaultDeps: CommitDeps = { gitCommit };

/**
 * The core commit logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function commitAction(
	options: CommitActionOptions,
	deps: CommitDeps = defaultDeps,
): Promise<CommitActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");

	// ── Step 1: Get staged files ──────────────────────────────────────────
	const stagedFiles = await getStagedFiles(cwd);

	if (stagedFiles.length === 0) {
		log.error("Nothing staged. Use `git add` first.");
		return { committed: false, reason: "Nothing staged" };
	}

	// ── Step 2: Pre-commit hooks (unless --no-verify) ─────────────────────
	if (!options.noVerify) {
		const branch = await getCurrentBranch(cwd);
		const hookContext = {
			event: "pre-commit" as const,
			repoRoot: cwd,
			mainaDir,
			stagedFiles,
			branch,
			timestamp: new Date().toISOString(),
		};

		const hookResult = await runHooks(mainaDir, "pre-commit", hookContext);

		if (hookResult.status === "block") {
			log.error(`Pre-commit hook blocked: ${hookResult.message}`);
			return {
				committed: false,
				reason: `Pre-commit hook blocked: ${hookResult.message}`,
			};
		}

		if (hookResult.status === "warn") {
			log.warning(`Hook warning: ${hookResult.message}`);
		}
	}

	// ── Step 3: Verification pipeline (unless --skip or --no-verify) ──────
	if (!options.skip && !options.noVerify) {
		const pipelineResult = await runPipeline({
			files: stagedFiles,
			cwd,
			mainaDir,
		});

		// Syntax failure → abort immediately
		if (!pipelineResult.syntaxPassed) {
			log.error("Syntax check failed:");
			if (pipelineResult.syntaxErrors) {
				log.message(formatSyntaxErrors(pipelineResult.syntaxErrors));
			}

			// Record rejection in feedback
			recordOutcome(mainaDir, "commit-gate", {
				accepted: false,
				command: "commit",
				context: "syntax failure",
			});

			return { committed: false, reason: "Verification failed: syntax errors" };
		}

		// Show summary
		if (pipelineResult.findings.length > 0) {
			log.message(formatFindings(pipelineResult.findings));
		}

		if (pipelineResult.hiddenCount > 0) {
			log.info(
				`${pipelineResult.hiddenCount} pre-existing finding(s) hidden (diff-only mode).`,
			);
		}

		// Pipeline failure → abort
		if (!pipelineResult.passed) {
			log.error(
				`Verification failed: ${pipelineResult.findings.length} finding(s) with errors.`,
			);

			recordOutcome(mainaDir, "commit-gate", {
				accepted: false,
				command: "commit",
				context: `pipeline failed: ${pipelineResult.findings.length} findings`,
			});

			return {
				committed: false,
				reason: "Verification failed: error findings detected",
			};
		}

		log.success(
			`Verification passed in ${pipelineResult.duration}ms. ${pipelineResult.tools.length} tool(s) ran.`,
		);
	} else if (options.skip) {
		log.warning("Verification skipped (--skip).");
	} else {
		log.warning("All verification and hooks skipped (--no-verify).");
	}

	// ── Step 4: Resolve commit message ────────────────────────────────────
	let message = options.message;

	if (!message) {
		const userMessage = await text({
			message: "Commit message:",
			placeholder: "feat: describe your change",
			validate: (value) => {
				if (!value || value.trim().length === 0) {
					return "Commit message is required.";
				}
			},
		});

		if (typeof userMessage === "symbol") {
			return { committed: false, reason: "Cancelled by user" };
		}

		message = userMessage;
	}

	// ── Step 5: Git commit ────────────────────────────────────────────────
	const { exitCode, stdout, stderr } = await deps.gitCommit(message, cwd);

	if (exitCode !== 0) {
		log.error(`git commit failed: ${stderr.trim() || stdout.trim()}`);
		return { committed: false, reason: `git commit failed (exit ${exitCode})` };
	}

	log.success(stdout.trim());

	// ── Step 6: Post-commit hooks (unless --no-verify) ────────────────────
	if (!options.noVerify) {
		const branch = await getCurrentBranch(cwd);
		const postHookContext = {
			event: "post-commit" as const,
			repoRoot: cwd,
			mainaDir,
			stagedFiles,
			branch,
			timestamp: new Date().toISOString(),
		};

		const postResult = await runHooks(mainaDir, "post-commit", postHookContext);

		if (postResult.status === "warn") {
			log.warning(`Post-commit hook warning: ${postResult.message}`);
		}
	}

	// ── Step 7: Record success in feedback ────────────────────────────────
	recordOutcome(mainaDir, "commit-gate", {
		accepted: true,
		command: "commit",
		context: `committed: ${message}`,
	});

	return { committed: true };
}

// ── Commander Command ────────────────────────────────────────────────────────

export function commitCommand(): Command {
	return new Command("commit")
		.description("Verify and commit staged changes")
		.option("-m, --message <msg>", "Commit message")
		.option("--skip", "Skip verification (not recommended)")
		.option("--no-verify", "Skip all verification and hooks")
		.action(async (options) => {
			intro("maina commit");

			const result = await commitAction({
				message: options.message,
				skip: options.skip,
				noVerify: !options.verify, // Commander parses --no-verify as verify: false
			});

			if (result.committed) {
				outro("Committed!");
			} else {
				outro(`Aborted: ${result.reason}`);
			}
		});
}
