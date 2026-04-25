/**
 * `maina feedback ingest` — pull external code-review comments (Copilot,
 * CodeRabbit, named humans) into `.maina/feedback.db` as labeled training
 * signal. v1 thin slice of issue #185 — RL closure (verify consults the DB)
 * is v2.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import {
	ALLOWED_REVIEWERS,
	countReceiptFpsByCheck,
	getRepoSlug,
	ingestPrReviews,
	queryReceiptFps,
	type Result,
	recordReceiptFp,
} from "@mainahq/core";
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
 * Returns `err(InvalidPrNumberError)` on any non-positive-integer token.
 * Silently dropping bad input would be dangerous: an empty result switches
 * the command to auto-discovery, which could ingest from unrelated PRs.
 */
export function parsePrNumbers(
	raw: string[] | undefined,
): Result<number[], InvalidPrNumberError> {
	if (!raw) return { ok: true, value: [] };
	const out: number[] = [];
	for (const r of raw) {
		for (const part of r.split(",")) {
			const trimmed = part.trim();
			if (trimmed.length === 0) {
				return { ok: false, error: new InvalidPrNumberError(part) };
			}
			// Require a pure positive-integer string — reject leading +, decimals,
			// scientific notation, etc.
			if (!/^\d+$/.test(trimmed)) {
				return { ok: false, error: new InvalidPrNumberError(trimmed) };
			}
			const n = Number.parseInt(trimmed, 10);
			if (!Number.isFinite(n) || n <= 0) {
				return { ok: false, error: new InvalidPrNumberError(trimmed) };
			}
			out.push(n);
		}
	}
	return { ok: true, value: out };
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
	const parsed = parsePrNumbers(options.pr);
	if (!parsed.ok) {
		return {
			ok: false,
			repo,
			prNumbers: [],
			ingested: 0,
			skipped: 0,
			error: parsed.error.message,
		};
	}
	const prNumbers = parsed.value;
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

	cmd
		.command("fp")
		.description(
			"Record a false-positive against a check on a receipt (per-policy)",
		)
		.argument("<receipt-hash>", "receipt sha256 (64 hex chars)")
		.argument("<check-id>", "id of the noisy check (e.g. biome-check)")
		.requiredOption("--reason <text>", "why this finding is a false positive")
		.option(
			"--constitution-hash <hash>",
			"override the constitution hash (defaults to receipt's promptVersion)",
		)
		.option(
			"--maina-dir <path>",
			"override .maina directory (default ./.maina)",
		)
		.option("--json", "emit machine-readable JSON")
		.action(
			(
				receiptHashArg: string,
				checkIdArg: string,
				options: {
					reason: string;
					constitutionHash?: string;
					mainaDir?: string;
					json?: boolean;
				},
			) => {
				const constitutionHash =
					options.constitutionHash ??
					inferConstitutionHashFromReceipt(receiptHashArg, options.mainaDir);

				if (!constitutionHash) {
					const message =
						"Could not infer constitutionHash from receipt — pass --constitution-hash explicitly.";
					if (options.json) {
						process.stdout.write(
							`${JSON.stringify({ ok: false, error: { code: "no-constitution-hash", message } })}\n`,
						);
					} else {
						log.error(message);
					}
					process.exitCode = 1;
					return;
				}

				const result = recordReceiptFp({
					checkId: checkIdArg,
					reason: options.reason,
					constitutionHash,
					receiptHash: receiptHashArg,
					mainaDir: options.mainaDir,
				});

				if (!result.ok) {
					if (options.json) {
						process.stdout.write(`${JSON.stringify(result)}\n`);
					} else {
						log.error(`FP recording failed: ${result.message}`);
					}
					process.exitCode = 1;
					return;
				}

				if (options.json) {
					process.stdout.write(
						`${JSON.stringify({ ok: true, data: result.data }, null, 2)}\n`,
					);
					return;
				}
				log.success(
					`Recorded FP for ${result.data.checkId} — ${result.data.id.slice(0, 8)}…`,
				);
			},
		);

	cmd
		.command("fps")
		.description("List recorded false-positive feedback")
		.option(
			"--constitution-hash <hash>",
			"only show FPs for this constitution version",
		)
		.option("--check-id <id>", "only show FPs for this check id")
		.option("--maina-dir <path>", "override .maina directory")
		.option("--json", "emit machine-readable JSON")
		.action(
			(options: {
				constitutionHash?: string;
				checkId?: string;
				mainaDir?: string;
				json?: boolean;
			}) => {
				const result = queryReceiptFps({
					constitutionHash: options.constitutionHash,
					checkId: options.checkId,
					mainaDir: options.mainaDir,
				});
				if (!result.ok) {
					if (options.json) {
						process.stdout.write(`${JSON.stringify(result)}\n`);
					} else {
						log.error(`query failed: ${result.message}`);
					}
					process.exitCode = 1;
					return;
				}
				if (options.json) {
					process.stdout.write(
						`${JSON.stringify({ ok: true, data: result.data }, null, 2)}\n`,
					);
					return;
				}
				if (result.data.length === 0) {
					log.info("No false-positive feedback recorded for that filter.");
					return;
				}
				if (options.constitutionHash) {
					const countResult = countReceiptFpsByCheck(
						options.constitutionHash,
						options.mainaDir,
					);
					if (countResult.ok) {
						const summary = Array.from(countResult.data.entries())
							.sort((a, b) => b[1] - a[1])
							.map(([check, n]) => `  ${check}: ${n}`)
							.join("\n");
						log.message(`Counts by check (constitution-scoped):\n${summary}`);
					}
				}
				const lines = result.data.map(
					(r) =>
						`  [${r.createdAt}] ${r.checkId} — ${r.reason} (constitution=${r.constitutionHash.slice(0, 12)}…)`,
				);
				log.message(lines.join("\n"));
			},
		);

	return cmd;
}

/**
 * Best-effort: read `.maina/receipts/<hash>/receipt.json` and pull
 * `promptVersion.constitutionHash`. Returns undefined when missing/malformed
 * — caller falls back to the explicit --constitution-hash flag.
 */
function inferConstitutionHashFromReceipt(
	receiptHash: string,
	mainaDir?: string,
): string | undefined {
	if (!/^[0-9a-f]{64}$/.test(receiptHash)) return undefined;
	try {
		const root = mainaDir ?? ".maina";
		const path = join(root, "receipts", receiptHash, "receipt.json");
		// biome-ignore lint/suspicious/noExplicitAny: tolerate any malformed JSON shape
		const data: any = JSON.parse(readFileSync(path, "utf-8"));
		const hash = data?.promptVersion?.constitutionHash;
		return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)
			? hash
			: undefined;
	} catch {
		return undefined;
	}
}
