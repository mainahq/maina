import { join } from "node:path";
import { confirm, intro, log, outro, select, spinner } from "@clack/prompts";
import {
	analyseFeedback,
	analyseWorkflowFeedback,
	analyseWorkflowRuns,
	createCandidate,
	createCloudClient,
	exportFeedbackForCloud,
	getWikiEffectivenessReport,
	loadAuthConfig,
	type PromptTask,
	resolveABTests,
} from "@mainahq/core";
import { Command } from "commander";

const TASKS: PromptTask[] = [
	"review",
	"commit",
	"tests",
	"fix",
	"explain",
	"design",
	"context",
];

/** Minimum feedback samples before suggesting improvements */
const MIN_SAMPLES_FOR_LEARNING = 30;

const DEFAULT_CLOUD_URL =
	process.env.MAINA_CLOUD_URL ?? "https://api.mainahq.com";

export function learnCommand(): Command {
	return new Command("learn")
		.description("Analyse feedback and propose prompt improvements")
		.option("--no-interactive", "Skip interactive prompts (report only)")
		.option("--cloud", "Sync feedback with maina cloud and fetch improvements")
		.action(async (options) => {
			const interactive = options.interactive !== false;
			const cloud = options.cloud === true;
			intro("maina learn");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");

			// ── Cloud mode ──────────────────────────────────────────────────
			if (cloud) {
				await runCloudLearn(mainaDir);
				return;
			}

			// ── Local mode (existing behaviour) ─────────────────────────────
			const s = spinner();
			s.start("Analysing feedback across all tasks…");

			const analyses = TASKS.map((task) => analyseFeedback(mainaDir, task));

			s.stop("Analysis complete.");

			// Show summary table
			const header = `  ${"Task".padEnd(12)} ${"Samples".padStart(8)}  ${"Accept".padStart(8)}  Status`;
			const separator = `  ${"─".repeat(12)} ${"─".repeat(8)}  ${"─".repeat(8)}  ${"─".repeat(16)}`;

			const rows = analyses.map((a) => {
				const samples = String(a.totalSamples);
				const rate =
					a.totalSamples > 0 ? `${(a.acceptRate * 100).toFixed(0)}%` : "—";
				const status = a.needsImprovement
					? "needs improvement"
					: a.totalSamples >= MIN_SAMPLES_FOR_LEARNING
						? "healthy"
						: a.totalSamples > 0
							? "gathering data"
							: "no data";

				return `  ${a.task.padEnd(12)} ${samples.padStart(8)}  ${rate.padStart(8)}  ${status}`;
			});

			log.message([header, separator, ...rows].join("\n"));

			// Workflow step metrics
			const workflowSteps = analyseWorkflowFeedback(mainaDir);
			if (workflowSteps.length > 0) {
				log.step("Workflow Steps:");
				const wfHeader = `  ${"Step".padEnd(18)} ${"Samples".padStart(8)}  ${"Accept".padStart(8)}  Status`;
				const wfSeparator = `  ${"─".repeat(18)} ${"─".repeat(8)}  ${"─".repeat(8)}  ${"─".repeat(16)}`;
				const wfRows = workflowSteps.map((s) => {
					const rate =
						s.totalSamples > 0 ? `${(s.acceptRate * 100).toFixed(0)}%` : "—";
					const status = s.needsImprovement
						? "needs improvement"
						: s.totalSamples >= 10
							? "healthy"
							: s.totalSamples > 0
								? "gathering data"
								: "no data";
					return `  ${s.step.padEnd(18)} ${String(s.totalSamples).padStart(8)}  ${rate.padStart(8)}  ${status}`;
				});
				log.message([wfHeader, wfSeparator, ...wfRows].join("\n"));
			}

			// Recent workflow runs
			const workflowRuns = analyseWorkflowRuns(mainaDir, 5);
			if (workflowRuns.length > 0) {
				log.step("Recent Workflow Runs:");
				const runHeader = `  ${"Workflow ID".padEnd(14)} ${"Steps".padStart(6)}  ${"Passed".padStart(7)}  ${"Rate".padStart(6)}`;
				const runSeparator = `  ${"─".repeat(14)} ${"─".repeat(6)}  ${"─".repeat(7)}  ${"─".repeat(6)}`;
				const runRows = workflowRuns.map((r) => {
					const rate = `${(r.successRate * 100).toFixed(0)}%`;
					return `  ${r.workflowId.padEnd(14)} ${String(r.totalSteps).padStart(6)}  ${String(r.passedSteps).padStart(7)}  ${rate.padStart(6)}`;
				});
				log.message([runHeader, runSeparator, ...runRows].join("\n"));
			}

			// Wiki effectiveness
			const signalsFile = join(mainaDir, "wiki", ".signals.json");
			const wikiReport = getWikiEffectivenessReport(signalsFile);
			if (wikiReport.totalLoads > 0) {
				const uniqueCommands = new Set(
					wikiReport.articleStats.map((a) => a.article),
				).size;
				log.step("Wiki Effectiveness:");
				log.message(
					[
						`  Articles loaded: ${wikiReport.totalLoads} (across ${uniqueCommands} article(s))`,
						`  Accept rate: ${Math.round(wikiReport.acceptRate * 100)}%`,
					].join("\n"),
				);

				// Top effective articles (top 5 with at least 2 loads)
				const topArticles = wikiReport.articleStats
					.filter((a) => a.loads >= 2)
					.slice(0, 5);
				if (topArticles.length > 0) {
					const topLines = topArticles.map(
						(a) =>
							`    ${a.article} — ${Math.round(a.effectivenessScore * 100)}% (${a.accepts}/${a.loads})`,
					);
					log.message(
						["", "  Top effective articles:", ...topLines].join("\n"),
					);
				}

				// Negative-signal articles
				if (wikiReport.negativeArticles.length > 0) {
					const negLines = wikiReport.negativeArticles
						.slice(0, 5)
						.map((art) => {
							const stat = wikiReport.articleStats.find(
								(a) => a.article === art,
							);
							const detail = stat
								? ` — ${Math.round(stat.effectivenessScore * 100)}% (${stat.accepts}/${stat.loads})`
								: "";
							return `    ${art}${detail}`;
						});
					log.message(
						[
							"",
							"  Negative-signal articles (flag for recompilation):",
							...negLines,
						].join("\n"),
					);
				}

				// Dormant articles
				if (wikiReport.dormantArticles.length > 0) {
					log.message(
						`\n  Dormant articles (ebbinghaus < 0.2): ${wikiReport.dormantArticles.length}`,
					);
				}
			}

			// Resolve active A/B tests
			const resolutions = resolveABTests(mainaDir);
			if (resolutions.length > 0) {
				log.step("A/B Test Results:");
				for (const r of resolutions) {
					const rateInfo =
						r.candidateAcceptRate !== undefined
							? ` (candidate: ${(r.candidateAcceptRate * 100).toFixed(1)}%${r.incumbentAcceptRate !== undefined ? `, incumbent: ${(r.incumbentAcceptRate * 100).toFixed(1)}%` : ""})`
							: "";
					if (r.action === "promoted") {
						log.success(`  ${r.task}: PROMOTED${rateInfo} — ${r.reason}`);
					} else if (r.action === "retired") {
						log.warning(`  ${r.task}: RETIRED${rateInfo} — ${r.reason}`);
					} else {
						log.info(`  ${r.task}: continuing${rateInfo} — ${r.reason}`);
					}
				}
			}

			// Find tasks that need improvement and have enough data
			const improvable = analyses.filter(
				(a) => a.needsImprovement && a.totalSamples >= MIN_SAMPLES_FOR_LEARNING,
			);

			if (improvable.length === 0) {
				log.info(
					"No tasks have enough rejected feedback to propose improvements.",
				);
				log.info(
					`Need at least ${MIN_SAMPLES_FOR_LEARNING} samples with <60% accept rate.`,
				);
				outro("Done.");
				return;
			}

			log.warning(
				`${improvable.length} task(s) could benefit from prompt improvement.`,
			);

			if (!interactive) {
				for (const task of improvable) {
					log.step(
						`${task.task}: ${task.totalSamples} samples, ${(task.acceptRate * 100).toFixed(0)}% accept rate — needs improvement`,
					);
				}
				outro(
					"Done. Run without --no-interactive to create improvement candidates.",
				);
				return;
			}

			for (const task of improvable) {
				log.step(
					`${task.task}: ${task.totalSamples} samples, ${(task.acceptRate * 100).toFixed(0)}% accept rate`,
				);

				const action = await select({
					message: `What would you like to do with "${task.task}" prompt?`,
					options: [
						{
							value: "candidate",
							label: "Create improvement candidate for A/B testing",
						},
						{ value: "skip", label: "Skip for now" },
					],
				});

				if (typeof action === "symbol") {
					// User cancelled
					outro("Cancelled.");
					return;
				}

				if (action === "candidate") {
					const suggestion = `# Improved ${task.task} prompt\n\nThis prompt was auto-suggested based on ${task.totalSamples} feedback samples.\nAccept rate was ${(task.acceptRate * 100).toFixed(0)}% — below the 60% threshold.\n\nEdit this content in .maina/prompts/${task.task}.md to customize.\n\n## Constitution (non-negotiable)\n{{constitution}}\n\n## Instructions\nComplete the "${task.task}" task.\n\nIf anything is ambiguous, use [NEEDS CLARIFICATION: specific question] instead of guessing.\n`;

					const shouldCreate = await confirm({
						message: `Create candidate for "${task.task}" and start A/B testing?`,
					});

					if (shouldCreate === true) {
						createCandidate(mainaDir, task.task, suggestion);
						log.success(
							`Candidate created for "${task.task}". Will receive 20% of traffic.`,
						);
					}
				}
			}

			outro("Done.");
		});
}

// ── Cloud Learn ─────────────────────────────────────────────────────────────

async function runCloudLearn(mainaDir: string): Promise<void> {
	// 1. Load auth
	const authResult = loadAuthConfig();
	if (!authResult.ok) {
		log.error(authResult.error);
		outro("Not logged in. Run `maina login` first.");
		return;
	}

	const client = createCloudClient({
		baseUrl: DEFAULT_CLOUD_URL,
		token: authResult.value.accessToken,
	});

	const s = spinner();

	// 2. Export local feedback
	s.start("Exporting local feedback…");
	const events = exportFeedbackForCloud(mainaDir);
	s.stop(`Found ${events.length} local feedback event(s).`);

	// 3. Upload in chunks (max 100 per batch to avoid timeouts)
	if (events.length > 0) {
		const CHUNK_SIZE = 100;
		let totalReceived = 0;
		const chunks = Math.ceil(events.length / CHUNK_SIZE);
		s.start(`Uploading ${events.length} event(s) in ${chunks} batch(es)…`);
		for (let i = 0; i < events.length; i += CHUNK_SIZE) {
			const chunk = events.slice(i, i + CHUNK_SIZE);
			const uploadResult = await client.postFeedbackBatch(chunk);
			if (!uploadResult.ok) {
				s.stop(`Upload failed at batch ${Math.floor(i / CHUNK_SIZE) + 1}.`);
				log.error(uploadResult.error);
				break;
			}
			totalReceived += uploadResult.value.received;
			s.message(`Uploaded ${totalReceived}/${events.length}…`);
		}
		s.stop(`Uploaded ${totalReceived} event(s).`);
	} else {
		log.info("No local feedback to upload.");
	}

	// 3b. Upload workflow stats
	s.start("Syncing workflow stats…");
	const { exportWorkflowStats } = await import("@mainahq/core");
	const stats = exportWorkflowStats(mainaDir);
	if (stats) {
		const statsResult = await client.postWorkflowStats(stats);
		if (statsResult.ok) {
			s.stop(
				`Synced stats: ${stats.totalCommits} commits, ${stats.passRate > 0 ? `${(stats.passRate * 100).toFixed(0)}%` : "0%"} pass rate.`,
			);
		} else {
			s.stop("Stats sync skipped (endpoint not available).");
		}
	} else {
		s.stop("No local stats to sync.");
	}

	// 4. Fetch improvements
	s.start("Fetching improvement suggestions…");
	const improvementsResult = await client.getFeedbackImprovements();
	if (!improvementsResult.ok) {
		s.stop("Failed to fetch improvements.");
		log.error(improvementsResult.error);
		outro("Cloud sync failed.");
		return;
	}
	s.stop("Improvements received.");

	const { improvements, teamTotals } = improvementsResult.value;

	// 5. Display team totals
	log.step("Team Feedback Summary:");
	log.message(
		`  Total events: ${teamTotals.totalEvents}  Accept rate: ${(teamTotals.acceptRate * 100).toFixed(0)}%`,
	);

	// 6. Display improvements table
	if (improvements.length === 0) {
		log.info("No improvement suggestions from cloud.");
		outro("Done.");
		return;
	}

	const header = `  ${"Command".padEnd(14)} ${"Samples".padStart(8)}  ${"Accept".padStart(8)}  Status`;
	const separator = `  ${"─".repeat(14)} ${"─".repeat(8)}  ${"─".repeat(8)}  ${"─".repeat(18)}`;

	const rows = improvements.map((imp) => {
		const rate = `${(imp.acceptRate * 100).toFixed(0)}%`;
		return `  ${imp.command.padEnd(14)} ${String(imp.samples).padStart(8)}  ${rate.padStart(8)}  ${imp.status}`;
	});

	log.step("Cloud Improvements:");
	log.message([header, separator, ...rows].join("\n"));

	// 7. Highlight items needing improvement
	const needsWork = improvements.filter(
		(i) => i.status === "needs_improvement",
	);
	if (needsWork.length > 0) {
		log.warning(
			`${needsWork.length} command(s) need improvement based on team feedback.`,
		);
	}

	outro("Done.");
}
