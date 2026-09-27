#!/usr/bin/env bun
/**
 * The receipted-merges evidence for spec §9.5 (v1 task 12.1, #558): every
 * PR merged into v1/main, checked exactly as the Dogfood receipt check
 * checks an open one (`scripts/dogfood/receipt-check.ts`): a receipt
 * comment from a trusted author, for the head that was merged, `passed`.
 *
 * Counted from receipt enforcement (#570): receipts became required with
 * the merge of #371 (`RECEIPTS_ENFORCED_BY`), which added the receipt
 * tooling and the Dogfood check. A PR opened before that merge could not
 * have carried a receipt, so it is listed under `exempt` and not counted.
 * The exemption is pinned to the seven merges that actually predate
 * receipts (`RECEIPTS_GRANDFATHERED`, #366-#376): a pre-enforcement PR that
 * was closed unmerged could be reopened and merged at any time, and it must
 * carry a receipt like any other. So the exempt set is closed: every other
 * merge must carry one. When #371 is not among the merges (another
 * repository or base), every merge counts.
 *
 *   bun scripts/release/evidence/receipts.ts --out <file> [--base v1/main] [--repo o/r]
 */

import {
	type PrComment,
	receiptCheck,
	selectReceipt,
} from "../../dogfood/receipt-check";

/** The PR whose merge made receipts required on v1/main. */
export const RECEIPTS_ENFORCED_BY = 371;

/**
 * The merges opened before #371 merged, which could not carry a receipt:
 * the only ones exempt. Closed, so a reopened pre-enforcement PR is counted.
 */
export const RECEIPTS_GRANDFATHERED: readonly number[] = [
	366, 367, 369, 370, 373, 375, 376,
];

export type MergedPr = Readonly<{
	number: number;
	headRefOid: string;
	comments: readonly PrComment[];
	/** ISO timestamps, as `gh pr list --json createdAt,mergedAt` gives them. */
	createdAt: string;
	mergedAt: string;
}>;

export type ReceiptedMergesEvidence = Readonly<{
	link: string;
	/** `#<pr> (merged <ts>)`: the enforcement merge counted from; null: all. */
	since: string | null;
	/** Merges counted: every merge since enforcement. */
	merges: number;
	receipted: number;
	/** `#<pr> (<why>)`, in PR order. */
	unreceipted: readonly string[];
	/** `#<pr>` of grandfathered PRs opened before enforcement, in PR order; not counted. */
	exempt: readonly string[];
}>;

export function receiptedMergesEvidence(
	prs: readonly MergedPr[],
	link: string,
): ReceiptedMergesEvidence {
	const enforcement = prs.find((pr) => pr.number === RECEIPTS_ENFORCED_BY);
	const enforcedAt =
		enforcement === undefined ? Number.NaN : Date.parse(enforcement.mergedAt);
	const isExempt = (pr: MergedPr): boolean =>
		pr !== enforcement &&
		RECEIPTS_GRANDFATHERED.includes(pr.number) &&
		Date.parse(pr.createdAt) < enforcedAt;
	const sorted = [...prs].sort((a, b) => a.number - b.number);
	const counted = sorted.filter((pr) => !isExempt(pr));
	const unreceipted: string[] = [];
	let receipted = 0;
	for (const pr of counted) {
		const check = receiptCheck(
			pr.headRefOid,
			selectReceipt(pr.comments, pr.headRefOid),
		);
		if (check.ok) receipted++;
		else unreceipted.push(`#${pr.number} (${check.error.code})`);
	}
	return {
		link,
		since:
			enforcement === undefined
				? null
				: `#${enforcement.number} (merged ${enforcement.mergedAt})`,
		merges: counted.length,
		receipted,
		unreceipted,
		exempt: sorted.filter(isExempt).map((pr) => `#${pr.number}`),
	};
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
			"number,headRefOid,comments,createdAt,mergedAt",
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
