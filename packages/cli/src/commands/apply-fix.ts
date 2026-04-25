import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getChangedFiles,
	type Receipt,
	validatePatchScope,
	verifyReceipt,
} from "@mainahq/core";
import { Command } from "commander";
import {
	EXIT_CONFIG_ERROR,
	EXIT_FINDINGS,
	EXIT_PASSED,
	outputJson,
} from "../json";

export interface ApplyFixActionOptions {
	dryRun?: boolean;
	cwd?: string;
	json?: boolean;
	base?: string;
	receiptDir?: string;
}

export interface ApplyFixActionResult {
	ok: boolean;
	commitMessage?: string;
	touchedFiles?: string[];
	error?: { code: string; message: string };
}

const MAINA_DIR = ".maina";
const RECEIPTS_SUBDIR = "receipts";
const DEFAULT_BASE_BRANCH = "master";

export async function applyFixAction(
	hash: string,
	checkId: string,
	options: ApplyFixActionOptions = {},
): Promise<ApplyFixActionResult> {
	const cwd = options.cwd ?? process.cwd();

	if (!/^[0-9a-f]{64}$/.test(hash)) {
		return {
			ok: false,
			error: {
				code: "invalid-hash",
				message: `Receipt hash must be 64 lowercase hex chars, got: ${hash}`,
			},
		};
	}

	// 1. Locate + load receipt
	const receiptDir =
		options.receiptDir ?? join(cwd, MAINA_DIR, RECEIPTS_SUBDIR);
	const receiptPath = join(receiptDir, hash, "receipt.json");
	if (!existsSync(receiptPath)) {
		return {
			ok: false,
			error: {
				code: "receipt-not-found",
				message: `No receipt at ${receiptPath}`,
			},
		};
	}

	let receipt: Receipt;
	try {
		const raw = JSON.parse(readFileSync(receiptPath, "utf-8"));
		const verified = verifyReceipt(raw);
		if (!verified.ok) {
			return {
				ok: false,
				error: {
					code: "invalid-receipt",
					message: `Receipt failed verification (${verified.code}): ${verified.message}`,
				},
			};
		}
		// Don't trust the on-disk path keyed by user-supplied hash — make sure
		// the verified receipt's own hash matches the argument. Catches stale
		// or misplaced files in `.maina/receipts/<wrong>/receipt.json`.
		if (verified.data.hash !== hash) {
			return {
				ok: false,
				error: {
					code: "hash-mismatch",
					message: `Receipt at ${receiptPath} reports hash ${verified.data.hash}, but command was invoked with ${hash}.`,
				},
			};
		}
		receipt = verified.data;
	} catch (e) {
		return {
			ok: false,
			error: {
				code: "io",
				message: `Failed to read or parse receipt: ${(e as Error).message}`,
			},
		};
	}

	// 2. Locate the check + its patch
	const check = receipt.checks.find((c) => c.id === checkId);
	if (!check) {
		return {
			ok: false,
			error: {
				code: "check-not-found",
				message: `Receipt has no check with id ${checkId}. Available: ${receipt.checks.map((c) => c.id).join(", ")}`,
			},
		};
	}
	if (!check.patch) {
		return {
			ok: false,
			error: {
				code: "no-patch",
				message: `Check ${checkId} has no autofix patch.`,
			},
		};
	}

	// 3. Working tree must be clean — staged + unstaged + untracked. A staged
	// check alone would let `git add -- <file>` after the apply sweep up
	// pre-existing unstaged WIP into the autofix commit.
	const portionPorcelain = await runGit(["status", "--porcelain"], cwd);
	if (portionPorcelain.exitCode !== 0) {
		return {
			ok: false,
			error: {
				code: "git-status-failed",
				message: `git status failed: ${portionPorcelain.stderr.trim() || portionPorcelain.stdout.trim()}`,
			},
		};
	}
	if (portionPorcelain.stdout.trim().length > 0) {
		return {
			ok: false,
			error: {
				code: "working-tree-dirty",
				message:
					"Working tree has uncommitted changes — commit or stash before applying autofix.",
			},
		};
	}

	// 4. Validate scope — patch must only touch files in the receipt's diff scope
	const baseBranch = options.base ?? DEFAULT_BASE_BRANCH;
	// Verify base ref exists before relying on getChangedFiles — otherwise an
	// unknown base produces an empty allowlist that surfaces every patch as
	// "out-of-scope", which is misleading.
	const baseCheck = await runGit(
		["rev-parse", "--verify", "--quiet", baseBranch],
		cwd,
	);
	if (baseCheck.exitCode !== 0) {
		return {
			ok: false,
			error: {
				code: "unknown-base-branch",
				message: `Base branch ${baseBranch} not found. Pass --base <branch> with an existing ref.`,
			},
		};
	}
	const allowedFiles = await getChangedFiles(baseBranch, cwd);
	const validation = validatePatchScope(check.patch, allowedFiles);
	if (!validation.ok) {
		return {
			ok: false,
			error: {
				code: validation.code,
				message: validation.message,
			},
		};
	}

	// 5. Write patch to tmp, then git apply --check + apply (skip on dry-run)
	const tmpPatch = join(
		tmpdir(),
		`maina-autofix-${hash.slice(0, 12)}-${Date.now()}.patch`,
	);
	try {
		writeFileSync(tmpPatch, check.patch.diff, "utf-8");
	} catch (e) {
		return {
			ok: false,
			error: {
				code: "io",
				message: `Failed to write tmp patch ${tmpPatch}: ${(e as Error).message}`,
			},
		};
	}

	const checkResult = await runGit(["apply", "--check", tmpPatch], cwd);
	if (checkResult.exitCode !== 0) {
		return {
			ok: false,
			error: {
				code: "apply-conflict",
				message: `Patch does not apply cleanly: ${checkResult.stderr.trim() || checkResult.stdout.trim()}`,
			},
		};
	}

	if (options.dryRun) {
		return {
			ok: true,
			commitMessage: buildCommitMessage(checkId, hash, check.patch.rationale),
			touchedFiles: validation.touchedFiles,
		};
	}

	const applyResult = await runGit(["apply", tmpPatch], cwd);
	if (applyResult.exitCode !== 0) {
		return {
			ok: false,
			error: {
				code: "apply-failed",
				message: `git apply failed: ${applyResult.stderr.trim() || applyResult.stdout.trim()}`,
			},
		};
	}

	// 6. Stage + commit. Use `git add -A --` so deletions and renames stage
	// correctly (`git add -- <file>` won't stage a removed path).
	const addResult = await runGit(
		["add", "-A", "--", ...validation.touchedFiles],
		cwd,
	);
	if (addResult.exitCode !== 0) {
		return {
			ok: false,
			error: {
				code: "stage-failed",
				message: `git add -A failed: ${addResult.stderr.trim()}`,
			},
		};
	}

	const commitMessage = buildCommitMessage(
		checkId,
		hash,
		check.patch.rationale,
	);
	const commitResult = await runGit(["commit", "-m", commitMessage], cwd);
	if (commitResult.exitCode !== 0) {
		return {
			ok: false,
			error: {
				code: "commit-failed",
				message: `git commit failed: ${commitResult.stderr.trim() || commitResult.stdout.trim()}`,
			},
		};
	}

	return {
		ok: true,
		commitMessage,
		touchedFiles: validation.touchedFiles,
	};
}

function buildCommitMessage(
	checkId: string,
	hash: string,
	rationale: string,
): string {
	const shortHash = hash.slice(0, 12);
	return `fix: apply maina autofix for ${checkId} (${shortHash})

${rationale}

Maina-Autofix: receipt=${hash} check=${checkId}
`.trim();
}

async function runGit(
	args: string[],
	cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;
		return { exitCode, stdout, stderr };
	} catch (e) {
		// Spawn failure (e.g. git not on PATH) — surface as a non-zero exitCode
		// + stderr text so callers' Result-based error mapping still works.
		const message = e instanceof Error ? e.message : String(e);
		return {
			exitCode: 127,
			stdout: "",
			stderr: `git not available: ${message}`,
		};
	}
}

/** Map a structured `apply-fix` error to a CLI exit code. Used for both the
 * human-readable path and the `--json` envelope so automation sees the same
 * codes as interactive use. */
function exitCodeForError(
	error: ApplyFixActionResult["error"] | undefined,
): number {
	if (!error) return EXIT_PASSED;
	switch (error.code) {
		case "invalid-hash":
		case "receipt-not-found":
		case "invalid-receipt":
		case "hash-mismatch":
		case "check-not-found":
		case "no-patch":
		case "unknown-base-branch":
		case "io":
		case "git-status-failed":
			return EXIT_CONFIG_ERROR;
		case "working-tree-dirty":
		case "empty-diff":
		case "malformed-diff":
		case "out-of-scope":
		case "apply-conflict":
		case "apply-failed":
		case "stage-failed":
		case "commit-failed":
			return EXIT_FINDINGS;
		default:
			return EXIT_FINDINGS;
	}
}

export function applyFixCommand(): Command {
	return new Command("apply-fix")
		.description("Apply an autofix patch from a receipt as a follow-up commit")
		.argument("<hash>", "receipt hash (sha256, 64 hex chars)")
		.argument("<check-id>", "id of the check whose patch to apply")
		.option("--dry-run", "validate the patch without committing")
		.option(
			"--base <branch>",
			"base branch for diff scope",
			DEFAULT_BASE_BRANCH,
		)
		.option("--json", "emit structured JSON envelope instead of human output")
		.action(
			async (hash: string, checkId: string, opts: ApplyFixActionOptions) => {
				const result = await applyFixAction(hash, checkId, opts);
				const exitCode = result.ok
					? EXIT_PASSED
					: exitCodeForError(result.error);

				if (opts.json) {
					outputJson(formatEnvelope(result, opts.dryRun ?? false), exitCode);
					return;
				}

				if (result.ok) {
					if (opts.dryRun) {
						process.stdout.write(
							`Patch validates against ${result.touchedFiles?.length ?? 0} file(s) — would commit:\n${result.commitMessage}\n`,
						);
					} else {
						process.stdout.write(
							`Applied autofix — touched ${result.touchedFiles?.length ?? 0} file(s). Commit message:\n${result.commitMessage}\n`,
						);
					}
				} else {
					process.stderr.write(
						`apply-fix failed [${result.error?.code}]: ${result.error?.message}\n`,
					);
				}
				process.exitCode = exitCode;
			},
		);
}

function formatEnvelope(
	result: ApplyFixActionResult,
	dryRun: boolean,
): unknown {
	if (result.ok) {
		return {
			data: {
				dryRun,
				touchedFiles: result.touchedFiles,
				commitMessage: result.commitMessage,
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
