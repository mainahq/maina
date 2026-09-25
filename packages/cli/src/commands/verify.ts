import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import type {
	CloudClient,
	Finding,
	FixSuggestion,
	PipelineResult,
	VerifyResultResponse,
	VerifyScope,
	VerifyStatus,
} from "@mainahq/core";
import {
	appendWorkflowStep,
	buildUsageEvent,
	captureUsage,
	checkAIAvailability,
	createCloudClient,
	generateFixes,
	getCurrentBranch,
	getDiff,
	getTrackedFiles,
	getWorkflowId,
	loadAuthConfig,
	recordFeedbackAsync,
	resolveBaseBranch,
	runPipeline,
	runVisualVerification,
	systemProcess,
	VERSION,
} from "@mainahq/core";
import { processEnv } from "../env";
import { telemetryContext } from "../ports";

const CLI_VERSION = VERSION;

import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

interface VerifyActionOptions {
	all?: boolean;
	/** Check the index only (the pre-#328 default) instead of the working tree. */
	staged?: boolean;
	fix?: boolean;
	json?: boolean;
	base?: string;
	deep?: boolean;
	visual?: boolean;
	cloud?: boolean;
	/** Run the tests the code graph selects for the change (FR-VER-5). */
	tests?: boolean;
	cwd?: string;
}

interface VerifyActionResult {
	/** `skipped` when nothing in scope was checked: not a pass, not a failure. */
	status: VerifyStatus;
	passed: boolean;
	scope: VerifyScope;
	findingsCount: number;
	hiddenCount: number;
	duration: number;
	syntaxErrors?: Array<{
		file: string;
		line: number;
		column: number;
		message: string;
	}>;
	fixSuggestions?: FixSuggestion[];
	json?: string;
}

// ── Formatting Helpers ───────────────────────────────────────────────────────

function formatFindingsTable(findings: Finding[]): string {
	if (findings.length === 0) return "  No findings.";
	const header = `  ${"Tool".padEnd(12)} ${"File".padEnd(20)} ${"Line".padStart(5)}  ${"Severity".padEnd(8)}  Message`;
	const separator = `  ${"─".repeat(12)} ${"─".repeat(20)} ${"─".repeat(5)}  ${"─".repeat(8)}  ${"─".repeat(30)}`;
	const rows = findings.map((f) => {
		const file =
			f.file.length > 18 ? `…${f.file.slice(f.file.length - 17)}` : f.file;
		return `  ${f.tool.padEnd(12)} ${file.padEnd(20)} ${String(f.line).padStart(5)}  ${f.severity.padEnd(8)}  ${f.message}`;
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

function formatFixSuggestions(suggestions: FixSuggestion[]): string {
	if (suggestions.length === 0) return "  No fix suggestions generated.";
	return suggestions
		.map((s) => {
			const header = `  Fix for ${s.finding.tool} at ${s.finding.file}:${s.finding.line} [${s.confidence}]`;
			const explanation = `  ${s.explanation}`;
			const diff = s.diff
				.split("\n")
				.map((line) => `    ${line}`)
				.join("\n");
			return `${header}\n${explanation}\n${diff}`;
		})
		.join("\n\n");
}

/** One line naming what was checked, so a result always states its scope. */
function describeScope(scope: VerifyScope, baseBranch: string): string {
	const label: Record<VerifyScope["kind"], string> = {
		"working-tree": `working tree vs ${baseBranch} (staged, unstaged, untracked)`,
		staged: "staged changes",
		range: `commits since ${baseBranch}`,
		files: "selected files",
	};
	return `Scope: ${label[scope.kind]}, ${scope.files.length} file(s).`;
}

// ── Cloud Verify ────────────────────────────────────────────────────────────

const DEFAULT_CLOUD_URL =
	process.env.MAINA_CLOUD_URL ?? "https://api.mainahq.com";

const CLOUD_POLL_INTERVAL_MS = 2_000;
const CLOUD_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Get the repo name from git remote origin URL.
 * Returns "owner/repo" format, or the raw remote URL if parsing fails.
 */
async function getRepoName(cwd: string): Promise<string> {
	try {
		const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = (await new Response(proc.stdout).text()).trim();
		const exitCode = await proc.exited;
		if (exitCode !== 0 || !output) return "unknown/repo";

		// Parse SSH: git@github.com:owner/repo.git
		const sshMatch = output.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
		if (sshMatch?.[1]) return sshMatch[1];

		// Parse HTTPS: https://github.com/owner/repo.git
		const httpsMatch = output.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
		if (httpsMatch?.[1]) return httpsMatch[1];

		return output;
	} catch {
		return "unknown/repo";
	}
}

function formatCloudFindings(
	findings: VerifyResultResponse["findings"],
): string {
	if (findings.length === 0) return "  No findings.";
	const header = `  ${"Tool".padEnd(12)} ${"File".padEnd(20)} ${"Line".padStart(5)}  ${"Severity".padEnd(8)}  Message`;
	const separator = `  ${"─".repeat(12)} ${"─".repeat(20)} ${"─".repeat(5)}  ${"─".repeat(8)}  ${"─".repeat(30)}`;
	const rows = findings.map((f) => {
		const file =
			f.file.length > 18 ? `…${f.file.slice(f.file.length - 17)}` : f.file;
		return `  ${f.tool.padEnd(12)} ${file.padEnd(20)} ${String(f.line).padStart(5)}  ${f.severity.padEnd(8)}  ${f.message}`;
	});
	return [header, separator, ...rows].join("\n");
}

interface CloudVerifyResult {
	passed: boolean;
	findingsCount: number;
	duration: number;
	proofKey: string | null;
	json?: string;
}

/**
 * Run verification on maina cloud.
 *
 * Submits the diff, polls for status, then fetches the full result.
 * Accepts optional overrides for the CloudClient and sleep function
 * so tests can mock them without touching real HTTP.
 */
export async function cloudVerifyAction(
	options: VerifyActionOptions,
	deps?: {
		client?: CloudClient;
		sleepFn?: (ms: number) => Promise<void>;
	},
): Promise<CloudVerifyResult> {
	const cwd = options.cwd ?? process.cwd();
	const baseBranch = await resolveBaseBranch(
		cwd,
		options.base ?? process.env.MAINA_BASE,
	);
	const sleepFn = deps?.sleepFn ?? ((ms: number) => Bun.sleep(ms));
	const startedAt = Date.now();

	// Cloud-path telemetry — `verifyAction` has its own started/completed
	// captures but the Commander action dispatches cloud runs to this
	// function directly, so we emit here too. Consent-gated inside
	// `captureUsage`.
	captureUsage(
		buildUsageEvent(
			"maina.verify.started",
			{ cloud: true, deep: false, visual: false, all: false },
			CLI_VERSION,
		),
		telemetryContext(process.cwd()),
	);

	// ── Step 1: Auth ──────────────────────────────────────────────────────
	let client: CloudClient;

	if (deps?.client) {
		client = deps.client;
	} else {
		const authResult = loadAuthConfig();
		if (!authResult.ok) {
			log.error("Not logged in. Run `maina login` first.");
			return { passed: false, findingsCount: 0, duration: 0, proofKey: null };
		}

		client = createCloudClient({
			baseUrl: DEFAULT_CLOUD_URL,
			token: authResult.value.accessToken,
		});
	}

	// ── Step 2: Build diff ────────────────────────────────────────────────
	const diff = await getDiff(`${baseBranch}...HEAD`, undefined, cwd);
	if (!diff) {
		log.error(
			"No diff found. Make sure you have commits ahead of the base branch.",
		);
		return { passed: false, findingsCount: 0, duration: 0, proofKey: null };
	}

	// ── Step 3: Get repo name ─────────────────────────────────────────────
	const repo = await getRepoName(cwd);

	// ── Step 4: Submit ────────────────────────────────────────────────────
	const submitResult = await client.submitVerify({ diff, repo, baseBranch });
	if (!submitResult.ok) {
		log.error(`Cloud submission failed: ${submitResult.error}`);
		return { passed: false, findingsCount: 0, duration: 0, proofKey: null };
	}

	const { jobId } = submitResult.value;

	// ── Step 5: Poll ──────────────────────────────────────────────────────
	const s = spinner();
	s.start("Queued for verification…");

	const deadline = Date.now() + CLOUD_TIMEOUT_MS;
	let finalStatus = "queued";

	while (Date.now() < deadline) {
		await sleepFn(CLOUD_POLL_INTERVAL_MS);

		const statusResult = await client.getVerifyStatus(jobId);
		if (!statusResult.ok) {
			s.stop("Poll failed");
			log.error(`Status poll failed: ${statusResult.error}`);
			return { passed: false, findingsCount: 0, duration: 0, proofKey: null };
		}

		const { status, currentStep } = statusResult.value;
		finalStatus = status;

		if (status === "done" || status === "failed") {
			s.stop(
				status === "done" ? "Verification complete." : "Verification failed.",
			);
			break;
		}

		s.message(currentStep || "Running…");
	}

	if (finalStatus !== "done" && finalStatus !== "failed") {
		s.stop("Timed out");
		log.error("Cloud verification timed out after 5 minutes.");
		return { passed: false, findingsCount: 0, duration: 0, proofKey: null };
	}

	// ── Step 6: Fetch result ──────────────────────────────────────────────
	const resultRes = await client.getVerifyResult(jobId);
	if (!resultRes.ok) {
		log.error(`Failed to fetch result: ${resultRes.error}`);
		return { passed: false, findingsCount: 0, duration: 0, proofKey: null };
	}

	const verifyResult = resultRes.value;

	// ── Step 7: Render ────────────────────────────────────────────────────
	if (options.json) {
		const jsonOutput = {
			passed: verifyResult.passed,
			findings: verifyResult.findings,
			findingsErrors: verifyResult.findingsErrors,
			findingsWarnings: verifyResult.findingsWarnings,
			proofKey: verifyResult.proofKey,
			duration: verifyResult.durationMs,
			cloud: true,
		};
		return {
			passed: verifyResult.passed,
			findingsCount: verifyResult.findings.length,
			duration: verifyResult.durationMs,
			proofKey: verifyResult.proofKey,
			json: JSON.stringify(jsonOutput, null, 2),
		};
	}

	if (verifyResult.findings.length > 0) {
		log.message(formatCloudFindings(verifyResult.findings));
	}

	if (verifyResult.passed) {
		log.success(`Cloud verification passed in ${verifyResult.durationMs}ms.`);
		if (verifyResult.proofKey) {
			log.info(`Proof key: ${verifyResult.proofKey}`);
		}
	} else {
		log.error(
			`Cloud verification failed: ${verifyResult.findings.length} finding(s).`,
		);
	}

	// ── Workflow tracking ─────────────────────────────────────────────────
	const wfMainaDir = join(cwd, ".maina");
	appendWorkflowStep(
		wfMainaDir,
		"verify",
		`Cloud pipeline ${verifyResult.passed ? "passed" : "failed"}: ${verifyResult.findings.length} findings, ${verifyResult.durationMs}ms.`,
	);

	captureUsage(
		buildUsageEvent(
			"maina.verify.completed",
			{
				cloud: true,
				passed: verifyResult.passed,
				findings: verifyResult.findings.length,
				durationMs: Date.now() - startedAt,
			},
			CLI_VERSION,
		),
		telemetryContext(process.cwd()),
	);

	return {
		passed: verifyResult.passed,
		findingsCount: verifyResult.findings.length,
		duration: verifyResult.durationMs,
		proofKey: verifyResult.proofKey,
	};
}

// ── Core Action (testable) ──────────────────────────────────────────────────

/**
 * The core verify logic, extracted so tests can call it directly
 * without going through Commander parsing.
 */
export async function verifyAction(
	options: VerifyActionOptions,
): Promise<VerifyActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");
	const baseBranch = await resolveBaseBranch(
		cwd,
		options.base ?? process.env.MAINA_BASE,
	);
	const startedAt = Date.now();

	// Consent-gated — `captureUsage` is a no-op unless the user opted in to
	// `usage` and the build-time key is set. Emitting at the action boundary keeps
	// cohort metrics honest even if the command bails later on a tool error.
	captureUsage(
		buildUsageEvent(
			"maina.verify.started",
			{
				deep: options.deep === true,
				cloud: options.cloud === true,
				visual: options.visual === true,
				all: options.all === true,
			},
			CLI_VERSION,
		),
		telemetryContext(process.cwd()),
	);

	// ── AI availability check ────────────────────────────────────────────
	const ai = checkAIAvailability(processEnv);
	if (!ai.available && !options.json) {
		log.warning("Running without AI — deterministic checks only.");
	}

	// ── Step 1: Determine files to check ──────────────────────────────────
	const pipelineOpts: {
		files?: string[];
		scope?: "working-tree" | "staged";
		baseBranch: string;
		diffOnly: boolean;
		deep: boolean;
		tests: boolean;
		cwd: string;
		mainaDir: string;
		env: NodeJS.ProcessEnv;
		process: typeof systemProcess;
	} = {
		baseBranch,
		diffOnly: !options.all,
		deep: options.deep ?? false,
		tests: options.tests === true,
		cwd,
		mainaDir,
		env: process.env,
		process: systemProcess,
	};

	if (options.all) {
		// --all: scan all tracked files in the repo
		const allFiles = await getTrackedFiles(cwd);
		pipelineOpts.files = allFiles;
	} else {
		// Default: staged + unstaged + untracked vs the base (#328).
		pipelineOpts.scope = options.staged ? "staged" : "working-tree";
	}

	// ── Step 2: Run pipeline ──────────────────────────────────────────────
	const pipelineResult: PipelineResult = await runPipeline(pipelineOpts);

	// ── Step 3: Build result ──────────────────────────────────────────────
	const result: VerifyActionResult = {
		status: pipelineResult.status,
		passed: pipelineResult.passed,
		scope: pipelineResult.scope,
		findingsCount: pipelineResult.findings.length,
		hiddenCount: pipelineResult.hiddenCount,
		duration: pipelineResult.duration,
	};

	// Syntax errors
	if (!pipelineResult.syntaxPassed && pipelineResult.syntaxErrors) {
		result.syntaxErrors = pipelineResult.syntaxErrors;
		if (!options.json) {
			log.error("Syntax check failed:");
			log.message(formatSyntaxErrors(pipelineResult.syntaxErrors));
		}
	}

	// Findings
	if (!options.json && pipelineResult.findings.length > 0) {
		log.message(formatFindingsTable(pipelineResult.findings));
	}

	// Tools that were detected but could not run are skipped, not passed (#389).
	if (!options.json) {
		for (const t of pipelineResult.tools) {
			if (t.notice) log.warning(t.notice);
		}
	}

	if (!options.json && pipelineResult.hiddenCount > 0) {
		log.info(
			`${pipelineResult.hiddenCount} pre-existing issue(s) hidden (diff-only mode).`,
		);
	}

	// ── Step 4: AI Fix suggestions (if --fix and findings exist) ──────────
	if (options.fix && pipelineResult.findings.length > 0) {
		const fixResult = await generateFixes(pipelineResult.findings, {
			mainaDir,
			cwd,
			env: processEnv,
		});
		result.fixSuggestions = fixResult.suggestions;

		if (!options.json && fixResult.suggestions.length > 0) {
			log.step("AI Fix Suggestions:");
			log.message(formatFixSuggestions(fixResult.suggestions));
		}
	}

	// ── Step 4b: Visual verification (if --visual) ──────────────────────
	if (options.visual) {
		const visualResult = await runVisualVerification(
			mainaDir,
			undefined,
			systemProcess,
		);

		if (!visualResult.skipped && visualResult.findings.length > 0) {
			if (!options.json) {
				log.step("Visual Verification:");
				for (const f of visualResult.findings as Finding[]) {
					const icon = f.severity === "warning" ? "⚠" : "ℹ";
					log.message(`  ${icon} ${f.file || "visual"}: ${f.message}`);
				}
			}

			// Add visual findings to the result
			result.findingsCount += visualResult.findings.length;
			if (
				(visualResult.findings as Finding[]).some((f) => f.severity === "error")
			) {
				result.passed = false;
				result.status = "failed";
			}
		} else if (visualResult.skipped && !options.json) {
			log.info(
				"Visual verification skipped (no baselines or Playwright not installed).",
			);
		}
	}

	// ── Step 5: JSON output ──────────────────────────────────────────────
	if (options.json) {
		const jsonOutput = {
			status: result.status,
			passed: result.passed,
			scope: pipelineResult.scope,
			syntaxPassed: pipelineResult.syntaxPassed,
			syntaxErrors: pipelineResult.syntaxErrors,
			findings: pipelineResult.findings,
			hiddenCount: pipelineResult.hiddenCount,
			tools: pipelineResult.tools.map((t) => ({
				tool: t.tool,
				findingsCount: t.findings.length,
				skipped: t.skipped,
				duration: t.duration,
				...(t.notice ? { notice: t.notice } : {}),
			})),
			duration: pipelineResult.duration,
			fixSuggestions: result.fixSuggestions,
		};
		result.json = JSON.stringify(jsonOutput, null, 2);
	}

	// ── Step 6: Summary ──────────────────────────────────────────────────
	if (!options.json) {
		log.info(describeScope(pipelineResult.scope, baseBranch));
		if (result.status === "passed") {
			const ran = pipelineResult.tools.filter((t) => !t.skipped).length;
			log.success(
				`Verification passed in ${pipelineResult.duration}ms. ${ran} tool(s) ran.`,
			);
		} else if (result.status === "skipped") {
			log.warning(
				pipelineResult.scope.files.length === 0
					? "Verification skipped: no changed files in scope."
					: "Verification skipped: no tool could check the files in scope.",
			);
		} else {
			log.error(
				`Verification failed: ${pipelineResult.findings.length} finding(s).`,
			);
		}
	}

	const wfMainaDir = join(cwd, ".maina");
	appendWorkflowStep(
		wfMainaDir,
		"verify",
		`Pipeline ${result.status}: ${result.findingsCount} findings, ${result.duration}ms.`,
	);

	const branch = await getCurrentBranch(cwd);
	const workflowId = getWorkflowId(branch);
	recordFeedbackAsync(
		wfMainaDir,
		{
			promptHash: "deterministic",
			task: "verify",
			accepted: result.passed,
			timestamp: new Date().toISOString(),
			workflowStep: "verify",
			workflowId,
		},
		{ env: processEnv },
	);

	captureUsage(
		buildUsageEvent(
			"maina.verify.completed",
			{
				passed: result.passed,
				findings: result.findingsCount,
				hidden: result.hiddenCount ?? 0,
				durationMs: Date.now() - startedAt,
				deep: options.deep === true,
				cloud: options.cloud === true,
			},
			CLI_VERSION,
		),
		telemetryContext(process.cwd()),
	);

	return result;
}

// ── Commander Command ────────────────────────────────────────────────────────

export function verifyCommand(): Command {
	return new Command("verify")
		.description("Run full verification pipeline")
		.option("--all", "Scan all files, not just changed")
		.option(
			"--staged",
			"Check staged changes only (default: the whole working tree vs the base)",
		)
		.option("--fix", "Show AI fix suggestions")
		.option("--json", "Output JSON for CI")
		.option(
			"--base <ref>",
			"Base branch for diff (default: $MAINA_BASE, origin/HEAD, master, main)",
		)
		.option(
			"--deep",
			"Force the standard-tier AI semantic review (the triage already runs it on large or sensitive diffs)",
		)
		.option(
			"--tests",
			"Also run the tests the code graph says the change can break (its blast radius)",
		)
		.option("--visual", "Run visual regression checks")
		.option("--cloud", "Run verification on maina cloud")
		.action(async (options) => {
			const isJson = options.json === true;

			if (!isJson) intro("maina verify");

			// ── Cloud path ──────────────────────────────────────────────
			if (options.cloud) {
				const result = await cloudVerifyAction({
					json: options.json,
					base: options.base,
					cloud: true,
				});

				if (isJson && result.json) {
					const { exitCodeFromResult, outputJson } = await import("../json");
					outputJson(JSON.parse(result.json), exitCodeFromResult(result));
					return;
				}

				if (result.passed) {
					outro("Cloud verification passed.");
				} else {
					process.exitCode = 1;
					outro("Cloud verification failed.");
				}
				return;
			}

			// ── Local path ──────────────────────────────────────────────
			const s = isJson ? null : spinner();
			s?.start("Running verification pipeline…");

			const result = await verifyAction({
				all: options.all,
				staged: options.staged,
				fix: options.fix,
				json: options.json,
				base: options.base,
				deep: options.deep,
				tests: options.tests,
				visual: options.visual,
			});

			s?.stop("Pipeline complete.");

			// Only a failure is a non-zero exit; a skip says so but does not
			// claim a pass (status/passed stay honest in the JSON).
			const failed = result.status === "failed";

			if (isJson && result.json) {
				const { EXIT_FINDINGS, EXIT_PASSED, outputJson } = await import(
					"../json"
				);
				outputJson(
					JSON.parse(result.json),
					failed ? EXIT_FINDINGS : EXIT_PASSED,
				);
				return;
			}

			if (failed) {
				process.exitCode = 1;
				outro("Verification failed.");
			} else {
				outro(
					result.status === "passed"
						? "Verification passed."
						: "Verification skipped: nothing was checked.",
				);
			}
		});
}
