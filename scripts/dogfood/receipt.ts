#!/usr/bin/env bun
/**
 * One-command dogfood receipt for the PR head (#286, FR-DOG-5).
 *
 *   bun run dogfood:receipt
 *
 * 1. Refuses a dirty tree (the receipt must describe the committed HEAD).
 * 2. Finds the current branch's PR (`gh pr view`) and checks HEAD is pushed.
 * 3. Runs the maina 1.x verify pipeline (`maina receipt`) over the files the
 *    PR changes versus its merge-base, and writes a local dogfood receipt to
 *    `.maina/dogfood/receipts/<sha>.json` (reused only if it passed against
 *    the same merge-base).
 * 4. Publishes the receipt to the PR as a comment and re-runs the Dogfood
 *    check so `receipt-check` sees it for the PR head.
 *
 * Flags:
 *   --no-publish  verify + write locally only (used by lefthook pre-push)
 *   --no-fail     always exit 0 (pre-push must never block a push)
 *   --base <ref>  diff base when there is no PR (default: $MAINA_BASE or
 *                 origin/master)
 *
 * Bootstrap scaffolding: Phase 4 replaces it.
 */

import {
	asReceipt,
	type DogfoodReceipt,
	formatReceiptComment,
	type ReceiptStatus,
	type Result,
} from "./receipt-check";

export interface ExecResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface VerifyOutcome {
	readonly status: ReceiptStatus;
	readonly receiptHash: string | null;
	readonly passed: number;
	readonly total: number;
}

export interface VerifyInput {
	readonly files: readonly string[];
	/** Merge-base SHA to diff against. */
	readonly base: string;
	readonly title: string;
}

export interface ReceiptPorts {
	readonly root: string;
	readonly exec: (cmd: readonly string[]) => Promise<ExecResult>;
	readonly verify: (input: VerifyInput) => Promise<VerifyOutcome>;
	readonly readFile: (path: string) => string | undefined;
	readonly writeFile: (path: string, content: string) => void;
	readonly now: () => string;
	readonly sleep: (ms: number) => Promise<void>;
}

export interface ReceiptOptions {
	readonly publish: boolean;
	readonly base?: string;
}

export type ReceiptError =
	| { readonly code: "git"; readonly message: string }
	| { readonly code: "dirty"; readonly message: string }
	| { readonly code: "no-pr"; readonly message: string }
	| { readonly code: "not-pushed"; readonly message: string }
	| { readonly code: "no-base"; readonly message: string }
	| { readonly code: "publish"; readonly message: string };

export interface ReceiptProduced {
	readonly receipt: DogfoodReceipt;
	readonly reused: boolean;
	readonly path: string;
	readonly pr?: number;
	/** Id of the Dogfood workflow run that was re-run, if any. */
	readonly rerun?: number;
}

interface PrInfo {
	readonly number: number;
	readonly headRefOid: string;
	readonly baseRefName: string;
	readonly title: string;
}

const DOGFOOD_WORKFLOW = "Dogfood";
const RUN_POLL_MS = 5_000;
const RUN_POLL_ATTEMPTS = 24;
const RUN_APPEAR_ATTEMPTS = 4;
const HEAD_POLL_MS = 3_000;
const HEAD_POLL_ATTEMPTS = 6;

const fail = (
	code: ReceiptError["code"],
	message: string,
): { readonly ok: false; readonly error: ReceiptError } => ({
	ok: false,
	error: { code, message },
});

async function currentPr(ports: ReceiptPorts): Promise<PrInfo | undefined> {
	const r = await ports.exec([
		"gh",
		"pr",
		"view",
		"--json",
		"number,headRefOid,baseRefName,title",
	]);
	if (r.code !== 0) return undefined;
	try {
		return JSON.parse(r.stdout) as PrInfo;
	} catch {
		return undefined;
	}
}

async function mergeBase(
	baseRef: string,
	ports: ReceiptPorts,
): Promise<Result<string, ReceiptError>> {
	if (baseRef.startsWith("origin/")) {
		// Best effort: offline pushes still verify against the local ref.
		await ports.exec([
			"git",
			"fetch",
			"--quiet",
			"origin",
			baseRef.slice("origin/".length),
		]);
	}
	const mb = await ports.exec(["git", "merge-base", baseRef, "HEAD"]);
	if (mb.code !== 0) {
		return fail("no-base", `Cannot find merge-base with ${baseRef}.`);
	}
	return { ok: true, value: mb.stdout.trim().toLowerCase() };
}

async function verifyHead(
	head: string,
	base: string,
	title: string,
	ports: ReceiptPorts,
): Promise<Result<DogfoodReceipt, ReceiptError>> {
	const diff = await ports.exec([
		"git",
		"diff",
		"--name-only",
		"--diff-filter=d",
		base,
		"HEAD",
	]);
	if (diff.code !== 0) return fail("git", diff.stderr.trim());
	const files = diff.stdout
		.split("\n")
		.map((f) => f.trim())
		.filter((f) => f.length > 0);
	const outcome = await ports.verify({ files, base, title });
	return {
		ok: true,
		value: {
			kind: "maina-dogfood-receipt",
			version: 1,
			commit: head,
			base,
			status: outcome.status,
			receiptHash: outcome.receiptHash,
			checks: { passed: outcome.passed, total: outcome.total },
			ts: ports.now(),
		},
	};
}

/** Re-run the latest Dogfood run for `head` so it picks the receipt up. */
async function rerunCheck(
	head: string,
	ports: ReceiptPorts,
): Promise<number | undefined> {
	for (let attempt = 0; attempt < RUN_POLL_ATTEMPTS; attempt++) {
		const list = await ports.exec([
			"gh",
			"run",
			"list",
			"--commit",
			head,
			"--json",
			"databaseId,workflowName,status",
			"--limit",
			"50",
		]);
		if (list.code !== 0) return undefined;
		let runs: ReadonlyArray<{
			databaseId: number;
			workflowName: string;
			status: string;
		}>;
		try {
			runs = JSON.parse(list.stdout);
		} catch {
			return undefined;
		}
		const latest = runs
			.filter((r) => r.workflowName === DOGFOOD_WORKFLOW)
			.sort((a, b) => b.databaseId - a.databaseId)[0];
		if (!latest) {
			// Right after a push the run may not be listed yet; wait a little,
			// but not forever (repos without the workflow have none).
			if (attempt + 1 >= RUN_APPEAR_ATTEMPTS) return undefined;
			await ports.sleep(RUN_POLL_MS);
			continue;
		}
		if (latest.status === "completed") {
			const rr = await ports.exec([
				"gh",
				"run",
				"rerun",
				String(latest.databaseId),
			]);
			return rr.code === 0 ? latest.databaseId : undefined;
		}
		await ports.sleep(RUN_POLL_MS);
	}
	return undefined;
}

export async function produceReceipt(
	opts: ReceiptOptions,
	ports: ReceiptPorts,
): Promise<Result<ReceiptProduced, ReceiptError>> {
	// Untracked files are deliberately ignored: they are not part of HEAD and
	// the verify scope is `git diff <merge-base> HEAD`, so they can neither be
	// verified nor change what the receipt attests. Refusing them would block
	// every run on local artifacts (e.g. .maina/wiki/.signals.json).
	const status = await ports.exec([
		"git",
		"status",
		"--porcelain",
		"--untracked-files=no",
	]);
	if (status.code !== 0) return fail("git", status.stderr.trim());
	if (status.stdout.trim() !== "") {
		return fail(
			"dirty",
			"Working tree has uncommitted changes; commit (via maina commit) first so the receipt matches HEAD.",
		);
	}
	const rev = await ports.exec(["git", "rev-parse", "HEAD"]);
	if (rev.code !== 0) return fail("git", rev.stderr.trim());
	const head = rev.stdout.trim().toLowerCase();

	let pr = await currentPr(ports);
	// GitHub updates the PR head a few seconds after `git push`; give it time.
	for (
		let attempt = 1;
		opts.publish &&
		pr &&
		pr.headRefOid.toLowerCase() !== head &&
		attempt < HEAD_POLL_ATTEMPTS;
		attempt++
	) {
		await ports.sleep(HEAD_POLL_MS);
		pr = await currentPr(ports);
	}
	if (opts.publish && !pr) {
		return fail(
			"no-pr",
			"No PR for this branch. Push and run `gh pr create` first (or pass --no-publish).",
		);
	}
	if (opts.publish && pr && pr.headRefOid.toLowerCase() !== head) {
		return fail(
			"not-pushed",
			`Local HEAD ${head.slice(0, 12)} is not the PR head ${pr.headRefOid.slice(0, 12)}. Push first.`,
		);
	}

	// The PR's own base wins; --base / MAINA_BASE only apply without a PR.
	const baseRef = pr
		? `origin/${pr.baseRefName}`
		: (opts.base ?? "origin/master");
	const mb = await mergeBase(baseRef, ports);
	if (!mb.ok) return mb;
	const base = mb.value;

	// Reuse a local receipt only if it attests the same commit over the same
	// diff (merge-base) and passed; anything else is re-verified.
	const path = `${ports.root}/.maina/dogfood/receipts/${head}.json`;
	const cached = (() => {
		const text = ports.readFile(path);
		if (!text) return undefined;
		try {
			const r = asReceipt(JSON.parse(text));
			return r?.commit === head && r.base === base && r.status === "passed"
				? r
				: undefined;
		} catch {
			return undefined;
		}
	})();

	let receipt: DogfoodReceipt;
	if (cached) {
		receipt = cached;
	} else {
		const title = pr?.title ?? `commit ${head.slice(0, 12)}`;
		const v = await verifyHead(head, base, title, ports);
		if (!v.ok) return v;
		receipt = v.value;
		ports.writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
	}

	const produced = { receipt, reused: cached !== undefined, path };
	if (!opts.publish || !pr) return { ok: true, value: produced };

	const comment = await ports.exec([
		"gh",
		"pr",
		"comment",
		String(pr.number),
		"--body",
		formatReceiptComment(receipt),
	]);
	if (comment.code !== 0) {
		return fail("publish", `gh pr comment failed: ${comment.stderr.trim()}`);
	}
	const rerun = await rerunCheck(head, ports);
	return {
		ok: true,
		value: {
			...produced,
			pr: pr.number,
			...(rerun !== undefined ? { rerun } : {}),
		},
	};
}

// ── Imperative shell ─────────────────────────────────────────────────────

async function realVerify(
	root: string,
	input: VerifyInput,
): Promise<VerifyOutcome> {
	const { receiptAction } = await import(
		"../../packages/cli/src/commands/receipt"
	);
	const { getDiffStats } = await import("../../packages/core/src/git");
	const diff = await getDiffStats({ cwd: root, from: input.base, to: "HEAD" });
	const r = await receiptAction({
		cwd: root,
		files: [...input.files],
		base: input.base,
		title: input.title,
		diff,
		noIndex: true,
		outputDir: `${root}/.maina/dogfood/receipts/signed`,
	});
	if (!r.ok) {
		process.stderr.write(
			`maina receipt failed [${r.error?.code}]: ${r.error?.message}\n`,
		);
		return { status: "failed", receiptHash: null, passed: 0, total: 0 };
	}
	const status = r.status as ReceiptStatus;
	return {
		status: status === "passed" || status === "partial" ? status : "failed",
		receiptHash: r.hash ?? null,
		passed: r.passedCount ?? 0,
		total: r.totalCount ?? 0,
	};
}

async function main(): Promise<number> {
	const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import(
		"node:fs"
	);
	const { dirname, resolve } = await import("node:path");
	const root = resolve(import.meta.dir, "../..");
	const argv = process.argv.slice(2);
	const baseAt = argv.indexOf("--base");
	const base =
		(baseAt >= 0 ? argv[baseAt + 1] : undefined) ?? process.env.MAINA_BASE;
	const noFail = argv.includes("--no-fail");

	const ports: ReceiptPorts = {
		root,
		exec: async (cmd) => {
			const proc = Bun.spawn([...cmd], {
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			return { code, stdout, stderr };
		},
		verify: (input) => realVerify(root, input),
		readFile: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : undefined),
		writeFile: (p, c) => {
			mkdirSync(dirname(p), { recursive: true });
			writeFileSync(p, c, "utf-8");
		},
		now: () => new Date().toISOString(),
		sleep: (ms) => Bun.sleep(ms),
	};

	const r = await produceReceipt(
		{ publish: !argv.includes("--no-publish"), ...(base ? { base } : {}) },
		ports,
	);
	if (!r.ok) {
		process.stderr.write(
			`dogfood receipt [${r.error.code}]: ${r.error.message}\n`,
		);
		return noFail ? 0 : 1;
	}
	const { receipt, reused, pr, rerun } = r.value;
	process.stdout.write(
		`Maina receipt for ${receipt.commit.slice(0, 12)}: ${receipt.status} (${receipt.checks.passed}/${receipt.checks.total} checks)${reused ? " [reused]" : ""}\n`,
	);
	if (pr !== undefined) {
		process.stdout.write(
			`Published to PR #${pr}${rerun !== undefined ? `; re-running Dogfood check (run ${rerun})` : "; the next Dogfood run will pick it up"}.\n`,
		);
	}
	return receipt.status === "passed" || noFail ? 0 : 1;
}

if (import.meta.main) {
	try {
		process.exitCode = await main();
	} catch (e) {
		// Spawn/IO/pipeline exceptions must honour --no-fail too: pre-push
		// promises never to block a push.
		const msg = e instanceof Error ? e.message : String(e);
		process.stderr.write(`dogfood receipt [crash]: ${msg}\n`);
		process.exitCode = process.argv.includes("--no-fail") ? 0 : 1;
	}
}
