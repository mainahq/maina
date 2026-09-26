/**
 * `maina receipt publish`: post a receipt to its PR as one sticky comment
 * and one check run (FR-RET-3). The verify Action calls it; it is opt-in
 * (`--opt-in`, set from the repository's `pr-comment` input) and, on a fork
 * PR (`--read-only`), writes the receipt to the job summary instead.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
	type CommentReceipt,
	type HttpPort,
	parseReceiptCommentExtras,
	publishReceipt,
	type ReceiptCommentExtras,
	type ReceiptPublishOutcome,
	verifyReceipt,
} from "@mainahq/core";
import { Command } from "commander";
import { EXIT_CONFIG_ERROR, EXIT_PASSED, outputJson } from "../json";
import { fetchHttp } from "../ports";

interface ReceiptPublishOptions {
	/** Path to the receipt JSON (`.maina/receipts/<hash>/receipt.json`). */
	receipt: string;
	/** Optional JSON with criteria, verify scope, gate tally, url. */
	context?: string;
	pr?: string;
	sha?: string;
	/** `owner/name`; defaults to `$GITHUB_REPOSITORY`. */
	repo?: string;
	/** The ref the verify run diffed against. */
	scopeBase?: string;
	/** Fallback link to the full receipt; a `url` in `--context` wins. */
	receiptUrl?: string;
	optIn?: boolean;
	readOnly?: boolean;
	/** Commander's `--no-discovery-line` sets this false. */
	discoveryLine?: boolean;
	/** Only a sticky comment by this login is updated. */
	author?: string;
	/** Where a fallback goes; defaults to `$GITHUB_STEP_SUMMARY`. */
	summaryFile?: string;
	cwd?: string;
}

interface ReceiptPublishDeps {
	http: HttpPort;
	env: (name: string) => string | undefined;
}

type Failure = { ok: false; error: { code: string; message: string } };

type ReceiptPublishResult =
	| { ok: true; outcome: ReceiptPublishOutcome; summaryPath?: string }
	| Failure;

const fail = (code: string, message: string): Failure => ({
	ok: false,
	error: { code, message },
});

export async function receiptPublishAction(
	options: ReceiptPublishOptions,
	deps: ReceiptPublishDeps,
): Promise<ReceiptPublishResult> {
	const cwd = options.cwd ?? process.cwd();
	const optIn = options.optIn === true;

	const loaded = loadReceipt(cwd, options);
	if (!loaded.ok) return loaded;

	const token = deps.env("GITHUB_TOKEN") ?? deps.env("GH_TOKEN") ?? "";
	if (optIn && token === "") {
		return fail("no_token", "Set GITHUB_TOKEN to publish the receipt.");
	}
	const repo = options.repo ?? deps.env("GITHUB_REPOSITORY") ?? "";
	const apiUrl = deps.env("GITHUB_API_URL");

	const published = await publishReceipt({
		pr: {
			repo,
			number: Number(options.pr ?? Number.NaN),
			headSha: options.sha ?? "",
		},
		receipt: loaded.receipt,
		auth: {
			token,
			readOnly: options.readOnly === true,
			...(apiUrl ? { apiUrl } : {}),
		},
		http: deps.http,
		optIn,
		discoveryLine: options.discoveryLine !== false,
		...(options.author ? { author: options.author } : {}),
	});
	if (!published.ok) {
		const { error } = published;
		return fail(error.kind, "message" in error ? error.message : error.kind);
	}

	const outcome = published.value;
	if (outcome.kind !== "fallback") return { ok: true, outcome };
	const summaryPath = options.summaryFile ?? deps.env("GITHUB_STEP_SUMMARY");
	if (!summaryPath) return { ok: true, outcome };
	try {
		appendFileSync(summaryPath, `${outcome.markdown}\n`, "utf-8");
	} catch (e) {
		return fail("io", `Could not write the job summary: ${String(e)}`);
	}
	return { ok: true, outcome, summaryPath };
}

function loadReceipt(
	cwd: string,
	options: ReceiptPublishOptions,
): { ok: true; receipt: CommentReceipt } | Failure {
	const raw = readJson(cwd, options.receipt);
	if (!raw.ok) return fail("io", raw.message);
	const verified = verifyReceipt(raw.value);
	if (!verified.ok) return fail(verified.code, verified.message);

	let extras: ReceiptCommentExtras = {};
	if (options.context) {
		const rawExtras = readJson(cwd, options.context);
		if (!rawExtras.ok) return fail("io", rawExtras.message);
		const parsed = parseReceiptCommentExtras(rawExtras.value);
		if (!parsed.ok) return fail(parsed.error.kind, parsed.error.message);
		extras = parsed.value;
	}

	const receipt = verified.data;
	const verifyScope =
		extras.verifyScope ??
		(options.scopeBase
			? {
					kind: "range" as const,
					base: options.scopeBase,
					files: receipt.diff.files,
				}
			: undefined);
	// A url the caller put in the context is the specific one; `--receipt-url`
	// is the fallback (the Action always passes its run URL).
	const url = extras.url ?? options.receiptUrl;
	return {
		ok: true,
		receipt: {
			...receipt,
			...extras,
			...(verifyScope ? { verifyScope } : {}),
			...(url ? { url } : {}),
		},
	};
}

function readJson(
	cwd: string,
	path: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
	const absolute = isAbsolute(path) ? path : resolve(cwd, path);
	try {
		return { ok: true, value: JSON.parse(readFileSync(absolute, "utf-8")) };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false, message: `Failed to read ${absolute}: ${message}` };
	}
}

function describeOutcome(result: ReceiptPublishResult): string {
	if (!result.ok) {
		return `Receipt publish failed [${result.error.code}]: ${result.error.message}\n`;
	}
	const { outcome } = result;
	switch (outcome.kind) {
		case "skipped":
			return "Receipt not published: the repository has not opted in (--opt-in).\n";
		case "published":
			return `Receipt published: comment ${outcome.commentId} (${outcome.comment}), check run ${outcome.checkRunId} (${outcome.check}).\n`;
		case "fallback":
			return result.summaryPath
				? `Token cannot write to this PR (${outcome.reason}); receipt written to the job summary.\n`
				: outcome.markdown;
		default: {
			const unreachable: never = outcome;
			return String(unreachable);
		}
	}
}

export function receiptPublishCommand(): Command {
	return (
		new Command("publish")
			.description(
				"Post a receipt to its PR as one sticky comment and one check run (opt-in)",
			)
			.requiredOption("--receipt <path>", "receipt JSON to publish")
			.option(
				"--context <path>",
				"JSON with criteria, verify scope and gate tally",
			)
			.option("--pr <number>", "pull request number")
			.option("--sha <sha>", "PR head commit for the check run")
			.option(
				"--repo <owner/name>",
				"base repository (default $GITHUB_REPOSITORY)",
			)
			// Not `--base`/`--json`: the parent `receipt` command owns those flags
			// and commander hands them to it wherever they appear.
			.option("--scope-base <ref>", "the ref the verify run diffed against")
			.option(
				"--receipt-url <url>",
				"link to the full receipt when --context gives none",
			)
			.option("--opt-in", "the repository opted in to PR receipts")
			.option(
				"--read-only",
				"the token cannot write (fork PR): use the job summary",
			)
			.option("--no-discovery-line", "leave out the one-line Maina footer")
			.option("--author <login>", "only update a sticky comment by this login")
			.option(
				"--summary-file <path>",
				"fallback target (default $GITHUB_STEP_SUMMARY)",
			)
			.addHelpText(
				"after",
				"\n`--json` (a `maina receipt` flag) emits a { data, error, meta } envelope.",
			)
			.action(async (opts: ReceiptPublishOptions, command: Command) => {
				const result = await receiptPublishAction(opts, {
					http: fetchHttp,
					env: (name) => process.env[name],
				});
				const exitCode = result.ok ? EXIT_PASSED : EXIT_CONFIG_ERROR;
				if (command.optsWithGlobals<{ json?: boolean }>().json) {
					outputJson(
						result.ok
							? { data: result, error: null, meta: { schemaVersion: "v1" } }
							: {
									data: null,
									error: result.error,
									meta: { schemaVersion: "v1" },
								},
						exitCode,
					);
					return;
				}
				const stream = result.ok ? process.stdout : process.stderr;
				stream.write(describeOutcome(result));
				process.exitCode = exitCode;
			})
	);
}
