#!/usr/bin/env bun
/**
 * The receipted-merges evidence for spec §9.5 (v1 task 12.1, #558): every
 * PR merged into v1/main, checked exactly as the Dogfood receipt check
 * checks an open one (`scripts/dogfood/receipt-check.ts`): a receipt
 * comment from a trusted author, for the head that was merged, `passed`.
 *
 *   bun scripts/release/evidence/receipts.ts --out <file> [--base v1/main] [--repo o/r]
 */

import {
	type PrComment,
	receiptCheck,
	selectReceipt,
} from "../../dogfood/receipt-check";

export type MergedPr = Readonly<{
	number: number;
	headRefOid: string;
	comments: readonly PrComment[];
}>;

export type ReceiptedMergesEvidence = Readonly<{
	link: string;
	merges: number;
	receipted: number;
	/** `#<pr> (<why>)`, in PR order. */
	unreceipted: readonly string[];
}>;

export function receiptedMergesEvidence(
	prs: readonly MergedPr[],
	link: string,
): ReceiptedMergesEvidence {
	const unreceipted: string[] = [];
	let receipted = 0;
	for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
		const check = receiptCheck(
			pr.headRefOid,
			selectReceipt(pr.comments, pr.headRefOid),
		);
		if (check.ok) receipted++;
		else unreceipted.push(`#${pr.number} (${check.error.code})`);
	}
	return { link, merges: prs.length, receipted, unreceipted };
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { emit, flag, runLink } = await import("./shell");
	const argv = process.argv.slice(2);
	const base = flag(argv, "--base") ?? "v1/main";
	const repo = flag(argv, "--repo");
	const proc = Bun.spawn(
		[
			"gh",
			"pr",
			"list",
			...(repo ? ["--repo", repo] : []),
			"--base",
			base,
			"--state",
			"merged",
			"--limit",
			"2000",
			"--json",
			"number,headRefOid,comments",
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	const link = flag(argv, "--link") ?? runLink(process.env);
	emit(
		"receipted-merges",
		flag(argv, "--out"),
		code === 0
			? {
					ok: true,
					value: receiptedMergesEvidence(JSON.parse(out) as MergedPr[], link),
				}
			: { ok: false, error: `gh pr list failed: ${err.trim()}` },
	);
}
