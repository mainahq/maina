import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import {
	type BuildReceiptInput,
	buildReceipt,
	type DiffStats,
	deriveChecksAndStatus,
	generateWalkthrough,
	getDiffStats,
	getStagedFiles,
	getTrackedFiles,
	type PipelineResult,
	type Receipt,
	renderReceiptHtml,
	runPipeline,
	writeReceiptIndexPage,
} from "@mainahq/core";
import { Command } from "commander";
import { EXIT_FINDINGS, EXIT_PASSED, outputJson } from "../json";

export interface ReceiptActionOptions {
	all?: boolean;
	base?: string;
	json?: boolean;
	title?: string;
	outputDir?: string;
	cwd?: string;
	noIndex?: boolean;
	/** Explicit file list to verify. When set, overrides --all/staged
	 * detection — useful for backfill scripts that compute a PR's
	 * diff scope directly. */
	files?: string[];
	/** Pre-computed diff stats. Backfill computes its own range
	 * (`<commit>^..<commit>`) and passes the result through; otherwise
	 * receiptAction shells out to `git diff --shortstat` itself. */
	diff?: DiffStats;
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
const DEFAULT_BASE_BRANCH = "master";

export async function receiptAction(
	options: ReceiptActionOptions = {},
): Promise<ReceiptActionResult> {
	const cwd = options.cwd ?? process.cwd();

	const pipeline = await runVerifyPipeline(cwd, options);
	const { constitutionHash, promptsHash } = loadPromptVersion(cwd);
	const prTitle = options.title ?? "Untitled PR";
	const diff = options.diff ?? (await resolveDiffStats(cwd, options));
	const retries = 0;

	// Use the *same* check derivation that buildReceipt will use — guarantees
	// the walkthrough names the same checks and reports the same status that
	// end up signed in the receipt body.
	const { checks: derivedChecks, status: derivedStatus } =
		deriveChecksAndStatus(pipeline, retries);

	const walkthrough = await generateWalkthrough({
		prTitle,
		diff,
		status: derivedStatus,
		retries,
		mainaDir: join(cwd, MAINA_DIR),
		checks: derivedChecks.map((c) => ({
			name: c.name,
			tool: c.tool,
			status: c.status,
			findingsCount: c.findings.length,
		})),
	});

	const buildInput: BuildReceiptInput = {
		prTitle,
		pipeline,
		constitutionHash,
		promptsHash,
		walkthrough: walkthrough.text,
		diff,
		retries,
		cwd,
	};

	const built = await buildReceipt(buildInput);
	if (!built.ok) {
		return { ok: false, error: { code: built.code, message: built.message } };
	}

	const outputDir = options.outputDir ?? join(cwd, MAINA_DIR, RECEIPTS_SUBDIR);
	const writeResult = writeReceipt(outputDir, built.data);
	if (!writeResult.ok) {
		return {
			ok: false,
			error: { code: "io", message: writeResult.message },
		};
	}

	// Refresh the listing page after writing the receipt — best-effort. A
	// failure here shouldn't fail receipt generation; the per-receipt page
	// is the load-bearing artifact.
	if (!options.noIndex) {
		writeReceiptIndexPage(outputDir);
	}

	const passedCount = built.data.checks.filter(
		(c) => c.status === "passed",
	).length;
	return {
		ok: true,
		hash: built.data.hash,
		jsonPath: writeResult.jsonPath,
		htmlPath: writeResult.htmlPath,
		passedCount,
		totalCount: built.data.checks.length,
		status: built.data.status,
	};
}

async function resolveDiffStats(
	cwd: string,
	options: ReceiptActionOptions,
): Promise<DiffStats> {
	// `--all` walks every tracked file; line-level add/del don't apply.
	if (options.all) return { additions: 0, deletions: 0, files: 0 };
	// Default path: staged diff (what `maina receipt` runs against pre-merge).
	// Backfill always provides options.diff or options.files+base, so this
	// branch only fires for the live `maina receipt` invocation.
	return getDiffStats({ cwd, staged: true });
}

async function runVerifyPipeline(
	cwd: string,
	options: ReceiptActionOptions,
): Promise<PipelineResult> {
	let files: string[];
	if (options.files && options.files.length > 0) {
		files = options.files;
	} else if (options.all) {
		files = await getTrackedFiles(cwd);
	} else {
		files = await getStagedFiles(cwd);
	}
	return runPipeline({
		cwd,
		baseBranch: options.base ?? DEFAULT_BASE_BRANCH,
		// When the caller pinned a file list (e.g. backfill computing a
		// PR's diff scope), keep the diff filter on so findings still
		// scope to changed lines. Otherwise default to the legacy --all
		// switch behaviour.
		diffOnly: options.files && options.files.length > 0 ? true : !options.all,
		...(files && files.length > 0 ? { files } : {}),
	});
}

function loadPromptVersion(cwd: string): {
	constitutionHash: string;
	promptsHash: string;
} {
	return {
		constitutionHash: hashIfExists(join(cwd, MAINA_DIR, "constitution.md")),
		promptsHash: hashTreeIfExists(join(cwd, MAINA_DIR, "prompts")),
	};
}

function hashIfExists(path: string): string {
	try {
		if (!existsSync(path)) return zeroHash();
		const content = readFileSync(path);
		return createHash("sha256").update(content).digest("hex");
	} catch {
		return zeroHash();
	}
}

/**
 * Hash a directory deterministically: list files in sorted order, hash each
 * file's path-relative-to-root + content, then hash the concatenation.
 * Stable across runs; missing dir → zero hash.
 */
function hashTreeIfExists(root: string): string {
	try {
		if (!existsSync(root)) return zeroHash();
		const stat = statSync(root);
		if (stat.isFile()) {
			return hashIfExists(root);
		}
		const hasher = createHash("sha256");
		for (const file of walkSorted(root)) {
			const rel = relative(root, file);
			const content = readFileSync(file);
			hasher.update(rel);
			hasher.update("\0");
			hasher.update(content);
			hasher.update("\0");
		}
		return hasher.digest("hex");
	} catch {
		return zeroHash();
	}
}

function walkSorted(dir: string): string[] {
	const result: string[] = [];
	const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	);
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			result.push(...walkSorted(full));
		} else if (entry.isFile()) {
			result.push(full);
		}
	}
	return result;
}

function zeroHash(): string {
	return "0".repeat(64);
}

function writeReceipt(
	outputDir: string,
	receipt: Receipt,
):
	| { ok: true; jsonPath: string; htmlPath: string }
	| { ok: false; message: string } {
	try {
		const targetDir = join(outputDir, receipt.hash);
		mkdirSync(targetDir, { recursive: true });
		const jsonPath = join(targetDir, "receipt.json");
		const htmlPath = join(targetDir, "index.html");
		writeFileSync(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
		writeFileSync(htmlPath, renderReceiptHtml(receipt), "utf-8");
		return { ok: true, jsonPath, htmlPath };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, message: `Failed to write receipt: ${msg}` };
	}
}

export function receiptCommand(): Command {
	return new Command("receipt")
		.description(
			"Run the verify pipeline and emit a signed v1 receipt (JSON + HTML)",
		)
		.option("--all", "verify all tracked files, not just the diff")
		.option(
			"--base <branch>",
			"base branch for diff comparison",
			DEFAULT_BASE_BRANCH,
		)
		.option(
			"--title <title>",
			"PR title (no auto-detection yet; defaults to 'Untitled PR')",
		)
		.option(
			"--output-dir <dir>",
			"override output directory (default .maina/receipts/)",
		)
		.option(
			"--no-index",
			"skip refreshing .maina/receipts/index.html after writing",
		)
		.option("--json", "emit structured JSON envelope instead of human output")
		.action(async (opts: ReceiptActionOptions) => {
			const result = await receiptAction(opts);
			const exitCode = exitCodeFor(result);

			if (opts.json) {
				outputJson(formatEnvelope(result), exitCode);
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
			process.exitCode = exitCode;
		});
}

function exitCodeFor(result: ReceiptActionResult): number {
	if (!result.ok) return EXIT_FINDINGS;
	// Receipt artifacts written, but verification underneath did not pass.
	if (result.status !== "passed") return EXIT_FINDINGS;
	return EXIT_PASSED;
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
