import { join } from "node:path";
import { confirm, intro, log, outro, select, spinner } from "@clack/prompts";
import {
	analyseFeedback,
	analyseWorkflowFeedback,
	analyseWorkflowRuns,
	createCandidate,
	type PromptTask,
	resolveABTests,
} from "@maina/core";
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

export function learnCommand(): Command {
	return new Command("learn")
		.description("Analyse feedback and propose prompt improvements")
		.action(async () => {
			intro("maina learn");

			const repoRoot = process.cwd();
			const mainaDir = join(repoRoot, ".maina");

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
