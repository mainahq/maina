import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BuildReceiptInput,
	buildReceipt,
	type PipelineResult,
	type Receipt,
	renderReceiptHtml,
	runPipeline,
} from "@mainahq/core";
import { Command } from "commander";
import {
	EXIT_CONFIG_ERROR,
	EXIT_FINDINGS,
	EXIT_PASSED,
	outputJson,
} from "../json";

export interface ReceiptActionOptions {
	all?: boolean;
	base?: string;
	json?: boolean;
	title?: string;
	outputDir?: string;
	cwd?: string;
}

export interface ReceiptActionResult {
	ok: boolean;
	hash?: string;
	jsonPath?: string;
	htmlPath?: string;
	passedCount?: number;
	totalCount?: number;
	status?: string;
	error?: { code: string; message: string };
}

const MAINA_DIR = ".maina";
const RECEIPTS_SUBDIR = "receipts";

export async function receiptAction(
	options: ReceiptActionOptions = {},
): Promise<ReceiptActionResult> {
	const cwd = options.cwd ?? process.cwd();

	const pipeline = await runVerifyPipeline(cwd, options);
	const { constitutionHash, promptsHash } = loadPromptVersion(cwd);

	const buildInput: BuildReceiptInput = {
		prTitle: options.title ?? (await detectPrTitle()),
		pipeline,
		constitutionHash,
		promptsHash,
		cwd,
	};

	const built = await buildReceipt(buildInput);
	if (!built.ok) {
		return { ok: false, error: { code: built.code, message: built.message } };
	}

	const outputDir = options.outputDir ?? join(cwd, MAINA_DIR, RECEIPTS_SUBDIR);
	const { jsonPath, htmlPath } = writeReceipt(outputDir, built.data);
	const passedCount = built.data.checks.filter(
		(c) => c.status === "passed",
	).length;
	return {
		ok: true,
		hash: built.data.hash,
		jsonPath,
		htmlPath,
		passedCount,
		totalCount: built.data.checks.length,
		status: built.data.status,
	};
}

async function runVerifyPipeline(
	cwd: string,
	options: ReceiptActionOptions,
): Promise<PipelineResult> {
	return runPipeline({
		cwd,
		baseBranch: options.base ?? "main",
		diffOnly: !options.all,
	});
}

function loadPromptVersion(cwd: string): {
	constitutionHash: string;
	promptsHash: string;
} {
	return {
		constitutionHash: hashFileIfExists(join(cwd, MAINA_DIR, "constitution.md")),
		promptsHash: hashFileIfExists(join(cwd, MAINA_DIR, "prompts")),
	};
}

function hashFileIfExists(path: string): string {
	try {
		if (!existsSync(path)) return zeroHash();
		const content = readFileSync(path);
		return createHash("sha256").update(content).digest("hex");
	} catch {
		return zeroHash();
	}
}

function zeroHash(): string {
	return "0".repeat(64);
}

async function detectPrTitle(): Promise<string> {
	return "Untitled PR";
}

function writeReceipt(
	outputDir: string,
	receipt: Receipt,
): { jsonPath: string; htmlPath: string } {
	const targetDir = join(outputDir, receipt.hash);
	mkdirSync(targetDir, { recursive: true });
	const jsonPath = join(targetDir, "receipt.json");
	const htmlPath = join(targetDir, "index.html");
	writeFileSync(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
	writeFileSync(htmlPath, renderReceiptHtml(receipt), "utf-8");
	return { jsonPath, htmlPath };
}

export function receiptCommand(): Command {
	return new Command("receipt")
		.description(
			"Run the verify pipeline and emit a signed v1 receipt (JSON + HTML)",
		)
		.option("--all", "verify all tracked files, not just the diff")
		.option("--base <branch>", "base branch for diff comparison", "main")
		.option("--title <title>", "PR title (defaults to git-detected)")
		.option(
			"--output-dir <dir>",
			"override output directory (default .maina/receipts/)",
		)
		.option("--json", "emit structured JSON envelope instead of human output")
		.action(async (opts: ReceiptActionOptions) => {
			const result = await receiptAction(opts);
			const exitCode = result.ok ? EXIT_PASSED : EXIT_FINDINGS;

			if (opts.json) {
				outputJson(
					formatEnvelope(result),
					result.ok ? exitCode : EXIT_CONFIG_ERROR,
				);
				return;
			}
			if (result.ok) {
				process.stdout.write(
					`Receipt ${result.hash?.slice(0, 12)} — passed ${result.passedCount} of ${result.totalCount} checks (${result.status}).\n`,
				);
				process.stdout.write(`  JSON: ${result.jsonPath}\n`);
				process.stdout.write(`  HTML: ${result.htmlPath}\n`);
			} else {
				process.stderr.write(
					`Receipt generation failed [${result.error?.code}]: ${result.error?.message}\n`,
				);
			}
			process.exitCode = result.ok ? EXIT_PASSED : EXIT_CONFIG_ERROR;
		});
}

function formatEnvelope(result: ReceiptActionResult): unknown {
	if (result.ok) {
		return {
			data: {
				hash: result.hash,
				jsonPath: result.jsonPath,
				htmlPath: result.htmlPath,
				passed: result.passedCount,
				total: result.totalCount,
				status: result.status,
			},
			error: null,
			meta: { schemaVersion: "v1" },
		};
	}
	return {
		data: null,
		error: result.error,
		meta: { schemaVersion: "v1" },
	};
}
