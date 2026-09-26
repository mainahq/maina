/**
 * Ephemeral workspaces (FR-REM-3): a job gets a fresh directory with the
 * PR's head checked out, and the directory is deleted afterwards whether
 * the job succeeded, failed or threw, and the deletion is verified: a
 * directory that is still there is a `cleanup_failed` error, never a
 * silent success.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result, systemProcess } from "@mainahq/core";
import {
	type CheckoutSource,
	inEphemeralWorkspace,
	systemWorkspaces,
	type Workspaces,
} from "../checkout";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const SOURCE: CheckoutSource = {
	cloneUrl: "https://github.test/acme/widgets.git",
	token: "ghs_fake",
	head: HEAD,
	base: BASE,
};

type Op = Readonly<{ op: string; dir?: string }>;

function fakeWorkspaces(
	options: Readonly<{ removeLeaves?: boolean; checkoutFails?: boolean }> = {},
): { workspaces: Workspaces; ops: Op[]; present: Set<string> } {
	const ops: Op[] = [];
	const present = new Set<string>();
	let n = 0;
	const workspaces: Workspaces = {
		create: async () => {
			n += 1;
			const dir = `/tmp/maina-job-${n}`;
			present.add(dir);
			ops.push({ op: "create", dir });
			return { ok: true, value: dir };
		},
		checkout: async (dir) => {
			ops.push({ op: "checkout", dir });
			return options.checkoutFails === true
				? { ok: false, error: { kind: "workspace", message: "fetch failed" } }
				: { ok: true, value: undefined };
		},
		remove: async (dir) => {
			ops.push({ op: "remove", dir });
			if (options.removeLeaves !== true) present.delete(dir);
			return { ok: true, value: undefined };
		},
		exists: async (dir) => {
			ops.push({ op: "exists", dir });
			return present.has(dir);
		},
	};
	return { workspaces, ops, present };
}

describe("inEphemeralWorkspace", () => {
	test("checks out, runs the work in the directory, then deletes it (verified)", async () => {
		const { workspaces, ops, present } = fakeWorkspaces();
		let seen = "";
		const result = await inEphemeralWorkspace(
			workspaces,
			SOURCE,
			async (dir) => {
				seen = dir;
				expect(present.has(dir)).toBe(true);
				return { ok: true, value: 42 };
			},
		);
		expect(result).toEqual({
			ok: true,
			value: { value: 42, workspace: { path: seen, removed: true } },
		});
		expect(ops.map((o) => o.op)).toEqual([
			"create",
			"checkout",
			"remove",
			"exists",
		]);
		expect(present.size).toBe(0);
	});

	test("the workspace is deleted when the work fails", async () => {
		const { workspaces, present } = fakeWorkspaces();
		const result = await inEphemeralWorkspace(workspaces, SOURCE, async () => ({
			ok: false,
			error: { kind: "capability", message: "boom" },
		}));
		expect(result).toEqual({
			ok: false,
			error: { kind: "capability", message: "boom" },
		});
		expect(present.size).toBe(0);
	});

	test("the workspace is deleted when the work throws", async () => {
		const { workspaces, present } = fakeWorkspaces();
		const result = await inEphemeralWorkspace(
			workspaces,
			SOURCE,
			async (): Promise<Result<number, never>> => {
				throw new Error("kaboom");
			},
		);
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.kind).toBe("workspace");
		expect(present.size).toBe(0);
	});

	test("the workspace is deleted when the checkout fails, and the work never runs", async () => {
		const { workspaces, present } = fakeWorkspaces({ checkoutFails: true });
		let ran = false;
		const result = await inEphemeralWorkspace(workspaces, SOURCE, async () => {
			ran = true;
			return { ok: true, value: 1 };
		});
		expect(ran).toBe(false);
		expect(result).toEqual({
			ok: false,
			error: { kind: "workspace", message: "fetch failed" },
		});
		expect(present.size).toBe(0);
	});

	test("a workspace still present after removal is cleanup_failed, not success", async () => {
		const { workspaces } = fakeWorkspaces({ removeLeaves: true });
		const result = await inEphemeralWorkspace(workspaces, SOURCE, async () => ({
			ok: true,
			value: 1,
		}));
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error).toMatchObject({
			kind: "cleanup_failed",
			path: "/tmp/maina-job-1",
		});
	});
});

describe("systemWorkspaces", () => {
	let scratch = "";
	let origin = "";
	let head = "";
	let base = "";

	async function git(cwd: string, ...args: string[]): Promise<string> {
		const out = await systemProcess.spawn(["git", ...args], { cwd });
		if (!out.ok || out.value.exitCode !== 0) {
			throw new Error(`git ${args.join(" ")}: ${JSON.stringify(out)}`);
		}
		return out.value.stdout.trim();
	}

	beforeAll(async () => {
		scratch = mkdtempSync(join(tmpdir(), "maina-354-"));
		origin = join(scratch, "origin");
		await systemProcess.spawn(["mkdir", "-p", origin], { cwd: scratch });
		await git(origin, "init", "-q", "-b", "main");
		await git(origin, "config", "user.email", "t@example.com");
		await git(origin, "config", "user.name", "t");
		await Bun.write(join(origin, "app.ts"), "export const v = 1;\n");
		await git(origin, "add", "app.ts");
		await git(origin, "commit", "-q", "-m", "base");
		base = await git(origin, "rev-parse", "HEAD");
		await Bun.write(join(origin, "app.ts"), "export const v = 2;\n");
		await git(origin, "commit", "-q", "-am", "head");
		head = await git(origin, "rev-parse", "HEAD");
		// Move the branch away so the head is only reachable by its sha,
		// like a PR head fetched from the base repository.
		await git(origin, "reset", "-q", "--hard", base);
		await git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
	});

	afterAll(() => {
		rmSync(scratch, { recursive: true, force: true });
	});

	const workspaces = () =>
		systemWorkspaces({
			process: systemProcess,
			env: process.env,
			tmpRoot: scratch,
		});

	test("creates a fresh directory under the temp root, checks out the head, removes it", async () => {
		const ws = workspaces();
		const dir = await ws.create();
		if (!dir.ok) throw new Error(dir.error.message);
		expect(dir.value.startsWith(join(scratch, "maina-job-"))).toBe(true);
		const checkout = await ws.checkout(dir.value, {
			cloneUrl: `file://${origin}`,
			token: "ghs_fake",
			head,
			base,
		});
		expect(checkout).toEqual({ ok: true, value: undefined });
		expect(readFileSync(join(dir.value, "app.ts"), "utf8")).toBe(
			"export const v = 2;\n",
		);
		// The base is present too, so a diff against it resolves.
		expect(await git(dir.value, "diff", "--stat", base)).toContain("app.ts");
		// The token is never written into the workspace's git config.
		expect(
			readFileSync(join(dir.value, ".git", "config"), "utf8"),
		).not.toContain("ghs_fake");
		expect(await ws.exists(dir.value)).toBe(true);
		expect(await ws.remove(dir.value)).toEqual({ ok: true, value: undefined });
		expect(await ws.exists(dir.value)).toBe(false);
		expect(existsSync(dir.value)).toBe(false);
	});

	test("refuses a ref that is not a commit sha, before running git", async () => {
		const ws = workspaces();
		const dir = await ws.create();
		if (!dir.ok) throw new Error(dir.error.message);
		const checkout = await ws.checkout(dir.value, {
			cloneUrl: `file://${origin}`,
			token: "t",
			head: "--upload-pack=touch /tmp/pwned",
			base,
		});
		expect(checkout.ok).toBe(false);
		await ws.remove(dir.value);
	});

	test("refuses a clone url that is not https or file", async () => {
		const ws = workspaces();
		const dir = await ws.create();
		if (!dir.ok) throw new Error(dir.error.message);
		const checkout = await ws.checkout(dir.value, {
			cloneUrl: "ext::sh -c touch% /tmp/pwned",
			token: "t",
			head,
			base,
		});
		expect(checkout.ok).toBe(false);
		await ws.remove(dir.value);
	});

	test("a fetch failure is a workspace error", async () => {
		const ws = workspaces();
		const dir = await ws.create();
		if (!dir.ok) throw new Error(dir.error.message);
		const checkout = await ws.checkout(dir.value, {
			cloneUrl: `file://${join(scratch, "missing")}`,
			token: "t",
			head,
			base,
		});
		expect(!checkout.ok && checkout.error.kind).toBe("workspace");
		await ws.remove(dir.value);
	});
});
