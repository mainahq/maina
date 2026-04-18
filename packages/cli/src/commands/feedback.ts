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

export class InvalidPrNumberError extends Error {
	constructor(public readonly token: string) {
		super(
			`Invalid --pr value: "${token}". Expected a positive integer or a comma-separated list of positive integers.`,
		);
		this.name = "InvalidPrNumberError";
	}
}

/**
 * Parse `--pr` values (Commander collects them into a string[]), allowing
 * comma-separated tokens within each entry.
 *
 * Throws {@link InvalidPrNumberError} on any non-positive-integer token.
 * Silently dropping bad input would be dangerous: an empty result switches
 * the command to auto-discovery, which could ingest from unrelated PRs.
 *
 * Exported for testability.
 */
export function parsePrNumbers(raw: string[] | undefined): number[] {
	if (!raw) return [];
	const out: number[] = [];
	for (const r of raw) {
		for (const part of r.split(",")) {
			const trimmed = part.trim();
			if (trimmed.length === 0) {
				throw new InvalidPrNumberError(part);
			}
			// Require a pure positive-integer string — reject leading +, decimals,
			// scientific notation, etc.
			if (!/^\d+$/.test(trimmed)) {
				throw new InvalidPrNumberError(trimmed);
			}
			const n = Number.parseInt(trimmed, 10);
			if (!Number.isFinite(n) || n <= 0) {
				throw new InvalidPrNumberError(trimmed);
			}
			out.push(n);
		}
	}
	return out;
}

/**
 * Action layer extracted for testability — no clack/process side effects.
 */
export async function feedbackIngestAction(
	options: FeedbackIngestOptions,
	deps: { ingest?: typeof ingestPrReviews } = {},
): Promise<FeedbackIngestResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");

	const repo = options.repo ?? (await getRepoSlug(cwd));
	let prNumbers: number[];
	try {
		prNumbers = parsePrNumbers(options.pr);
	} catch (e) {
		const message =
			e instanceof InvalidPrNumberError
				? e.message
				: e instanceof Error
					? e.message
					: String(e);
		return {
			ok: false,
			repo,
			prNumbers: [],
			ingested: 0,
			skipped: 0,
			error: message,
		};
	}
	const since = options.since ? Number.parseInt(options.since, 10) : 14;
	const reviewers = [...ALLOWED_REVIEWERS, ...(options.reviewer ?? [])];

	const runIngest = deps.ingest ?? ingestPrReviews;
	const result = await runIngest(mainaDir, {
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
				// Signal failure to CI / callers — ingest errors must not exit 0.
				process.exitCode = 1;
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
