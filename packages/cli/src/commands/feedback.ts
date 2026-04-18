/**
 * `maina feedback ingest` — pull external code-review comments (Copilot,
 * CodeRabbit, named humans) into `.maina/feedback.db` as labeled training
 * signal. v1 thin slice of issue #185 — RL closure (verify consults the DB)
 * is v2.
 */

import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import { ALLOWED_REVIEWERS, getRepoSlug, ingestPrReviews } from "@mainahq/core";
import { Command } from "commander";

export interface FeedbackIngestOptions {
	repo?: string;
	pr?: string[];
	since?: string;
	reviewer?: string[];
	json?: boolean;
	cwd?: string;
}

export interface FeedbackIngestResult {
	ok: boolean;
	repo: string;
	prNumbers: number[] | "auto";
	ingested: number;
	skipped: number;
	error?: string;
}

function parsePrNumbers(raw: string[] | undefined): number[] {
	if (!raw) return [];
	const out: number[] = [];
	for (const r of raw) {
		for (const part of r.split(",")) {
			const n = Number.parseInt(part.trim(), 10);
			if (!Number.isNaN(n)) out.push(n);
		}
	}
	return out;
}

/**
 * Action layer extracted for testability — no clack/process side effects.
 */
export async function feedbackIngestAction(
	options: FeedbackIngestOptions,
): Promise<FeedbackIngestResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");

	const repo = options.repo ?? (await getRepoSlug(cwd));
	const prNumbers = parsePrNumbers(options.pr);
	const since = options.since ? Number.parseInt(options.since, 10) : 14;
	const reviewers = [...ALLOWED_REVIEWERS, ...(options.reviewer ?? [])];

	const result = await ingestPrReviews(mainaDir, {
		repo,
		prNumbers: prNumbers.length > 0 ? prNumbers : undefined,
		sinceDays: Number.isNaN(since) ? 14 : since,
		allowedReviewers: reviewers,
	});

	if (!result.ok) {
		return {
			ok: false,
			repo,
			prNumbers: prNumbers.length > 0 ? prNumbers : "auto",
			ingested: 0,
			skipped: 0,
			error: result.error,
		};
	}

	return {
		ok: true,
		repo,
		prNumbers: prNumbers.length > 0 ? prNumbers : "auto",
		ingested: result.value.ingested,
		skipped: result.value.skipped,
	};
}

export function feedbackCommand(): Command {
	const cmd = new Command("feedback").description(
		"Manage external review-finding ingestion (RL training signal)",
	);

	cmd
		.command("ingest")
		.description(
			"Pull review comments from configured reviewers into .maina/feedback.db",
		)
		.option("--repo <slug>", "owner/repo (defaults to current git remote)")
		.option(
			"--pr <number>",
			"specific PR number (repeatable, comma-separated)",
			(value, prev: string[] = []) => [...prev, value],
		)
		.option("--since <days>", "look back this many days (default 14)", "14")
		.option(
			"--reviewer <login>",
			"add a reviewer login to the allow-list (repeatable)",
			(value, prev: string[] = []) => [...prev, value],
		)
		.option("--json", "Emit machine-readable JSON")
		.action(async (options: FeedbackIngestOptions) => {
			if (!options.json) intro("maina feedback ingest");

			const s = options.json ? null : spinner();
			s?.start("Pulling external review comments…");

			const result = await feedbackIngestAction(options);

			if (!result.ok) {
				s?.stop("Ingest failed.");
				if (options.json) {
					process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
					return;
				}
				log.error(result.error ?? "unknown error");
				outro("Done.");
				return;
			}

			s?.stop(
				`Ingested ${result.ingested} new finding(s) (${result.skipped} skipped).`,
			);

			if (options.json) {
				process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
				return;
			}

			log.message(
				[
					`  Repo: ${result.repo}`,
					`  PRs: ${result.prNumbers === "auto" ? "auto-discovered" : result.prNumbers.join(", ")}`,
					`  Ingested: ${result.ingested}`,
					`  Skipped: ${result.skipped} (already-stored or non-allow-listed reviewer)`,
				].join("\n"),
			);

			outro("Done.");
		});

	return cmd;
}
