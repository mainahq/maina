#!/usr/bin/env bun
/**
 * Receipt-required merge check for PRs into `v1/*` (#286, FR-DOG-5).
 *
 * A dogfood receipt is a small JSON record saying "maina 1.x verify ran on
 * commit X and the result was Y". It is published to the PR as a comment by
 * `bun run dogfood:receipt` (see scripts/dogfood/receipt.ts) and checked here
 * against the PR head. The check passes only when the receipt's commit is the
 * head and its status is `passed`.
 *
 * Usage (CI, .github/workflows/dogfood.yml):
 *   bun scripts/dogfood/receipt-check.ts --pr <number> [--head <sha>] [--enforce]
 *
 * Without --enforce the check is report-only: it always exits 0 and prints a
 * warning. With --enforce a missing/stale/failing receipt exits 1.
 *
 * Bootstrap scaffolding: Phase 4 replaces it.
 */

export type ReceiptStatus = "passed" | "failed" | "partial";

export interface DogfoodReceipt {
	readonly kind: "maina-dogfood-receipt";
	readonly version: 1;
	/** Full 40-hex commit SHA the verification ran on. */
	readonly commit: string;
	/** Merge-base SHA the diff was computed against. */
	readonly base: string;
	readonly status: ReceiptStatus;
	/** Hash of the signed 1.x receipt (`maina receipt`), when one was built. */
	readonly receiptHash: string | null;
	readonly checks: { readonly passed: number; readonly total: number };
	readonly ts: string;
}

export interface PrComment {
	readonly body: string;
	readonly authorAssociation: string;
	readonly createdAt: string;
}

export type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export type ReceiptCheckError =
	| { readonly code: "missing"; readonly message: string }
	| { readonly code: "invalid"; readonly message: string }
	| {
			readonly code: "stale";
			readonly message: string;
			readonly receiptCommit: string;
	  }
	| {
			readonly code: "failing";
			readonly message: string;
			readonly status: ReceiptStatus;
	  };

export const RECEIPT_MARKER = "<!-- maina-dogfood-receipt -->";

/** Comment authors whose receipts count. Anyone else can post text. */
const TRUSTED_ASSOCIATIONS: ReadonlySet<string> = new Set([
	"OWNER",
	"MEMBER",
	"COLLABORATOR",
]);

const SHA_RE = /^[0-9a-f]{40}$/;
const STATUSES: ReadonlySet<string> = new Set(["passed", "failed", "partial"]);

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural validation; returns the receipt or undefined. */
export function asReceipt(v: unknown): DogfoodReceipt | undefined {
	if (!isRecord(v)) return undefined;
	const checks = v.checks;
	if (
		v.kind !== "maina-dogfood-receipt" ||
		v.version !== 1 ||
		typeof v.commit !== "string" ||
		!SHA_RE.test(v.commit) ||
		typeof v.base !== "string" ||
		typeof v.status !== "string" ||
		!STATUSES.has(v.status) ||
		!(v.receiptHash === null || typeof v.receiptHash === "string") ||
		!isRecord(checks) ||
		typeof checks.passed !== "number" ||
		typeof checks.total !== "number" ||
		typeof v.ts !== "string"
	) {
		return undefined;
	}
	return v as unknown as DogfoodReceipt;
}

/**
 * Pass only if `receipt` is a well-formed dogfood receipt for exactly
 * `prHead` with status `passed`.
 */
export function receiptCheck(
	prHead: string,
	receipt: unknown,
): Result<DogfoodReceipt, ReceiptCheckError> {
	if (receipt === undefined) {
		return {
			ok: false,
			error: {
				code: "missing",
				message:
					"No maina receipt for this PR. Run `bun run dogfood:receipt` on the pushed head.",
			},
		};
	}
	const r = asReceipt(receipt);
	if (!r) {
		return {
			ok: false,
			error: { code: "invalid", message: "Receipt is malformed." },
		};
	}
	if (r.commit !== prHead.toLowerCase()) {
		return {
			ok: false,
			error: {
				code: "stale",
				receiptCommit: r.commit,
				message: `Receipt is for ${r.commit.slice(0, 12)}, but the PR head is ${prHead.slice(0, 12)}. Re-run \`bun run dogfood:receipt\`.`,
			},
		};
	}
	if (r.status !== "passed") {
		return {
			ok: false,
			error: {
				code: "failing",
				status: r.status,
				message: `Receipt for ${r.commit.slice(0, 12)} is ${r.status} (${r.checks.passed}/${r.checks.total} checks). Fix the findings, commit, push and re-run.`,
			},
		};
	}
	return { ok: true, value: r };
}

export function formatReceiptComment(r: DogfoodReceipt): string {
	const hash = r.receiptHash
		? ` · receipt \`${r.receiptHash.slice(0, 12)}\``
		: "";
	return [
		RECEIPT_MARKER,
		`**Maina receipt** for \`${r.commit.slice(0, 12)}\`: **${r.status}** (${r.checks.passed}/${r.checks.total} checks)${hash}`,
		"",
		"```json",
		JSON.stringify(r, null, 2),
		"```",
	].join("\n");
}

export function parseReceiptComment(body: string): DogfoodReceipt | undefined {
	if (!body.includes(RECEIPT_MARKER)) return undefined;
	const match = body.match(/```json\n([\s\S]*?)\n```/);
	if (!match?.[1]) return undefined;
	try {
		return asReceipt(JSON.parse(match[1]));
	} catch {
		return undefined;
	}
}

/**
 * Pick the receipt to check: newest trusted receipt for `head`, else the
 * newest trusted receipt at all (so staleness is reported), else undefined.
 */
export function selectReceipt(
	comments: readonly PrComment[],
	head: string,
): DogfoodReceipt | undefined {
	const receipts = comments
		.filter((c) => TRUSTED_ASSOCIATIONS.has(c.authorAssociation))
		.map((c) => ({ at: c.createdAt, receipt: parseReceiptComment(c.body) }))
		.filter(
			(x): x is { at: string; receipt: DogfoodReceipt } =>
				x.receipt !== undefined,
		)
		.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
	const forHead = receipts.filter(
		(x) => x.receipt.commit === head.toLowerCase(),
	);
	return (forHead.at(-1) ?? receipts.at(-1))?.receipt;
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

interface CliArgs {
	readonly pr?: string;
	readonly head?: string;
	readonly repo?: string;
	readonly enforce: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
	const get = (flag: string): string | undefined => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	return {
		pr: get("--pr"),
		head: get("--head"),
		repo: get("--repo"),
		enforce: argv.includes("--enforce"),
	};
}

async function gh(args: readonly string[]): Promise<Result<string, string>> {
	const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return code === 0 ? { ok: true, value: out } : { ok: false, error: err };
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const repoArgs = args.repo ? ["--repo", args.repo] : [];
	const view = await gh([
		"pr",
		"view",
		...(args.pr ? [args.pr] : []),
		...repoArgs,
		"--json",
		"headRefOid,comments",
	]);
	if (!view.ok) {
		process.stderr.write(`receipt-check: gh pr view failed: ${view.error}\n`);
		return args.enforce ? 1 : 0;
	}
	const data = JSON.parse(view.value) as {
		headRefOid: string;
		comments: readonly PrComment[];
	};
	const head = args.head ?? data.headRefOid;
	const result = receiptCheck(head, selectReceipt(data.comments, head));
	const mode = args.enforce ? "enforced" : "report-only";
	const line = result.ok
		? `maina receipt OK for ${head.slice(0, 12)} (${result.value.checks.passed}/${result.value.checks.total} checks).`
		: `maina receipt ${result.error.code}: ${result.error.message}`;

	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) {
		const { appendFileSync } = await import("node:fs");
		appendFileSync(
			summaryPath,
			`### Dogfood receipt (${mode})\n\n${line}\n\nProduce one: \`bun run dogfood:receipt\` (see CONTRIBUTING.md).\n`,
		);
	}
	if (result.ok) {
		process.stdout.write(`${line}\n`);
		return 0;
	}
	if (args.enforce) {
		process.stdout.write(`::error title=Dogfood receipt::${line}\n`);
		return 1;
	}
	process.stdout.write(
		`::warning title=Dogfood receipt (report-only)::${line}\n`,
	);
	return 0;
}

if (import.meta.main) {
	process.exitCode = await main();
}
