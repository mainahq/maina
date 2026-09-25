/**
 * Tests for the one-command receipt step (`bun run dogfood:receipt`, #286).
 *
 * It verifies the committed HEAD against the PR base with maina 1.x, writes a
 * local dogfood receipt, publishes it to the PR as a comment and re-runs the
 * Dogfood check so the result lands on the PR head. All process concerns go
 * through injected ports so the flow is testable without git/gh.
 */

import { describe, expect, test } from "bun:test";
import {
	type ExecResult,
	produceReceipt,
	type ReceiptPorts,
	type VerifyOutcome,
} from "../receipt";
import { parseReceiptComment } from "../receipt-check";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

interface Fake {
	readonly ports: ReceiptPorts;
	readonly calls: string[];
	readonly files: Map<string, string>;
	readonly verifyCalls: Array<{ files: readonly string[]; base: string }>;
	readonly comments: string[];
}

function fake(
	over: Record<string, ExecResult> = {},
	verifyOutcome: VerifyOutcome = {
		status: "passed",
		receiptHash: "d".repeat(64),
		passed: 4,
		total: 4,
	},
): Fake {
	const calls: string[] = [];
	const files = new Map<string, string>();
	const verifyCalls: Array<{ files: readonly string[]; base: string }> = [];
	const comments: string[] = [];
	const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });
	const table: Record<string, ExecResult> = {
		"git status --porcelain --untracked-files=no": ok(""),
		"git rev-parse HEAD": ok(`${HEAD}\n`),
		"gh pr view --json number,headRefOid,baseRefName,title": ok(
			JSON.stringify({
				number: 42,
				headRefOid: HEAD,
				baseRefName: "v1/main",
				title: "chore(dogfood): x",
			}),
		),
		"git fetch --quiet origin v1/main": ok(""),
		"git merge-base origin/v1/main HEAD": ok(`${BASE}\n`),
		[`git diff --name-only --diff-filter=d ${BASE} HEAD`]: ok(
			"scripts/dogfood/report.ts\nlefthook.yml\n",
		),
		"gh run list --commit": ok(
			JSON.stringify([
				{ databaseId: 7, workflowName: "Dogfood", status: "completed" },
				{ databaseId: 8, workflowName: "CI", status: "completed" },
			]),
		),
		"gh run rerun 7": ok(""),
		...over,
	};
	const ports: ReceiptPorts = {
		root: "/repo",
		exec: async (cmd) => {
			const key = cmd.join(" ");
			calls.push(key);
			if (cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "comment") {
				const body = cmd[cmd.indexOf("--body") + 1] ?? "";
				comments.push(body);
				return ok("https://github.com/o/r/pull/42#issuecomment-1\n");
			}
			const hit =
				table[key] ??
				Object.entries(table).find(([k]) => key.startsWith(k))?.[1];
			return hit ?? { code: 1, stdout: "", stderr: `unexpected: ${key}` };
		},
		verify: async (input) => {
			verifyCalls.push({ files: input.files, base: input.base });
			return verifyOutcome;
		},
		readFile: (path) => files.get(path),
		writeFile: (path, content) => {
			files.set(path, content);
		},
		now: () => "2026-09-25T10:00:00.000Z",
		sleep: async () => {},
	};
	return { ports, calls, files, verifyCalls, comments };
}

describe("produceReceipt", () => {
	test("verifies the PR diff, writes, publishes and re-runs the check", async () => {
		const f = fake();
		const r = await produceReceipt({ publish: true }, f.ports);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.receipt.commit).toBe(HEAD);
		expect(r.value.receipt.base).toBe(BASE);
		expect(r.value.receipt.status).toBe("passed");
		expect(f.verifyCalls).toEqual([
			{ files: ["scripts/dogfood/report.ts", "lefthook.yml"], base: BASE },
		]);
		expect(f.files.has(`/repo/.maina/dogfood/receipts/${HEAD}.json`)).toBe(
			true,
		);
		expect(f.comments).toHaveLength(1);
		expect(parseReceiptComment(f.comments[0] ?? "")).toEqual(r.value.receipt);
		expect(f.calls).toContain("gh run rerun 7");
		expect(r.value.rerun).toBe(7);
	});

	test("reuses a local receipt for HEAD instead of re-verifying", async () => {
		const f = fake();
		const first = await produceReceipt({ publish: false }, f.ports);
		expect(first.ok).toBe(true);
		const second = await produceReceipt({ publish: true }, f.ports);
		expect(second.ok).toBe(true);
		expect(f.verifyCalls).toHaveLength(1);
	});

	// Review on #286: the cache keyed on HEAD alone, so a receipt written by
	// pre-push before the PR existed (diffed against origin/master) was later
	// published as the PR's receipt, and a failed receipt could never be redone.
	test("does not reuse a local receipt computed against another base", async () => {
		const OTHER = "c".repeat(40);
		const noPr = {
			"gh pr view --json number,headRefOid,baseRefName,title": {
				code: 1,
				stdout: "",
				stderr: "no pull requests found",
			},
		};
		const f = fake({
			...noPr,
			"git fetch --quiet origin master": { code: 0, stdout: "", stderr: "" },
			"git merge-base origin/master HEAD": {
				code: 0,
				stdout: `${OTHER}\n`,
				stderr: "",
			},
			[`git diff --name-only --diff-filter=d ${OTHER} HEAD`]: {
				code: 0,
				stdout: "README.md\n",
				stderr: "",
			},
		});
		const prePush = await produceReceipt({ publish: false }, f.ports);
		expect(prePush.ok && prePush.value.receipt.base).toBe(OTHER);

		// The PR now exists against v1/main: same HEAD, different merge-base.
		const g = fake();
		for (const [k, v] of f.files) g.files.set(k, v);
		const r = await produceReceipt({ publish: true }, g.ports);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.reused).toBe(false);
		expect(r.value.receipt.base).toBe(BASE);
		expect(g.verifyCalls).toHaveLength(1);
		expect(parseReceiptComment(g.comments[0] ?? "")?.base).toBe(BASE);
	});

	test("does not reuse a failed local receipt", async () => {
		const f = fake(
			{},
			{ status: "failed", receiptHash: null, passed: 0, total: 0 },
		);
		await produceReceipt({ publish: false }, f.ports);
		const g = fake();
		for (const [k, v] of f.files) g.files.set(k, v);
		const r = await produceReceipt({ publish: true }, g.ports);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.reused).toBe(false);
		expect(r.value.receipt.status).toBe("passed");
		expect(g.verifyCalls).toHaveLength(1);
	});

	test("finds the PR through the upstream branch when the local name differs", async () => {
		// Dogfood friction on #286: a worktree branch `review-x` tracking
		// origin/v1/286-x has no PR under its own name, so pre-push fell back
		// to origin/master and publishing failed with no-pr.
		const pr = JSON.stringify({
			number: 42,
			headRefOid: HEAD,
			baseRefName: "v1/main",
			title: "x",
		});
		const f = fake({
			"gh pr view --json number,headRefOid,baseRefName,title": {
				code: 1,
				stdout: "",
				stderr: 'no pull requests found for branch "review-x"',
			},
			"git rev-parse --abbrev-ref --symbolic-full-name @{upstream}": {
				code: 0,
				stdout: "origin/v1/286-x\n",
				stderr: "",
			},
			"gh pr view v1/286-x --json number,headRefOid,baseRefName,title": {
				code: 0,
				stdout: pr,
				stderr: "",
			},
		});
		const r = await produceReceipt({ publish: true }, f.ports);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.pr).toBe(42);
		expect(r.value.receipt.base).toBe(BASE);
	});

	test("the PR base wins over --base / MAINA_BASE when a PR exists", async () => {
		const f = fake();
		const r = await produceReceipt(
			{ publish: true, base: "origin/master" },
			f.ports,
		);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.receipt.base).toBe(BASE);
		expect(f.calls).toContain("git merge-base origin/v1/main HEAD");
		expect(f.calls).not.toContain("git merge-base origin/master HEAD");
	});

	test("--no-publish writes locally and never comments", async () => {
		const f = fake();
		const r = await produceReceipt({ publish: false }, f.ports);
		expect(r.ok).toBe(true);
		expect(f.comments).toHaveLength(0);
		expect(f.calls.some((c) => c.startsWith("gh run"))).toBe(false);
	});

	test("--no-publish without a PR falls back to MAINA_BASE-style base", async () => {
		const f = fake({
			"gh pr view --json number,headRefOid,baseRefName,title": {
				code: 1,
				stdout: "",
				stderr: "no pull requests found",
			},
			"git merge-base origin/master HEAD": {
				code: 0,
				stdout: `${BASE}\n`,
				stderr: "",
			},
			"git fetch --quiet origin master": { code: 0, stdout: "", stderr: "" },
		});
		const r = await produceReceipt({ publish: false }, f.ports);
		expect(r.ok).toBe(true);
		const withBase = fake({
			"gh pr view --json number,headRefOid,baseRefName,title": {
				code: 1,
				stdout: "",
				stderr: "no pull requests found",
			},
		});
		const r2 = await produceReceipt(
			{ publish: false, base: "origin/v1/main" },
			withBase.ports,
		);
		expect(r2.ok).toBe(true);
	});

	test("a failing verify still produces (and publishes) a failed receipt", async () => {
		const f = fake(
			{},
			{ status: "failed", receiptHash: null, passed: 1, total: 4 },
		);
		const r = await produceReceipt({ publish: true }, f.ports);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.receipt.status).toBe("failed");
		expect(f.comments).toHaveLength(1);
	});

	test("refuses a dirty working tree", async () => {
		const f = fake({
			"git status --porcelain --untracked-files=no": {
				code: 0,
				stdout: " M lefthook.yml\n",
				stderr: "",
			},
		});
		const r = await produceReceipt({ publish: true }, f.ports);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("dirty");
	});

	test("refuses to publish without a PR", async () => {
		const f = fake({
			"gh pr view --json number,headRefOid,baseRefName,title": {
				code: 1,
				stdout: "",
				stderr: "no pull requests found",
			},
		});
		const r = await produceReceipt({ publish: true }, f.ports);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("no-pr");
	});

	test("refuses to publish when HEAD is not pushed to the PR", async () => {
		const f = fake({
			"gh pr view --json number,headRefOid,baseRefName,title": {
				code: 0,
				stdout: JSON.stringify({
					number: 42,
					headRefOid: "e".repeat(40),
					baseRefName: "v1/main",
					title: "x",
				}),
				stderr: "",
			},
		});
		const r = await produceReceipt({ publish: true }, f.ports);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("not-pushed");
		expect(f.verifyCalls).toHaveLength(0);
	});

	test("waits briefly for GitHub to catch up with a just-pushed head", async () => {
		let views = 0;
		const f = fake();
		const exec = f.ports.exec;
		const ports: ReceiptPorts = {
			...f.ports,
			exec: async (cmd) => {
				if (cmd.join(" ").startsWith("gh pr view")) {
					views++;
					return {
						code: 0,
						stdout: JSON.stringify({
							number: 42,
							headRefOid: views < 3 ? "e".repeat(40) : HEAD,
							baseRefName: "v1/main",
							title: "x",
						}),
						stderr: "",
					};
				}
				return exec(cmd);
			},
		};
		const r = await produceReceipt({ publish: true }, ports);
		expect(r.ok).toBe(true);
		expect(views).toBe(3);
	});

	test("waits for an in-progress Dogfood run before re-running it", async () => {
		let polls = 0;
		const f = fake();
		const exec = f.ports.exec;
		const ports: ReceiptPorts = {
			...f.ports,
			exec: async (cmd) => {
				if (cmd.join(" ").startsWith("gh run list --commit")) {
					polls++;
					const status = polls < 3 ? "in_progress" : "completed";
					return {
						code: 0,
						stdout: JSON.stringify([
							{ databaseId: 9, workflowName: "Dogfood", status },
						]),
						stderr: "",
					};
				}
				if (cmd.join(" ") === "gh run rerun 9") {
					f.calls.push("gh run rerun 9");
					return { code: 0, stdout: "", stderr: "" };
				}
				return exec(cmd);
			},
		};
		const r = await produceReceipt({ publish: true }, ports);
		expect(r.ok).toBe(true);
		expect(polls).toBe(3);
		expect(f.calls).toContain("gh run rerun 9");
	});

	test("re-runs a Dogfood run that appears shortly after publishing", async () => {
		let lists = 0;
		const f = fake();
		const exec = f.ports.exec;
		const ports: ReceiptPorts = {
			...f.ports,
			exec: async (cmd) => {
				if (cmd.join(" ").startsWith("gh run list --commit")) {
					lists++;
					const runs =
						lists < 2
							? []
							: [
									{
										databaseId: 7,
										workflowName: "Dogfood",
										status: "completed",
									},
								];
					return { code: 0, stdout: JSON.stringify(runs), stderr: "" };
				}
				return exec(cmd);
			},
		};
		const r = await produceReceipt({ publish: true }, ports);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.rerun).toBe(7);
	});

	test("no Dogfood run yet is fine: the next run picks the receipt up", async () => {
		const f = fake({
			"gh run list --commit": { code: 0, stdout: "[]", stderr: "" },
		});
		const r = await produceReceipt({ publish: true }, f.ports);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.rerun).toBeUndefined();
	});
});
